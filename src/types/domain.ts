export type Platform = 'Mobile' | 'PlayStation' | 'Xbox' | 'PC'
export type RoomStatus = 'WAITING' | 'MATCHED' | 'PLAYING' | 'RATING' | 'CLOSED'
export type RatingValue = 'GOOD' | 'NEUTRAL' | 'BAD'

export type Profile = {
  id: string
  username: string
  avatar_url: string | null
  avatar_preset: string | null
  avatar_bg: string | null
  country: string
  platform: Platform
  efootball_id: string | null
  favorite_team: string | null
  division: string | null
  reputation_score: number
  matches_played: number
  created_at: string
  last_seen: string | null
}

export type ChatMessage = {
  id: string
  user_id: string
  message: string
  created_at: string
  profiles?: Pick<Profile, 'id' | 'username' | 'avatar_url' | 'platform'>
}

export type MatchRoom = {
  id: string
  host_id: string
  guest_id: string | null
  platform: Platform
  division: string | null
  status: RoomStatus
  created_at: string
  closed_at: string | null
  expires_at: string
  host?: Pick<Profile, 'id' | 'username' | 'platform' | 'division' | 'reputation_score' | 'avatar_preset' | 'avatar_bg'>
  guest?: Pick<Profile, 'id' | 'username' | 'platform' | 'division' | 'reputation_score' | 'avatar_preset' | 'avatar_bg'>
}

export type RoomMessage = {
  id: string
  room_id: string
  user_id: string
  message: string
  created_at: string
  profiles?: Pick<Profile, 'id' | 'username'>
}

export type Rating = {
  id: string
  room_id: string
  from_user_id: string
  to_user_id: string
  rating: RatingValue
  created_at: string
}
