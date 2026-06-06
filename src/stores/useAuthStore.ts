import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from '@/types/domain'

type AuthState = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  setLoading: (loading: boolean) => void
  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  loading: true,
  session: null,
  profile: null,
  setLoading: (loading) => set({ loading }),
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
}))
