import { useNavigate } from 'react-router-dom'
import { Gamepad2, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MobileShell } from '@/components/layout/mobile-shell'
import { supabase } from '@/lib/supabase'

const features = [
  { icon: Users, title: 'Instant Opponents', body: 'Create or join a room and get to kickoff quickly.' },
  { icon: Gamepad2, title: 'Private Match Chat', body: 'Share match code and eFootball IDs in real time.' },
  { icon: ShieldCheck, title: 'Reputation Ratings', body: 'Rate every opponent to keep the community healthy.' },
]

export const LandingPage = () => {
  const navigate = useNavigate()

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/lobby` },
    })

    if (error) {
      alert(error.message)
      return
    }

    navigate('/lobby')
  }

  return (
    <MobileShell>
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-6 text-center shadow-lg">
        <p className="text-sm text-primary">eFootball Match BD</p>
        <h1 className="text-3xl font-bold leading-tight">Find Friendly Matches Instantly</h1>
        <p className="text-sm text-muted-foreground">
          Login, create a room, find an opponent, play, and rate—everything in one flow.
        </p>
        <Button size="lg" className="w-full" onClick={loginWithGoogle}>
          Continue with Google
        </Button>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="h-5 w-5 text-primary" />
              <CardTitle>{title}</CardTitle>
              <CardDescription>{body}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </section>
    </MobileShell>
  )
}
