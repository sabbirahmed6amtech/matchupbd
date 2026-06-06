import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { MobileShell } from '@/components/layout/mobile-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/domain'

const fetchProfile = async (id: string) => {
  const { data } = await supabase.from('profiles').select('*').eq('id', id).single<Profile>()
  return data
}

export const ProfilePage = () => {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const profileQuery = useQuery({ queryKey: ['profile', id], queryFn: () => fetchProfile(id), enabled: Boolean(id) })

  const profile = profileQuery.data

  if (!profile) {
    return <MobileShell>Loading profile...</MobileShell>
  }

  const reputationPct = Math.round((profile.reputation_score || 0) * 100)

  return (
    <MobileShell>
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Player Profile</h1>
        <Button variant="secondary" onClick={() => navigate('/lobby')}>
          Back to Lobby
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{profile.username}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge>{profile.platform}</Badge>
            <Badge variant="secondary">Division: {profile.division ?? 'Unranked'}</Badge>
            <Badge variant="outline">Country: {profile.country}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Matches Played: {profile.matches_played}</p>
          <p className="text-sm text-muted-foreground">Reputation: {reputationPct}%</p>
          <p className="text-sm text-muted-foreground">eFootball ID: {profile.efootball_id ?? 'Not set'}</p>
          <p className="text-sm text-muted-foreground">Status: {profile.last_seen ? '🟢 Online' : '⚫ Offline'}</p>
        </CardContent>
      </Card>
    </MobileShell>
  )
}
