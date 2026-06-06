import { useEffect, useRef, useState } from 'react'
import { Filter } from 'bad-words'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Swords, Flag, MessageCircle, Send, Star, Clock } from 'lucide-react'
import { MobileShell } from '@/components/layout/mobile-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/useAuthStore'
import { supabase } from '@/lib/supabase'
import type { MatchRoom, Rating, RatingValue, RoomMessage } from '@/types/domain'
import { trackEvent } from '@/lib/analytics'

const messageFilter = new Filter()

const fetchRoom = async (roomId: string) => {
  const { data } = await supabase
    .from('match_rooms')
    .select(
      '*, host:profiles!match_rooms_host_id_fkey(id,username,platform,division,reputation_score,matches_played), guest:profiles!match_rooms_guest_id_fkey(id,username,platform,division,reputation_score,matches_played)',
    )
    .eq('id', roomId)
    .single()

  return data as MatchRoom
}

const fetchRoomMessages = async (roomId: string) => {
  const { data } = await supabase
    .from('room_messages')
    .select('*, profiles:profiles(id,username)')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200)
  return (data ?? []) as RoomMessage[]
}

const fetchRatings = async (roomId: string) => {
  const { data } = await supabase.from('ratings').select('*').eq('room_id', roomId)
  return (data ?? []) as Rating[]
}

