import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MobileShell } from '@/components/layout/mobile-shell'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { Platform, Profile } from '@/types/domain'
import { trackEvent } from '@/lib/analytics'

const schema = z.object({
  username: z.string().trim().min(3).max(24),
  platform: z.enum(['Mobile', 'PlayStation', 'Xbox', 'PC']),
  efootball_id: z.string().trim().max(32).optional().or(z.literal('')),
  division: z.string().trim().max(32).optional().or(z.literal('')),
})

type ProfileForm = z.infer<typeof schema>

export const ProfileSetupPage = () => {
  const navigate = useNavigate()
  const { session, setProfile } = useAuthStore()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileForm>({ resolver: zodResolver(schema), defaultValues: { platform: 'Mobile' } })

  const onSubmit = async (values: ProfileForm) => {
    if (!session?.user) return

    const payload = {
      id: session.user.id,
      username: values.username,
      platform: values.platform as Platform,
      efootball_id: values.efootball_id,
      division: values.division,
      country: 'Bangladesh',
      reputation_score: 0,
      matches_played: 0,
      avatar_url: session.user.user_metadata.avatar_url ?? null,
    }

    const { error } = await supabase.from('profiles').upsert(payload)

    if (error) {
      alert(error.message)
      return
    }

    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single<Profile>()
    setProfile(data)
    trackEvent('profile_completed', { platform: values.platform })
    navigate('/lobby')
  }

  return (
    <MobileShell>
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight">Setup Profile</h1>
            <p className="text-sm text-muted-foreground">Complete your player info to enter the matchmaking lobby.</p>
          </div>
          
          <Card className="border-border/50 bg-card/60 shadow-xl backdrop-blur-sm">
            <CardContent className="pt-6">
              <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Username</label>
                  <Input placeholder="In-game or casual name" className="bg-background/50" {...register('username')} />
                  {errors.username && <p className="text-xs text-red-500">{errors.username.message}</p>}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Gaming Platform</label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...register('platform')}
                  >
                    <option value="Mobile">Mobile</option>
                    <option value="PlayStation">PlayStation</option>
                    <option value="Xbox">Xbox</option>
                    <option value="PC">PC</option>
                  </select>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">eFootball ID <span className="text-muted-foreground font-normal">(Optional)</span></label>
                  <Input placeholder="e.g. 123-456-789" className="bg-background/50" {...register('efootball_id')} />
                  {errors.efootball_id && <p className="text-xs text-red-500">{errors.efootball_id.message}</p>}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Current Division <span className="text-muted-foreground font-normal">(Optional)</span></label>
                  <Input placeholder="e.g. Div 1, Unranked" className="bg-background/50" {...register('division')} />
                  {errors.division && <p className="text-xs text-red-500">{errors.division.message}</p>}
                </div>
                
                <Button type="submit" disabled={isSubmitting} className="mt-4 w-full gap-2 rounded-full">
                  Save & Enter Lobby
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </MobileShell>
  )
}
