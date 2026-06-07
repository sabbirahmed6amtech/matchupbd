import { useCallback, useEffect, useRef, useState } from 'react'
import { Filter } from 'bad-words'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Swords, Flag, MessageCircle, Send, Star, Clock, Loader2, Crown, Shield, ChevronUp } from 'lucide-react'
import { MobileShell } from '@/components/layout/mobile-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AvatarDisplay } from '@/components/ui/avatar-display'
import { useAuthStore } from '@/stores/useAuthStore'
import { supabase } from '@/lib/supabase'
import type { MatchRoom, Rating, RatingValue, RoomMessage } from '@/types/domain'
import { trackEvent } from '@/lib/analytics'

const messageFilter = new Filter()
const CHAT_PAGE_SIZE = 30

const STATUS_COLORS: Record<string, string> = {
  WAITING: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  MATCHED: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  PLAYING: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  RATING: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  CLOSED: 'bg-secondary text-muted-foreground border-border',
}

const fetchRoom = async (roomId: string) => {
  const { data } = await supabase
    .from('match_rooms')
    .select(
      '*, host:profiles!match_rooms_host_id_fkey(id,username,platform,division,reputation_score,matches_played,avatar_preset,avatar_bg), guest:profiles!match_rooms_guest_id_fkey(id,username,platform,division,reputation_score,matches_played,avatar_preset,avatar_bg)',
    )
    .eq('id', roomId)
    .single()

  return data as MatchRoom
}

const fetchRatings = async (roomId: string) => {
  const { data } = await supabase.from('ratings').select('*').eq('room_id', roomId)
  return (data ?? []) as Rating[]
}

const playMatchSound = () => {
  try {
    const ctx = new AudioContext()
    // Ascending triumphant arpeggio: C5 → E5 → G5 → C6
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.13
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.28, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
      osc.start(t)
      osc.stop(t + 0.56)
    })
  } catch {
    // silently ignore if AudioContext is unavailable
  }
}

