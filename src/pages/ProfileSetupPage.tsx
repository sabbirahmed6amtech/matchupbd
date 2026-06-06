import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MobileShell } from '@/components/layout/mobile-shell'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { Platform, Profile } from '@/types/domain'
import { trackEvent } from '@/lib/analytics'

const schema = z.object({
  username: z.string().trim().min(3).max(24),
  platform: z.enum(['Mobile', 'PlayStation', 'Xbox', 'PC']),
  efootball_id: z.string().trim().min(3).max(32),
  division: z.string().trim().min(1).max(32),
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
      <Card>
        <CardHeader>
          <CardTitle>Complete your profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-1">
              <Input placeholder="Username" {...register('username')} />
              {errors.username && <p className="text-xs text-red-400">{errors.username.message}</p>}
            </div>
            <div className="space-y-1">
              <select
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                {...register('platform')}
              >
                <option value="Mobile">Mobile</option>
                <option value="PlayStation">PlayStation</option>
                <option value="Xbox">Xbox</option>
                <option value="PC">PC</option>
              </select>
            </div>
            <div className="space-y-1">
              <Input placeholder="eFootball ID" {...register('efootball_id')} />
            </div>
            <div className="space-y-1">
              <Input placeholder="Division" {...register('division')} />
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              Save & Enter Lobby
            </Button>
          </form>
        </CardContent>
      </Card>
    </MobileShell>
  )
}
