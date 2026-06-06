import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter } from 'bad-words'
import { useNavigate } from 'react-router-dom'
import { Circle, Plus } from 'lucide-react'
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Lobby</h1>
          <p className="text-xs text-muted-foreground">Target: find opponent under 30 seconds</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/profile/${profile?.id}`)}>
            Profile
          </Button>
          <Button variant="ghost" size="sm" onClick={logOut}>
            Logout
          </Button>
        </div>
      </header>

      {activeRoomQuery.data && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Active Room</CardTitle>
            <CardDescription>You already have an active room.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate(`/rooms/${activeRoomQuery.data?.id}`)}>
              Go to room
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Online Players</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {onlinePlayers.map((player) => (
              <div key={player.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{player.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {player.platform} • {player.division ?? 'Unranked'}
                  </p>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <Circle className="h-3 w-3 fill-emerald-500 text-emerald-500" /> Online
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Match Requests</CardTitle>
            <CardDescription>One active room per player</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select
                className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                value={roomPlatform}
                onChange={(e) => setRoomPlatform(e.target.value as Platform)}
              >
                <option value="Mobile">Mobile</option>
                <option value="PlayStation">PlayStation</option>
                <option value="Xbox">Xbox</option>
                <option value="PC">PC</option>
              </select>
              <Input value={roomDivision} onChange={(e) => setRoomDivision(e.target.value)} placeholder="Division" />
            </div>
            <Button className="w-full gap-2" onClick={() => createRoomMutation.mutate()}>
              <Plus className="h-4 w-4" /> Looking For Match
            </Button>

            <div className="space-y-2">
              {(roomsQuery.data ?? []).map((room) => (
                <div key={room.id} className="rounded-lg border border-border/60 p-3">
                  <p className="text-sm font-medium">{room.host?.username ?? 'Host'}</p>
                  <p className="text-xs text-muted-foreground">
                    {room.platform} • {room.division ?? 'Any division'}
                  </p>
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    disabled={room.host_id === session?.user.id}
                    onClick={() => joinRoomMutation.mutate(room)}
                  >
                    Join Match
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Global Chat</CardTitle>
            <CardDescription>300 chars max, profanity filtered</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-[320px] space-y-2 overflow-y-auto rounded-lg border border-border/50 p-2">
              {(chatQuery.data ?? []).map((message) => (
                <div key={message.id} className="rounded-md bg-secondary/60 p-2 text-sm">
                  <p className="text-xs text-primary">{message.profiles?.username ?? 'Player'}</p>
                  <p>{message.message}</p>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
            <div className="flex gap-2">
              <Input
                maxLength={300}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Ask for match..."
              />
              <Button disabled={!chatText.trim()} onClick={() => sendMessageMutation.mutate(chatText)}>
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MobileShell>
  )
}
