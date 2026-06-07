import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { Profile } from '@/types/domain'
import { LandingPage } from '@/pages/LandingPage'
import { ProfileSetupPage } from '@/pages/ProfileSetupPage'
import { LobbyPage } from '@/pages/LobbyPage'
import { MatchRoomPage } from '@/pages/MatchRoomPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { ProfileEditPage } from '@/pages/ProfileEditPage'

const loadProfile = async (userId: string) => {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle<Profile>()
  return data
}

const Authenticated = ({ children }: { children: ReactElement }) => {
  const location = useLocation()
  const { loading, session, profile } = useAuthStore()

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>
  }

  if (!session) {
    return <Navigate to="/" replace />
  }

  if (!profile?.username && location.pathname !== '/profile-setup') {
    return <Navigate to="/profile-setup" replace />
  }

  return children
}

function App() {
  const { setLoading, setSession, setProfile } = useAuthStore()

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return

      setSession(data.session)
      if (data.session?.user) {
        const profile = await loadProfile(data.session.user.id)
        setProfile(profile ?? null)
      } else {
        setProfile(null)
      }
      setLoading(false)
    }

    bootstrap()

    const { data: authSubscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return

      setSession(session)
      if (session?.user) {
        const profile = await loadProfile(session.user.id)
        setProfile(profile ?? null)
      } else {
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      authSubscription.subscription.unsubscribe()
    }
  }, [setLoading, setProfile, setSession])

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/profile-setup"
        element={
          <Authenticated>
            <ProfileSetupPage />
          </Authenticated>
        }
      />
      <Route
        path="/lobby"
        element={
          <Authenticated>
            <LobbyPage />
          </Authenticated>
        }
      />
      <Route
        path="/rooms/:roomId"
        element={
          <Authenticated>
            <MatchRoomPage />
          </Authenticated>
        }
      />
      <Route
        path="/profile/:id"
        element={
          <Authenticated>
            <ProfilePage />
          </Authenticated>
        }
      />
      <Route
        path="/profile-edit"
        element={
          <Authenticated>
            <ProfileEditPage />
          </Authenticated>
        }
      />
      <Route path="*" element={<Navigate to="/lobby" replace />} />
    </Routes>
  )
}

export default App
