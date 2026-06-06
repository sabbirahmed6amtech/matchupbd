import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter } from 'bad-words'
import { useNavigate } from 'react-router-dom'
import { Circle, Plus, MessageSquare, Users2, Trophy, Clock, Send, Gamepad2 } from 'lucide-react'
import { MobileShell } from '@/components/layout/mobile-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ChatMessage, MatchRoom, Platform, Profile, RoomStatus } from '@/types/domain'
import { trackEvent } from '@/lib/analytics'

const messageFilter = new Filter()
const ACTIVE_STATUSES: RoomStatus[] = ['WAITING', 'MATCHED', 'PLAYING', 'RATING']

const fetchOnlineProfiles = async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data } = await supabase.from('profiles').select('*').gte('last_seen', fiveMinutesAgo).order('last_seen', { ascending: false })
  return (data ?? []) as Profile[]
}

const fetchRooms = async () => {
  const { data } = await supabase
    .from('match_rooms')
    .select('*, host:profiles!match_rooms_host_id_fkey(id,username,platform,division,reputation_score)')
    .eq('status', 'WAITING')
    .order('created_at', { ascending: false })

  return (data ?? []) as MatchRoom[]
}

const fetchGlobalChat = async () => {
  const { data } = await supabase
    .from('chat_messages')
    .select('*, profiles:profiles(id,username,avatar_url,platform)')
    .order('created_at', { ascending: true })
    .limit(100)

  return (data ?? []) as ChatMessage[]
}

