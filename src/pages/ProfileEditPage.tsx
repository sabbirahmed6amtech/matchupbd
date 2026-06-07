import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AvatarDisplay } from '@/components/ui/avatar-display'
import { MobileShell } from '@/components/layout/mobile-shell'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { AVATARS, AVATAR_BGS } from '@/lib/avatar'
import type { Platform, Profile } from '@/types/domain'

const DIVISIONS = ['Div 1', 'Div 2', 'Div 3', 'Div 4', 'Div 5', 'Div 6', 'Div 7', 'Div 8', 'Div 9'] as const

const schema = z.object({
  username: z.string().trim().min(3).max(24),
  platform: z.enum(['Mobile', 'PlayStation', 'Xbox', 'PC']),
  efootball_id: z.string().trim().max(32).optional().or(z.literal('')),
  division: z.string().optional(),
  avatar_preset: z.string().optional(),
  avatar_bg: z.string().optional(),
})

type ProfileEditForm = z.infer<typeof schema>

export const ProfileEditPage = () => {
  const navigate = useNavigate()
  const { session, profile, setProfile } = useAuthStore()

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<ProfileEditForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      username:       profile?.username       ?? '',
      platform:       profile?.platform       ?? 'Mobile',
      efootball_id:   profile?.efootball_id   ?? '',
      division:       profile?.division       ?? '',
      avatar_preset:  profile?.avatar_preset  ?? '',
      avatar_bg:      profile?.avatar_bg      ?? '',
    },
  })

  const previewProfile = {
    username:      watch('username') || 'P',
    avatar_preset: watch('avatar_preset') || null,
    avatar_bg:     watch('avatar_bg')     || null,
  }

  const onSubmit = async (values: ProfileEditForm) => {
    if (!session?.user) return

    const { error } = await supabase
      .from('profiles')
      .update({
        username:      values.username,
        platform:      values.platform as Platform,
        efootball_id:  values.efootball_id  || null,
        division:      values.division      || null,
        avatar_preset: values.avatar_preset || null,
        avatar_bg:     values.avatar_bg     || null,
      })
      .eq('id', session.user.id)

    if (error) { alert(error.message); return }

    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single<Profile>()
    setProfile(data)
    navigate('/lobby')
  }

  return (
    <MobileShell>
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-full max-w-md space-y-6">

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="rounded-full gap-2 -ml-3 h-8" onClick={() => navigate('/lobby')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Edit Profile</h1>
            <p className="text-sm text-muted-foreground">Update your player information and avatar.</p>
          </div>

          {/* Live avatar preview */}
          <div className="flex justify-center py-2">
            <AvatarDisplay profile={previewProfile} size="xl" shape="rounded" className="shadow-xl" />
          </div>

          <Card className="border-border/50 bg-card/60 shadow-xl backdrop-blur-sm">
            <CardContent className="pt-6">
              <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>

                {/* Avatar selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Avatar</label>
                  <div className="grid grid-cols-6 gap-2">
                    {AVATARS.map((a) => {
                      const selected = watch('avatar_preset') === a.id
                      return (
                        <button
                          key={a.id}
                          type="button"
                          title={a.label}
                          onClick={() => setValue('avatar_preset', selected ? '' : a.id)}
                          className={`h-11 w-full rounded-xl text-2xl flex items-center justify-center transition-all
                            ${selected
                              ? 'ring-2 ring-primary bg-primary/10 scale-105 shadow-sm'
                              : 'border border-border bg-secondary/30 hover:bg-secondary/60'}`}
                        >
                          {a.emoji}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Background selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Avatar Background</label>
                  <div className="grid grid-cols-9 gap-1.5">
                    {AVATAR_BGS.map((bg) => {
                      const selected = watch('avatar_bg') === bg.id
                      return (
                        <button
                          key={bg.id}
                          type="button"
                          title={bg.label}
                          onClick={() => setValue('avatar_bg', selected ? '' : bg.id)}
                          className={`h-8 rounded-lg transition-all ${selected ? 'ring-2 ring-primary ring-offset-2 scale-110 shadow-sm' : 'opacity-80 hover:opacity-100'}`}
                          style={{ background: bg.gradient }}
                        />
                      )
                    })}
                  </div>
                </div>

                <div className="border-t border-border/40 pt-4 space-y-4">
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
                    <label className="text-sm font-medium leading-none">
                      eFootball ID <span className="text-muted-foreground font-normal">(Optional)</span>
                    </label>
                    <Input placeholder="e.g. 123-456-789" className="bg-background/50" {...register('efootball_id')} />
                    {errors.efootball_id && <p className="text-xs text-red-500">{errors.efootball_id.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none">
                      Current Division <span className="text-muted-foreground font-normal">(Optional)</span>
                    </label>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background/50 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      {...register('division')}
                    >
                      <option value="">— Select Division —</option>
                      {DIVISIONS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <Button type="submit" disabled={isSubmitting} className="w-full gap-2 rounded-full">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </Button>
              </form>
            </CardContent>
          </Card>

        </div>
      </div>
    </MobileShell>
  )
}
