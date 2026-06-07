import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter } from 'bad-words'
import { useNavigate } from 'react-router-dom'
import { Circle, Plus, MessageSquare, Users2, Trophy, Clock, Send, Gamepad2, Loader2, Star, LogOut, ChevronUp, Pencil } from 'lucide-react'
import { MobileShell } from '@/components/layout/mobile-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AvatarDisplay } from '@/components/ui/avatar-display'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ChatMessage, MatchRoom, Platform, Profile, RoomStatus } from '@/types/domain'
import { trackEvent } from '@/lib/analytics'

const messageFilter = new Filter()
const ACTIVE_STATUSES: RoomStatus[] = ['WAITING', 'MATCHED', 'PLAYING', 'RATING']
const CHAT_PAGE_SIZE = 30

const PLATFORM_LABELS: Record<Platform, string> = {
  Mobile: '📱',
  PlayStation: '🎮',
  Xbox: '🕹️',
  PC: '🖥️',
}

const fetchOnlineProfiles = async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data } = await supabase.from('profiles').select('*').gte('last_seen', fiveMinutesAgo).order('last_seen', { ascending: false })
  return (data ?? []) as Profile[]
}

const fetchRooms = async () => {
  // Close any expired WAITING rooms server-side (fire-and-forget)
  void supabase.rpc('close_expired_rooms')

  const { data } = await supabase
    .from('match_rooms')
    .select('*, host:profiles!match_rooms_host_id_fkey(id,username,platform,division,reputation_score,avatar_preset,avatar_bg)')
    .eq('status', 'WAITING')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  return (data ?? []) as MatchRoom[]
}

// Returns the active room that blocks the user from creating/joining another,
// but treats a RATING room as non-blocking once the user has already rated.
const getBlockingActiveRoom = async (userId: string): Promise<MatchRoom | null> => {
  const { data } = await supabase
    .from('match_rooms')
    .select('*')
    .or(`host_id.eq.${userId},guest_id.eq.${userId}`)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .maybeSingle<MatchRoom>()

  if (!data) return null
  if (data.status !== 'RATING') return data

  // Rating room: only block if user hasn't submitted their rating yet
  const { data: myRating } = await supabase
    .from('ratings')
    .select('id')
    .eq('room_id', data.id)
    .eq('from_user_id', userId)
    .maybeSingle()

  return myRating ? null : data
}

