import { useNavigate } from 'react-router-dom'
import { Gamepad2, ShieldCheck, Users, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
      <section className="flex flex-col items-center justify-center space-y-6 rounded-3xl border border-border/40 bg-card/60 px-4 py-12 text-center shadow-2xl backdrop-blur-sm sm:px-8 sm:py-16">
        <div className="space-y-4">
          <Badge variant="secondary" className="mb-4">eFootball Match BD</Badge>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            Find Friendly <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">Matches Instantly</span>
          </h1>
          <p className="mx-auto max-w-[600px] text-base text-muted-foreground sm:text-lg">
            Login, create a room, find an opponent, play, and rate—everything in one seamless flow designed for mobile and desktop.
          </p>
        </div>
        <Button size="lg" className="w-full max-w-sm gap-2 rounded-full text-base" onClick={loginWithGoogle}>
          <LogIn className="h-5 w-5" /> Continue with Google
        </Button>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="group border-border/50 bg-card/50 transition-colors hover:border-primary/50 hover:bg-card">
            <CardHeader className="flex flex-row items-center gap-4 space-y-0 sm:flex-col sm:items-start sm:gap-2">
              <div className="rounded-xl bg-primary/10 p-3 group-hover:bg-primary/20 transition-colors">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription className="mt-1">{body}</CardDescription>
              </div>
            </CardHeader>
          </Card>
        ))}
      </section>
    </MobileShell>
  )
}
