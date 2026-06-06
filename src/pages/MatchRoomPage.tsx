import { useEffect, useRef, useState } from 'react'
import { Filter } from 'bad-words'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { MobileShell } from '@/components/layout/mobile-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Match Room</h1>
          <p className="text-xs text-muted-foreground">Status: {room.status}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/lobby')}>
          Lobby
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Opponent Info</CardTitle>
          <CardDescription>Exchange eFootball IDs and match code in chat.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-medium">You: {me?.username ?? '—'}</p>
              <p className="text-xs text-muted-foreground">{me?.platform ?? '—'} • {me?.division ?? 'Unranked'}</p>
            </div>
            <Badge variant="secondary">Ready</Badge>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-medium">Opponent: {opponent?.username ?? 'Waiting for player...'}</p>
              <p className="text-xs text-muted-foreground">{opponent?.platform ?? '—'} • {opponent?.division ?? '—'}</p>
            </div>
            <Badge>{opponent ? 'Connected' : 'Waiting'}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Room Chat</CardTitle>
          <CardDescription>Private realtime chat • max 300 chars</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="h-[280px] space-y-2 overflow-y-auto rounded-lg border border-border/50 p-2">
            {(roomMessagesQuery.data ?? []).map((message) => (
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
              onChange={(event) => setChatText(event.target.value)}
              placeholder="Share eFootball ID / match code"
            />
            <Button disabled={!chatText.trim()} onClick={() => sendMessage.mutate(chatText)}>
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Match Flow</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {room.status === 'MATCHED' && (
            <Button variant="secondary" onClick={() => updateStatus.mutate('PLAYING')}>
              Start Match
            </Button>
          )}
          {room.status === 'PLAYING' && (
            <Button variant="destructive" onClick={() => updateStatus.mutate('RATING')}>
              End Match
            </Button>
          )}
          {room.status === 'RATING' && (
            <>
              <Button variant={myRating?.rating === 'GOOD' ? 'default' : 'secondary'} onClick={() => submitRating.mutate('GOOD')}>
                GOOD
              </Button>
              <Button
                variant={myRating?.rating === 'NEUTRAL' ? 'default' : 'secondary'}
                onClick={() => submitRating.mutate('NEUTRAL')}
              >
                NEUTRAL
              </Button>
              <Button variant={myRating?.rating === 'BAD' ? 'destructive' : 'secondary'} onClick={() => submitRating.mutate('BAD')}>
                BAD
              </Button>
              <p className="w-full text-xs text-muted-foreground">
                {bothRated ? 'Both players rated. Closing room...' : 'Waiting for both players to rate.'}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </MobileShell>
  )
}