export const LobbyPage = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { profile, session, setProfile } = useAuthStore()
  const [chatText, setChatText] = useState('')
  const [roomPlatform, setRoomPlatform] = useState<Platform>(profile?.platform ?? 'Mobile')
  const [roomDivision, setRoomDivision] = useState(profile?.division ?? '')

  // Chat pagination state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatHasMore, setChatHasMore] = useState(false)
  const [chatLoadingMore, setChatLoadingMore] = useState(false)
  const chatOldestRef = useRef<string | undefined>(undefined)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom only when the newest message changes (not on prepend)
  const lastMessageId = chatMessages[chatMessages.length - 1]?.id
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lastMessageId])

  // Initial chat load
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*, profiles:profiles(id,username,avatar_url,platform)')
        .order('created_at', { ascending: false })
        .limit(CHAT_PAGE_SIZE)

      const msgs = ((data ?? []).reverse()) as ChatMessage[]
      setChatMessages(msgs)
      setChatHasMore(msgs.length >= CHAT_PAGE_SIZE)
      if (msgs.length > 0) chatOldestRef.current = msgs[0].created_at
    }
    void load()
  }, [])

  // Load older chat messages (prepend) with scroll-position preservation
  const loadOlderChat = useCallback(async () => {
    if (!chatOldestRef.current || chatLoadingMore) return
    const container = chatContainerRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0

    setChatLoadingMore(true)
    const { data } = await supabase
      .from('chat_messages')
      .select('*, profiles:profiles(id,username,avatar_url,platform)')
      .order('created_at', { ascending: false })
      .lt('created_at', chatOldestRef.current)
      .limit(CHAT_PAGE_SIZE)

    const older = ((data ?? []).reverse()) as ChatMessage[]
    setChatLoadingMore(false)

    if (older.length > 0) {
      chatOldestRef.current = older[0].created_at
      setChatMessages((prev: ChatMessage[]) => [...older, ...prev])
      // Restore scroll position so the view doesn't jump
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - prevScrollHeight
      })
    }
    setChatHasMore(older.length >= CHAT_PAGE_SIZE)
  }, [chatLoadingMore])

  const onlineProfilesQuery = useQuery({ queryKey: ['online-profiles'], queryFn: fetchOnlineProfiles, refetchInterval: 15000 })
  const roomsQuery = useQuery({ queryKey: ['rooms'], queryFn: fetchRooms, refetchInterval: 5000 })

  const activeRoomQuery = useQuery({
    queryKey: ['my-active-room', session?.user.id],
    queryFn: () => session?.user.id ? getBlockingActiveRoom(session.user.id) : null,
    enabled: Boolean(session?.user.id),
    refetchInterval: 4000,
  })

  // Online presence heartbeat
  useEffect(() => {
    if (!profile || !session?.user) return

    const channel = supabase.channel('online-presence', {
      config: { presence: { key: session.user.id } },
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

    return () => { void supabase.removeChannel(channel) }
  }, [profile, queryClient, session?.user])

  // Real-time: rooms list + active room + incoming chat messages
  useEffect(() => {
    const channel = supabase
      .channel('lobby-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rooms' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rooms'] })
        queryClient.invalidateQueries({ queryKey: ['my-active-room'] })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (payload: { new: Record<string, unknown> }) => {
        const { data } = await supabase
          .from('chat_messages')
          .select('*, profiles:profiles(id,username,avatar_url,platform)')
          .eq('id', payload.new['id'] as string)
          .single()

        if (data) setChatMessages((prev: ChatMessage[]) => [...prev, data as ChatMessage])
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [queryClient])

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

      const existingRoom = await getBlockingActiveRoom(session.user.id)
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

      const existingRoom = await getBlockingActiveRoom(session.user.id)
      if (existingRoom) {
        navigate(`/rooms/${existingRoom.id}`)
        return
      }

      const { data, error } = await supabase
        .from('match_rooms')
        .update({ guest_id: session.user.id, status: 'MATCHED' })
        .eq('id', room.id)
        .eq('status', 'WAITING')
        .select('id')

      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error('This room was just taken. Please try another one.')
      }

      trackEvent('room_joined')
      navigate(`/rooms/${room.id}`)
    },
    onError: (error: unknown) => {
      alert(error instanceof Error ? error.message : 'Failed to join room')
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
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
      {/* Header */}
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          {profile && <AvatarDisplay profile={profile} size="sm" />}
          <div>
            <h1 className="text-base font-bold leading-tight text-foreground">{profile?.username ?? 'Player'}</h1>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" />
              {onlinePlayers.length} online
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="rounded-full h-8 px-3 text-xs" onClick={() => navigate(`/profile/${profile?.id}`)}>
            <Trophy className="h-3.5 w-3.5 mr-1.5" /> Profile
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full h-8 w-8 p-0" title="Edit Profile" onClick={() => navigate('/profile-edit')}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full h-8 w-8 p-0" onClick={logOut}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Active room banner */}
      {activeRoomQuery.data && (
        <Card className="border-primary/40 bg-primary/5 shadow-md">
          <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Circle className="h-2 w-2 fill-primary text-primary animate-pulse" />
              <div>
                <CardTitle className="text-sm text-primary">Active Room</CardTitle>
                <CardDescription className="text-xs">You have a match in progress.</CardDescription>
              </div>
            </div>
            <Button size="sm" className="rounded-full h-8 text-xs shrink-0" onClick={() => navigate(`/rooms/${activeRoomQuery.data?.id}`)}>
              Return →
            </Button>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-12 content-start">
        {/* MATCH CREATE + OPEN ROOMS */}
        <div className="order-1 lg:order-2 lg:col-span-5 space-y-4">
          <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gamepad2 className="h-4 w-4 text-primary" /> Create Match
              </CardTitle>
              <CardDescription className="text-xs flex items-center gap-1">
                <Clock className="h-3 w-3" /> Target: find opponent in under 30 seconds
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-9 rounded-lg border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={roomPlatform}
                  onChange={(e) => setRoomPlatform(e.target.value as Platform)}
                >
                  <option value="Mobile">📱 Mobile</option>
                  <option value="PlayStation">🎮 PlayStation</option>
                  <option value="Xbox">🕹️ Xbox</option>
                  <option value="PC">🖥️ PC</option>
                </select>
                <Input
                  className="h-9 bg-background/50 rounded-lg text-sm"
                  value={roomDivision}
                  onChange={(e) => setRoomDivision(e.target.value)}
                  placeholder="Division (optional)"
                />
              </div>
              <Button
                className="w-full gap-2 rounded-full font-semibold"
                size="default"
                disabled={createRoomMutation.isPending}
                onClick={() => createRoomMutation.mutate()}
              >
                {createRoomMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                ) : (
                  <><Plus className="h-4 w-4" /> Looking For Match</>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Open Rooms</CardTitle>
                <Badge variant="secondary" className="text-xs font-normal">
                  {roomsQuery.data?.length ?? 0} waiting
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {roomsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : roomsQuery.data?.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <Gamepad2 className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                    <p className="text-sm text-muted-foreground">No open rooms. Create one!</p>
                  </div>
                ) : (
                  (roomsQuery.data ?? []).map((room) => {
                    const isHost = room.host_id === session?.user.id
                    const isJoiningThis = joinRoomMutation.isPending && joinRoomMutation.variables?.id === room.id
                    const repPct = room.host?.reputation_score !== undefined
                      ? (room.host.reputation_score * 100).toFixed(0) + '%'
                      : null

                    return (
                      <div
                        key={room.id}
                        className="group rounded-xl border border-border/50 bg-secondary/20 p-3 transition-all hover:border-primary/30 hover:bg-secondary/30"
                      >
                        <div className="flex items-center gap-3">
                          {room.host
                            ? <AvatarDisplay profile={room.host} size="sm" />
                            : <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">H</div>
                          }
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{room.host?.username ?? 'Host'}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {PLATFORM_LABELS[room.platform as Platform] ?? ''} {room.platform}
                              </span>
                              <span className="text-muted-foreground/40 text-xs">·</span>
                              <span className="text-xs text-muted-foreground">{room.division || 'Unranked'}</span>
                            </div>
                          </div>
                          {repPct && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                              <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                              {repPct}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={isHost ? 'secondary' : 'default'}
                          className="mt-2.5 w-full rounded-full h-8 text-xs"
                          disabled={isHost || joinRoomMutation.isPending}
                          onClick={() => joinRoomMutation.mutate(room)}
                        >
                          {isJoiningThis ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Joining...</>
                          ) : isHost ? 'Your Room' : 'Join Match'}
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* GLOBAL CHAT */}
        <Card className="order-2 lg:order-1 lg:col-span-4 flex flex-col h-[420px] lg:h-auto border-border/60">
          <CardHeader className="py-3 px-4 border-b border-border/40 shrink-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-primary" /> Global Chat
            </CardTitle>
          </CardHeader>

          <CardContent ref={chatContainerRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            {/* Load older button */}
            {chatHasMore && (
              <div className="flex justify-center pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground gap-1 rounded-full"
                  disabled={chatLoadingMore}
                  onClick={loadOlderChat}
                >
                  {chatLoadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronUp className="h-3 w-3" />}
                  {chatLoadingMore ? 'Loading...' : 'Load older'}
                </Button>
              </div>
            )}

            {chatMessages.length === 0 && !chatHasMore ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-muted-foreground">No messages yet. Say hello!</p>
              </div>
            ) : (
              chatMessages.map((message) => {
                const isMe = message.user_id === session?.user.id
                return (
                  <div key={message.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex flex-col max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-muted-foreground mb-0.5 px-1">{message.profiles?.username}</span>
                      <div className={`rounded-2xl px-3 py-1.5 text-sm ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-secondary-foreground rounded-tl-sm'}`}>
                        {message.message}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={chatBottomRef} />
          </CardContent>

          <div className="p-3 border-t border-border/40 bg-card shrink-0">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendMessageMutation.mutate(chatText) }}>
              <Input
                className="rounded-full bg-background/50 h-9 text-sm"
                maxLength={300}
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Message lobby..."
              />
              <Button type="submit" size="icon" className="rounded-full shrink-0 h-9 w-9" disabled={!chatText.trim() || sendMessageMutation.isPending}>
                {sendMessageMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </form>
          </div>
        </Card>

        {/* ONLINE PLAYERS */}
        <Card className="order-3 lg:col-span-3 border-border/60 max-h-[350px] lg:max-h-none flex flex-col">
          <CardHeader className="py-3 px-4 border-b border-border/40 shrink-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users2 className="h-4 w-4 text-primary" /> Online
              <Badge variant="secondary" className="ml-auto text-xs font-normal">{onlinePlayers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-2 min-h-0">
            <div className="space-y-0.5">
              {onlinePlayers.length === 0 ? (
                <p className="text-xs text-center text-muted-foreground py-6">No one else online</p>
              ) : (
                onlinePlayers.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-secondary/40 transition-colors cursor-pointer"
                    onClick={() => navigate(`/profile/${player.id}`)}
                  >
                    <div className="relative shrink-0">
                      <AvatarDisplay profile={player} size="xs" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background bg-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{player.username}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {PLATFORM_LABELS[player.platform] ?? ''} {player.platform}
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
