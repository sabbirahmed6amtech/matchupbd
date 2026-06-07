import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Gamepad2, Star, Trophy, Shield } from 'lucide-react'
import { MobileShell } from '@/components/layout/mobile-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AvatarDisplay } from '@/components/ui/avatar-display'
import { getAvatarBgGradient } from '@/lib/avatar'
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

  if (profileQuery.isLoading) {
    return (
      <MobileShell>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      </MobileShell>
    )
  }

  if (!profile) {
    return (
      <MobileShell>
        <header className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" className="rounded-full gap-2 -ml-3 h-8" onClick={() => navigate('/lobby')}>
            <ArrowLeft className="h-4 w-4" /> Lobby
          </Button>
        </header>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Shield className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">Profile not found.</p>
          <Button size="sm" className="rounded-full" onClick={() => navigate('/lobby')}>Back to Lobby</Button>
        </div>
      </MobileShell>
    )
  }

  const reputationPct = Math.round((profile.reputation_score || 0) * 100)
  const reputationColor =
    reputationPct >= 80 ? 'bg-emerald-500' : reputationPct >= 50 ? 'bg-amber-500' : 'bg-red-500'
  const reputationLabel =
    reputationPct >= 80 ? 'Great reputation' : reputationPct >= 50 ? 'Average reputation' : 'Needs improvement'

  return (
    <MobileShell>
      <header className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="sm" className="rounded-full gap-2 -ml-3 h-8" onClick={() => navigate('/lobby')}>
          <ArrowLeft className="h-4 w-4" /> Lobby
        </Button>
      </header>

      {/* Hero card */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
        <div
          className="h-20 sm:h-28"
          style={{ background: getAvatarBgGradient(profile.avatar_bg), opacity: 0.85 }}
        />
        <CardContent className="px-5 pb-5 -mt-10 sm:-mt-12">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <AvatarDisplay
              profile={profile}
              size="xl"
              shape="rounded"
              className="border-4 border-card shadow-lg"
            />
            <div className="flex-1 pb-1">
              <h1 className="text-xl sm:text-2xl font-bold leading-tight">{profile.username}</h1>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge className="text-xs">
                  <Gamepad2 className="h-3 w-3 mr-1" />
                  {profile.platform}
                </Badge>
                {profile.division && (
                  <Badge variant="secondary" className="text-xs">
                    Div: {profile.division}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">{profile.country}</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/50 bg-card/40">
          <CardContent className="p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Trophy className="h-3.5 w-3.5" />
              <span className="text-xs">Matches Played</span>
            </div>
            <p className="text-2xl font-bold">{profile.matches_played}</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/40">
          <CardContent className="p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Star className="h-3.5 w-3.5" />
              <span className="text-xs">Reputation</span>
            </div>
            <p className="text-2xl font-bold">{reputationPct}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Reputation bar */}
      <Card className="border-border/50 bg-card/40">
        <CardContent className="p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Reputation Score</p>
            <span className="text-xs text-muted-foreground">{reputationPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${reputationColor}`}
              style={{ width: `${reputationPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
            {reputationLabel}
          </p>
        </CardContent>
      </Card>

      {/* eFootball ID */}
      {profile.efootball_id && (
        <Card className="border-border/50 bg-card/40">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">eFootball ID</p>
            <p className="text-base font-mono font-semibold tracking-wide">{profile.efootball_id}</p>
          </CardContent>
        </Card>
      )}

      {/* Online status */}
      <Card className="border-border/50 bg-card/40">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Status</p>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${profile.last_seen ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
            <p className="text-sm font-medium">{profile.last_seen ? 'Online' : 'Offline'}</p>
          </div>
        </CardContent>
      </Card>
    </MobileShell>
  )
}