export const MatchRoomPage = () => {
  const { roomId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuthStore()
  const [chatText, setChatText] = useState('')
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const roomQuery = useQuery({ queryKey: ['room', roomId], queryFn: () => fetchRoom(roomId), enabled: Boolean(roomId) })
  const roomMessagesQuery = useQuery({ queryKey: ['room-messages', roomId], queryFn: () => fetchRoomMessages(roomId), enabled: Boolean(roomId) })
  const ratingsQuery = useQuery({ queryKey: ['room-ratings', roomId], queryFn: () => fetchRatings(roomId), enabled: Boolean(roomId) })

  useEffect(() => {
    const channel = supabase
      .channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rooms', filter: `id=eq.${roomId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['room', roomId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['room-messages', roomId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings', filter: `room_id=eq.${roomId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['room-ratings', roomId] })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, roomId])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [roomMessagesQuery.data])

  const room = roomQuery.data
  const ratings = ratingsQuery.data ?? []

  const me = !room || !session?.user.id ? null : room.host_id === session.user.id ? room.host : room.guest_id === session.user.id ? room.guest : null

  const opponent = !room || !session?.user.id ? null : room.host_id === session.user.id ? room.guest : room.host

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
      trackEvent('rating_submitted', { value })
    },
  })

  const myRating = ratings.find((rating) => rating.from_user_id === session?.user.id)
  const bothRated = ratings.length >= 2

  useEffect(() => {
    if (room?.status === 'CLOSED') {
      navigate('/lobby')
    }
  }, [navigate, room?.status])

  useEffect(() => {
    if (!roomId || !room || room.status !== 'RATING' || !bothRated) return

    const closeRoom = async () => {
      await supabase.rpc('close_room_if_fully_rated', { input_room_id: roomId })
      queryClient.invalidateQueries({ queryKey: ['room', roomId] })
    }

    void closeRoom()
  }, [bothRated, queryClient, room, roomId])

  if (!room) {
    return <MobileShell>Loading room...</MobileShell>
  }

  return (
    <MobileShell>
      <header className="flex items-center justify-between mb-2">
        <Button variant="ghost" size="sm" className="rounded-full gap-2 -ml-3" onClick={() => navigate('/lobby')}>
          <ArrowLeft className="h-4 w-4" /> Lobby
        </Button>
        <Badge variant={room.status === 'WAITING' ? "outline" : room.status === 'PLAYING' ? "default" : "secondary"} className="uppercase tracking-widest text-[10px]">
          {room.status}
        </Badge>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* MATCH DETAILS & PLAYERS (LEFT ON DESKTOP) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <Card className="border-border/60 shadow-lg relative overflow-hidden bg-card/60 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-bold flex items-center justify-center gap-2">
                <Swords className="h-6 w-6 text-primary" /> Match Room
              </CardTitle>
              <CardDescription>Exchange IDs in chat to start the game.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
                {/* Player 1 (Me) */}
                <div className="flex flex-col items-center p-4 rounded-xl bg-secondary/30 w-full sm:w-1/2 border border-border/40">
                  <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center text-2xl font-bold border-2 border-primary/50 text-foreground mb-3">
                    {me?.username?.charAt(0).toUpperCase() ?? '?'}
                  </div>
                  <p className="font-bold text-lg truncate w-full text-center">{me?.username ?? '—'}</p>
                  <Badge variant="outline" className="mt-1 mb-2 bg-background/50 text-xs text-muted-foreground border-border">
                    {me?.platform ?? '—'}
                  </Badge>
                  <p className="text-xs text-muted-foreground">Div: {me?.division ?? 'Unranked'}</p>
                  <div className="flex items-center gap-1 mt-2 text-xs">
                    <Star className="h-3 w-3 text-amber-500 fill-amber-500" /> 
                    {me?.reputation_score !== undefined ? (me.reputation_score * 100).toFixed(0) + '%' : '—'}
                  </div>
                </div>

                <div className="text-sm font-bold text-muted-foreground/50 italic bg-background/80 px-3 py-1 rounded-md border border-border/40 shadow-sm">
                  VS
                </div>

                {/* Player 2 (Opponent) */}
                <div className={`flex flex-col items-center p-4 rounded-xl border border-border/40 w-full sm:w-1/2 transition-colors ${opponent ? 'bg-secondary/30' : 'bg-background/20 border-dashed animate-pulse'}`}>
                  {opponent ? (
                    <>
                      <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center text-2xl font-bold border-2 border-border text-foreground mb-3">
                        {opponent.username?.charAt(0).toUpperCase() ?? '?'}
                      </div>
                      <p className="font-bold text-lg truncate w-full text-center">{opponent.username}</p>
                      <Badge variant="outline" className="mt-1 mb-2 bg-background/50 text-xs text-muted-foreground border-border">
                        {opponent.platform}
                      </Badge>
                      <p className="text-xs text-muted-foreground">Div: {opponent.division ?? 'Unranked'}</p>
                      <div className="flex items-center gap-1 mt-2 text-xs">
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500" /> 
                        {opponent.reputation_score !== undefined ? (opponent.reputation_score * 100).toFixed(0) + '%' : '—'}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-[140px] text-muted-foreground">
                      <div className="h-12 w-12 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center mb-3">
                        <span className="text-xl">?</span>
                      </div>
                      <p className="text-sm">Waiting for opponent...</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2 pt-0 bg-transparent border-t border-border/30 mt-4 px-6 py-4">
              {room.status === 'WAITING' && session?.user.id === room.host_id && (
                <Button variant="destructive" className="w-full sm:w-auto rounded-full font-medium" onClick={() => updateStatus.mutate('CLOSED')}>
                  Cancel Room
                </Button>
              )}
              {room.status === 'MATCHED' && (
                <Button className="w-full text-lg h-12 shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 transition-all rounded-full bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => updateStatus.mutate('PLAYING')}>
                  Start Match
                </Button>
              )}
              {room.status === 'PLAYING' && (
                <Button variant="destructive" className="w-full text-lg h-12 gap-2 shadow-lg shadow-destructive/20 rounded-full" onClick={() => updateStatus.mutate('RATING')}>
                  <Flag className="h-5 w-5" /> End Match & Rate
                </Button>
              )}
              {room.status === 'RATING' && (
                <div className="w-full text-center space-y-4">
                  <p className="text-sm font-medium">How was the opponent?</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant={myRating?.rating === 'GOOD' ? 'default' : 'secondary'} className={`rounded-xl ${myRating?.rating === 'GOOD' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md' : ''}`} onClick={() => submitRating.mutate('GOOD')}>
                      GOOD
                    </Button>
                    <Button variant={myRating?.rating === 'NEUTRAL' ? 'default' : 'secondary'} className={`rounded-xl ${myRating?.rating === 'NEUTRAL' ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md' : ''}`} onClick={() => submitRating.mutate('NEUTRAL')}>
                      NEUTRAL
                    </Button>
                    <Button variant={myRating?.rating === 'BAD' ? 'destructive' : 'secondary'} className={`rounded-xl ${myRating?.rating === 'BAD' ? 'shadow-md' : ''}`} onClick={() => submitRating.mutate('BAD')}>
                      BAD
                    </Button>
                  </div>
                  <p className="w-full text-xs text-muted-foreground flex items-center justify-center gap-1">
                    {bothRated ? 'Closing room...' : <><Clock className="h-3 w-3" /> Waiting for both players to rate.</>}
                  </p>
                </div>
              )}
            </CardFooter>
          </Card>
        </div>

        {/* CHAT (RIGHT ON DESKTOP) */}
        <div className="lg:col-span-5 h-[500px] lg:h-[calc(100vh-8rem)] min-h-[400px]">
          <Card className="h-full flex flex-col border-border/60 shadow-md">
            <CardHeader className="pb-3 border-b border-border/40 py-4 shrink-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" /> Private Chat
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 bg-background/30 max-h-[100%]">
              {(roomMessagesQuery.data ?? []).length === 0 ? (
                <div className="h-full flex flex-col justify-center items-center text-muted-foreground opacity-60">
                  <MessageCircle className="h-8 w-8 mb-2" />
                  <p className="text-xs">No messages yet.</p>
                </div>
              ) : (
                (roomMessagesQuery.data ?? []).map((message) => {
                  const isMe = message.user_id === session?.user.id
                  return (
                    <div key={message.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] text-muted-foreground mb-1 px-1">{message.profiles?.username}</span>
                        <div className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-secondary-foreground rounded-tl-sm border border-border/50'}`}>
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
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendMessage.mutate(chatText); }}>
                <Input
                  className="rounded-full bg-background/50 h-10"
                  maxLength={300}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Share details here..."
                />
                <Button type="submit" size="icon" className="rounded-full h-10 w-10 shrink-0" disabled={!chatText.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </MobileShell>
  )
}