export const MatchRoomPage = () => {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuthStore()
  const [chatText, setChatText] = useState('')
  const [showMatchedOverlay, setShowMatchedOverlay] = useState(false)
  const [secsLeft, setSecsLeft] = useState<number | null>(null)
  const prevStatusRef = useRef<string | undefined>(undefined)

  // Chat pagination state
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([])
  const [chatHasMore, setChatHasMore] = useState(false)
  const [chatLoadingMore, setChatLoadingMore] = useState(false)
  const chatOldestRef = useRef<string | undefined>(undefined)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom only when the newest message changes (not on prepend)
  const lastMessageId = roomMessages[roomMessages.length - 1]?.id
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lastMessageId])

  // Initial room messages load
  useEffect(() => {
    if (!roomId) return
    const load = async () => {
      const { data } = await supabase
        .from('room_messages')
        .select('*, profiles:profiles(id,username)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(CHAT_PAGE_SIZE)

      const msgs = ((data ?? []).reverse()) as RoomMessage[]
      setRoomMessages(msgs)
      setChatHasMore(msgs.length >= CHAT_PAGE_SIZE)
      if (msgs.length > 0) chatOldestRef.current = msgs[0].created_at
    }
    void load()
  }, [roomId])

  // Load older messages (prepend) with scroll-position preservation
  const loadOlderMessages = useCallback(async () => {
    if (!chatOldestRef.current || chatLoadingMore) return
    const container = chatContainerRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0

    setChatLoadingMore(true)
    const { data } = await supabase
      .from('room_messages')
      .select('*, profiles:profiles(id,username)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .lt('created_at', chatOldestRef.current)
      .limit(CHAT_PAGE_SIZE)

    const older = ((data ?? []).reverse()) as RoomMessage[]
    setChatLoadingMore(false)

    if (older.length > 0) {
      chatOldestRef.current = older[0].created_at
      setRoomMessages((prev: RoomMessage[]) => [...older, ...prev])
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - prevScrollHeight
      })
    }
    setChatHasMore(older.length >= CHAT_PAGE_SIZE)
  }, [chatLoadingMore, roomId])

  const roomQuery = useQuery({ queryKey: ['room', roomId], queryFn: () => fetchRoom(roomId), enabled: Boolean(roomId) })
  const ratingsQuery = useQuery({ queryKey: ['room-ratings', roomId], queryFn: () => fetchRatings(roomId), enabled: Boolean(roomId) })

  // Real-time subscriptions
  useEffect(() => {
    if (!roomId) return
    const channel = supabase
      .channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rooms', filter: `id=eq.${roomId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['room', roomId] })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` }, async (payload: { new: Record<string, unknown> }) => {
        const { data } = await supabase
          .from('room_messages')
          .select('*, profiles:profiles(id,username)')
          .eq('id', payload.new['id'] as string)
          .single()

        if (data) setRoomMessages((prev: RoomMessage[]) => [...prev, data as RoomMessage])
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings', filter: `room_id=eq.${roomId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['room-ratings', roomId] })
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [queryClient, roomId])

  const room = roomQuery.data
  const ratings = ratingsQuery.data ?? []

  const isHost = room?.host_id === session?.user.id
  const me = !room || !session?.user.id ? null : isHost ? room.host : room.guest_id === session.user.id ? room.guest : null
  const opponent = !room || !session?.user.id ? null : isHost ? room.guest : room.host

  const sendMessage = useMutation({
    mutationFn: async (message: string) => {
      if (!session?.user.id) return
      const sanitized = messageFilter.clean(message.trim())
      if (!sanitized || sanitized.length > 300) return

      const { error } = await supabase.from('room_messages').insert({ room_id: roomId, user_id: session.user.id, message: sanitized })
      if (error) throw error

      setChatText('')
      trackEvent('room_message_sent')
    },
  })

  const updateStatus = useMutation({
    mutationFn: async (status: MatchRoom['status']) => {
      const payload = status === 'CLOSED' ? { status, closed_at: new Date().toISOString() } : { status }
      const { error } = await supabase.from('match_rooms').update(payload).eq('id', roomId)
      if (error) throw error
      if (status === 'RATING') trackEvent('match_ended')
    },
  })

  const submitRating = useMutation({
    mutationFn: async (value: RatingValue) => {
      if (!session?.user.id || !opponent?.id) return

      const { error } = await supabase.from('ratings').upsert({
        room_id: roomId,
        from_user_id: session.user.id,
        to_user_id: opponent.id,
        rating: value,
      })
      if (error) throw error

      await supabase.rpc('close_room_if_fully_rated', { input_room_id: roomId })
      trackEvent('rating_submitted', { value })
    },
    onSuccess: () => navigate('/lobby'),
  })

  const myRating = ratings.find((rating) => rating.from_user_id === session?.user.id)

  useEffect(() => {
    if (room?.status === 'CLOSED') navigate('/lobby')
  }, [navigate, room?.status])

  useEffect(() => {
    if (!room?.status) return
    const prev = prevStatusRef.current
    prevStatusRef.current = room.status
    if (prev === 'WAITING' && room.status === 'MATCHED') {
      playMatchSound()
      document.title = '⚔️ Opponent Found! — MatchUp BD'
      setShowMatchedOverlay(true)
      const t = setTimeout(() => {
        setShowMatchedOverlay(false)
        document.title = 'MatchUp BD'
      }, 2800)
      return () => clearTimeout(t)
    }
  }, [room?.status])

  // Countdown timer for WAITING rooms
  const expiresAt = room?.expires_at
  const isWaiting = room?.status === 'WAITING'
  useEffect(() => {
    if (!expiresAt || !isWaiting) { setSecsLeft(null); return }
    const tick = () => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    setSecsLeft(tick())
    const id = setInterval(() => { const s = tick(); setSecsLeft(s); if (s === 0) clearInterval(id) }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, isWaiting])

  // Auto-close expired WAITING room (host only)
  useEffect(() => {
    if (secsLeft === 0 && isWaiting && isHost && !updateStatus.isPending) {
      updateStatus.mutate('CLOSED')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secsLeft])

  if (roomQuery.isLoading) {
    return (
      <MobileShell>
        <div className="flex flex-col items-center justify-center flex-1 py-20 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading room...</p>
        </div>
      </MobileShell>
    )
  }

  if (!room) {
    return (
      <MobileShell>
        <div className="flex flex-col items-center justify-center flex-1 py-20 gap-3">
          <p className="text-muted-foreground">Room not found.</p>
          <Button size="sm" onClick={() => navigate('/lobby')}>Back to Lobby</Button>
        </div>
      </MobileShell>
    )
  }

  const statusColorClass = STATUS_COLORS[room.status] ?? STATUS_COLORS.CLOSED

  return (
    <MobileShell>
      {showMatchedOverlay && (
        <div className="matched-backdrop fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(109,40,217,0.55) 0%, rgba(0,0,0,0.82) 70%)' }}>
          <div className="matched-text flex flex-col items-center gap-5 select-none">
            <div className="relative flex items-center justify-center">
              <div className="matched-ring absolute h-32 w-32 rounded-full border-4 border-primary/60" />
              <div className="matched-ring absolute h-32 w-32 rounded-full border-4 border-primary/40" style={{ animationDelay: '0.4s' }} />
              <Swords className="h-16 w-16 text-primary drop-shadow-[0_0_18px_hsl(270,95%,65%)]" />
            </div>
            <div className="text-center">
              <p className="text-4xl font-black tracking-widest text-white drop-shadow-[0_0_24px_hsl(270,95%,65%)] uppercase">
                Opponent
              </p>
              <p className="text-5xl font-black tracking-widest text-primary drop-shadow-[0_0_32px_hsl(270,95%,65%)] uppercase mt-1">
                Found!
              </p>
            </div>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between mb-1">
        <Button variant="ghost" size="sm" className="rounded-full gap-2 -ml-3 h-8" onClick={() => navigate('/lobby')}>
          <ArrowLeft className="h-4 w-4" /> Lobby
        </Button>
        <Badge variant="outline" className={`uppercase tracking-widest text-[10px] font-semibold px-2.5 ${statusColorClass}`}>
          {room.status}
        </Badge>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* MATCH DETAILS LEFT */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <Card className="border-border/60 shadow-md relative overflow-hidden bg-card/60 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />

            <CardHeader className="text-center pb-2 pt-5">
              <CardTitle className="text-xl font-bold flex items-center justify-center gap-2">
                <Swords className="h-5 w-5 text-primary" /> Match Room
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Share your eFootball ID in chat to start the game.</p>
            </CardHeader>

            <CardContent className="pt-3 pb-2">
              <div className="flex items-stretch gap-3 sm:gap-6">
                {/* Me */}
                <div className="flex-1 flex flex-col items-center p-3 sm:p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-1 mb-2">
                    <Crown className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                      {isHost ? 'You (Host)' : 'You'}
                    </span>
                  </div>
                  {me
                    ? <AvatarDisplay profile={me} size="lg" className="border-2 border-primary/40 mb-2" />
                    : <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold border-2 border-primary/40 text-primary mb-2">?</div>
                  }
                  <p className="font-bold text-sm sm:text-base truncate w-full text-center">{me?.username ?? '—'}</p>
                  <Badge variant="outline" className="mt-1.5 text-[10px] px-2 border-border/60 bg-background/50">
                    {me?.platform ?? '—'}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground mt-1">Div: {me?.division ?? 'Unranked'}</p>
                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                    <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                    {me?.reputation_score !== undefined ? (me.reputation_score * 100).toFixed(0) + '%' : '—'}
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center shrink-0">
                  <div className="text-xs font-black text-muted-foreground/40 bg-background/60 border border-border/30 px-2 py-1 rounded-md">VS</div>
                </div>

                {/* Opponent */}
                <div className={`flex-1 flex flex-col items-center p-3 sm:p-4 rounded-xl border transition-all ${opponent ? 'bg-secondary/20 border-border/40' : 'bg-background/10 border-dashed border-muted-foreground/20'}`}>
                  {opponent ? (
                    <>
                      <div className="flex items-center gap-1 mb-2">
                        <Shield className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {isHost ? 'Opponent' : 'Host'}
                        </span>
                      </div>
                      <AvatarDisplay profile={opponent} size="lg" className="border-2 border-border mb-2" />
                      <p className="font-bold text-sm sm:text-base truncate w-full text-center">{opponent.username}</p>
                      <Badge variant="outline" className="mt-1.5 text-[10px] px-2 border-border/60 bg-background/50">
                        {opponent.platform}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground mt-1">Div: {opponent.division ?? 'Unranked'}</p>
                      <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                        <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                        {opponent.reputation_score !== undefined ? (opponent.reputation_score * 100).toFixed(0) + '%' : '—'}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-[140px] gap-3 text-muted-foreground">
                      <div className="h-12 w-12 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center animate-pulse">
                        <span className="text-lg">?</span>
                      </div>
                      <p className="text-xs text-center">Waiting for<br/>opponent...</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-2 border-t border-border/30 mt-2 px-4 sm:px-6 py-4">
              {room.status === 'WAITING' && isHost && (
                <>
                  <Button
                    variant="destructive"
                    className="w-full rounded-full font-medium h-10"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate('CLOSED')}
                  >
                    {updateStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Cancel Room
                  </Button>
                  {secsLeft !== null && (
                    <p className={`text-xs text-center ${secsLeft < 60 ? 'text-red-400' : 'text-muted-foreground'}`}>
                      <Clock className="h-3 w-3 inline mr-1" />
                      Auto-closes in {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}
                    </p>
                  )}
                </>
              )}

              {room.status === 'WAITING' && !isHost && (
                <div className="text-center py-2 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 inline mr-1" />
                    Waiting for the host to find an opponent...
                  </p>
                  {secsLeft !== null && (
                    <p className={`text-xs ${secsLeft < 60 ? 'text-red-400' : 'text-muted-foreground/60'}`}>
                      Room expires in {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}
                    </p>
                  )}
                </div>
              )}

              {room.status === 'MATCHED' && (
                <div className="w-full space-y-2">
                  <Button
                    className="w-full h-11 text-base shadow-md rounded-full"
                    disabled={updateStatus.isPending}
                    onClick={() => updateStatus.mutate('PLAYING')}
                  >
                    {updateStatus.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Starting...</> : 'Start Match'}
                  </Button>
                  <p className="text-[10px] text-center text-muted-foreground">Both players can click — confirm when you're ready.</p>
                </div>
              )}

              {room.status === 'PLAYING' && (
                <Button
                  variant="destructive"
                  className="w-full h-11 text-base gap-2 rounded-full shadow-md"
                  disabled={updateStatus.isPending}
                  onClick={() => updateStatus.mutate('RATING')}
                >
                  {updateStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-5 w-5" />}
                  End Match & Rate
                </Button>
              )}

              {room.status === 'RATING' && (
                <div className="w-full space-y-3">
                  <p className="text-sm font-semibold text-center">
                    {myRating ? 'Rating submitted!' : 'Rate your opponent'}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant={myRating?.rating === 'GOOD' ? 'default' : 'secondary'}
                      className={`rounded-xl h-10 text-sm font-medium ${myRating?.rating === 'GOOD' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm' : ''}`}
                      disabled={submitRating.isPending || Boolean(myRating)}
                      onClick={() => submitRating.mutate('GOOD')}
                    >
                      👍 Good
                    </Button>
                    <Button
                      variant={myRating?.rating === 'NEUTRAL' ? 'default' : 'secondary'}
                      className={`rounded-xl h-10 text-sm font-medium ${myRating?.rating === 'NEUTRAL' ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm' : ''}`}
                      disabled={submitRating.isPending || Boolean(myRating)}
                      onClick={() => submitRating.mutate('NEUTRAL')}
                    >
                      😐 OK
                    </Button>
                    <Button
                      variant={myRating?.rating === 'BAD' ? 'destructive' : 'secondary'}
                      className="rounded-xl h-10 text-sm font-medium"
                      disabled={submitRating.isPending || Boolean(myRating)}
                      onClick={() => submitRating.mutate('BAD')}
                    >
                      👎 Bad
                    </Button>
                  </div>
                  {myRating ? (
                    <Button className="w-full rounded-full h-10" onClick={() => navigate('/lobby')}>
                      Return to Lobby
                    </Button>
                  ) : (
                    <p className="text-xs text-center text-muted-foreground">
                      Rate your opponent — you can leave right after.
                    </p>
                  )}
                </div>
              )}
            </CardFooter>
          </Card>
        </div>

        {/* PRIVATE CHAT RIGHT */}
        <div className="lg:col-span-5 h-[420px] lg:h-[calc(100vh-7rem)] min-h-[350px]">
          <Card className="h-full flex flex-col border-border/60 shadow-md">
            <CardHeader className="py-3 px-4 border-b border-border/40 shrink-0">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" /> Private Chat
              </CardTitle>
            </CardHeader>

            <CardContent ref={chatContainerRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-background/20 min-h-0">
              {/* Load older button */}
              {chatHasMore && (
                <div className="flex justify-center pb-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground gap-1 rounded-full"
                    disabled={chatLoadingMore}
                    onClick={loadOlderMessages}
                  >
                    {chatLoadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronUp className="h-3 w-3" />}
                  {chatLoadingMore ? 'Loading...' : 'Load older'}
                  </Button>
                </div>
              )}

              {roomMessages.length === 0 && !chatHasMore ? (
                <div className="h-full flex flex-col justify-center items-center text-muted-foreground opacity-60 gap-2">
                  <MessageCircle className="h-8 w-8" />
                  <p className="text-xs text-center">No messages yet.<br/>Share your eFootball ID to start!</p>
                </div>
              ) : (
                roomMessages.map((message) => {
                  const isMe = message.user_id === session?.user.id
                  return (
                    <div key={message.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] text-muted-foreground mb-0.5 px-1">{message.profiles?.username}</span>
                        <div className={`rounded-2xl px-3 py-1.5 text-sm shadow-sm ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-secondary-foreground rounded-tl-sm border border-border/40'}`}>
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
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendMessage.mutate(chatText) }}>
                <Input
                  className="rounded-full bg-background/50 h-9 text-sm"
                  maxLength={300}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Share eFootball ID or chat..."
                />
                <Button type="submit" size="icon" className="rounded-full h-9 w-9 shrink-0" disabled={!chatText.trim() || sendMessage.isPending}>
                  {sendMessage.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </MobileShell>
  )
}