export const LobbyPage = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { profile, session, setProfile } = useAuthStore()
  const [chatText, setChatText] = useState('')
  const [roomPlatform, setRoomPlatform] = useState<Platform>(profile?.platform ?? 'Mobile')
  const [roomDivision, setRoomDivision] = useState(profile?.division ?? '')
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const onlineProfilesQuery = useQuery({ queryKey: ['online-profiles'], queryFn: fetchOnlineProfiles, refetchInterval: 15000 })
  const roomsQuery = useQuery({ queryKey: ['rooms'], queryFn: fetchRooms, refetchInterval: 5000 })
  const chatQuery = useQuery({ queryKey: ['global-chat'], queryFn: fetchGlobalChat, refetchInterval: 3000 })

  const activeRoomQuery = useQuery({
    queryKey: ['my-active-room', session?.user.id],
    queryFn: async () => {
      if (!session?.user.id) return null
      const { data } = await supabase
        .from('match_rooms')
        .select('*')
        .or(`host_id.eq.${session.user.id},guest_id.eq.${session.user.id}`)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .maybeSingle<MatchRoom>()
      return data
    },
    enabled: Boolean(session?.user.id),
    refetchInterval: 4000,
  })

  useEffect(() => {
    if (!profile || !session?.user) return

    const channel = supabase.channel('online-presence', {
      config: {
        presence: { key: session.user.id },
      },
    })

    channel
      .on('presence', { event: 'sync' }, async () => {
        await supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', session.user.id)
        queryClient.invalidateQueries({ queryKey: ['online-profiles'] })
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ username: profile.username, onlineAt: new Date().toISOString() })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [profile, queryClient, session?.user])

  useEffect(() => {
    const chatChannel = supabase
      .channel('global-chat-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['global-chat'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rooms' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rooms'] })
        queryClient.invalidateQueries({ queryKey: ['my-active-room'] })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(chatChannel)
    }
  }, [queryClient])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatQuery.data])

  const createRoomMutation = useMutation({
    mutationFn: async () => {
      if (!session?.user.id) return

      const { data: latestMyRoom } = await supabase
        .from('match_rooms')
        .select('created_at')
        .eq('host_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ created_at: string }>()

      if (latestMyRoom?.created_at) {
        const elapsed = Date.now() - new Date(latestMyRoom.created_at).getTime()
        if (elapsed < 30000) {
          throw new Error(`Please wait ${Math.ceil((30000 - elapsed) / 1000)}s before creating another room.`)
        }
      }

      const { data: existingRoom } = await supabase
        .from('match_rooms')
        .select('*')
        .or(`host_id.eq.${session.user.id},guest_id.eq.${session.user.id}`)
        .in('status', ACTIVE_STATUSES)
        .maybeSingle<MatchRoom>()

      if (existingRoom) {
        navigate(`/rooms/${existingRoom.id}`)
        return
      }

      const { data, error } = await supabase
        .from('match_rooms')
        .insert({ host_id: session.user.id, platform: roomPlatform, division: roomDivision || null, status: 'WAITING' })
        .select('*')
        .single<MatchRoom>()

      if (error) throw error
      trackEvent('room_created', { platform: roomPlatform })
      navigate(`/rooms/${data.id}`)
    },
    onError: (error: unknown) => {
      alert(error instanceof Error ? error.message : 'Failed to create room')
    },
  })

  const joinRoomMutation = useMutation({
    mutationFn: async (room: MatchRoom) => {
      if (!session?.user.id || room.host_id === session.user.id) return

      const { error } = await supabase
        .from('match_rooms')
        .update({ guest_id: session.user.id, status: 'MATCHED' })
        .eq('id', room.id)
        .eq('status', 'WAITING')

      if (error) throw error
      trackEvent('room_joined')
      navigate(`/rooms/${room.id}`)
    },
    onError: (error: unknown) => {
      alert(error instanceof Error ? error.message : 'Failed to join room')
    },
  })

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!session?.user.id) return
      const sanitized = messageFilter.clean(message.trim())
      if (!sanitized || sanitized.length > 300) return

      const { error } = await supabase.from('chat_messages').insert({ user_id: session.user.id, message: sanitized })
      if (error) throw error

      setChatText('')
      trackEvent('global_message_sent')
    },
  })

  const onlinePlayers = useMemo(() => onlineProfilesQuery.data ?? [], [onlineProfilesQuery.data])

  const logOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    navigate('/')
  }

  return (
    <MobileShell>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Match Lobby</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <Clock className="h-3.5 w-3.5" /> Target: find opponent under 30 seconds
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="rounded-full" onClick={() => navigate(`/profile/${profile?.id}`)}>
            <Trophy className="h-4 w-4 mr-2" /> Profile
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={logOut}>
            Logout
          </Button>
        </div>
      </header>

      {activeRoomQuery.data && (
        <Card className="border-primary/50 shadow-lg shadow-primary/10">
          <CardHeader className="pb-3 text-center sm:text-left sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-primary flex items-center gap-2">
                <Circle className="h-2 w-2 fill-primary animate-pulse" /> Active Room
              </CardTitle>
              <CardDescription className="mt-1">You already have an active match progressing.</CardDescription>
            </div>
            <Button className="w-full sm:w-auto mt-4 sm:mt-0 rounded-full" onClick={() => navigate(`/rooms/${activeRoomQuery.data?.id}`)}>
              Return to match
            </Button>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-12 content-start">
        {/* MATCH REQUESTS (CENTER / MAIN FOCUS) */}
        <div className="order-1 lg:order-2 lg:col-span-5 space-y-4">
          <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gamepad2 className="h-5 w-5 text-primary" /> Create Match
              </CardTitle>
              <CardDescription>Setup your preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <select
                  className="h-10 rounded-md border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={roomPlatform}
                  onChange={(e) => setRoomPlatform(e.target.value as Platform)}
                >
                  <option value="Mobile">Mobile</option>
                  <option value="PlayStation">PlayStation</option>
                  <option value="Xbox">Xbox</option>
                  <option value="PC">PC</option>
                </select>
                <Input className="bg-background/50" value={roomDivision} onChange={(e) => setRoomDivision(e.target.value)} placeholder="Division (optional)" />
              </div>
              <Button className="w-full gap-2 rounded-full font-semibold shadow-md active:scale-[0.98] transition-transform" size="lg" onClick={() => createRoomMutation.mutate()}>
                <Plus className="h-5 w-5" /> Looking For Match
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Open Rooms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {roomsQuery.data?.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No open rooms right now. Create one!</p>
                ) : (
                  (roomsQuery.data ?? []).map((room) => (
                    <div key={room.id} className="group relative overflow-hidden rounded-xl border border-border/50 bg-secondary/20 p-4 transition-colors hover:border-primary/40 hover:bg-secondary/40">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-foreground">{room.host?.username ?? 'Host'}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {room.platform} <span className="opacity-50">|</span> {room.division || 'Unranked'}
                          </p>
                        </div>
                        <Badge variant="outline" className="bg-background/50">waiting</Badge>
                      </div>
                      <Button
                        size="sm"
                        variant={room.host_id === session?.user.id ? "secondary" : "default"}
                        className="mt-4 w-full rounded-full"
                        disabled={room.host_id === session?.user.id}
                        onClick={() => joinRoomMutation.mutate(room)}
                      >
                        {room.host_id === session?.user.id ? "You are host" : "Join Match"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* GLOBAL CHAT (LEFT/BOTTOM) */}
        <Card className="order-3 lg:order-1 lg:col-span-4 flex flex-col h-[500px] lg:h-auto border-border/60">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquare className="h-5 w-5 text-primary" /> Global Chat
            </CardTitle>
            <CardDescription>Server-wide finding channel</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
            {(chatQuery.data ?? []).map((message) => {
              const isMe = message.user_id === session?.user.id
              return (
                <div key={message.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex flex-col max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
                    <span className="text-[10px] text-muted-foreground mb-1 px-1">{message.profiles?.username}</span>
                    <div className={`rounded-2xl px-3 py-2 text-sm ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-secondary-foreground rounded-tl-sm'}`}>
                      {message.message}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={chatBottomRef} />
          </CardContent>
          <div className="p-3 border-t border-border/40 bg-card">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendMessageMutation.mutate(chatText); }}>
              <Input
                className="rounded-full bg-background/50 h-10"
                maxLength={300}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Message lobby..."
              />
              <Button type="submit" size="icon" className="rounded-full shrink-0 h-10 w-10" disabled={!chatText.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </Card>

        {/* ONLINE PLAYERS (RIGHT) */}
        <Card className="order-2 lg:order-3 lg:col-span-3 border-border/60 max-h-[400px] flex flex-col">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users2 className="h-5 w-5 text-primary" /> Online ({onlinePlayers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {onlinePlayers.length === 0 ? (
                <p className="text-sm text-center text-muted-foreground my-4">No one else online</p>
              ) : (
                onlinePlayers.map((player) => (
                  <div key={player.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-secondary/40 transition-colors">
                    <div className="relative">
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-medium border border-border">
                        {player.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-background bg-emerald-500"></span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{player.username}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {player.platform}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </MobileShell>
  )
}
