import { getAvatarBgGradient, getAvatarEmoji } from '@/lib/avatar'

type Size = 'xs' | 'sm' | 'lg' | 'xl'

const SIZE: Record<Size, { box: string; emoji: string; initial: string }> = {
  xs: { box: 'h-7 w-7',                       emoji: 'text-sm',             initial: 'text-xs'           },
  sm: { box: 'h-9 w-9',                       emoji: 'text-lg',             initial: 'text-sm'           },
  lg: { box: 'h-14 w-14 sm:h-16 sm:w-16',    emoji: 'text-2xl sm:text-3xl', initial: 'text-xl sm:text-2xl' },
  xl: { box: 'h-20 w-20 sm:h-24 sm:w-24',    emoji: 'text-4xl sm:text-5xl', initial: 'text-3xl sm:text-4xl' },
}

interface AvatarProfile {
  username: string
  avatar_preset?: string | null
  avatar_bg?: string | null
}

interface Props {
  profile: AvatarProfile
  size?: Size
  shape?: 'circle' | 'rounded'
  className?: string
}

export const AvatarDisplay = ({ profile, size = 'sm', shape = 'circle', className = '' }: Props) => {
  const s = SIZE[size]
  const emoji = getAvatarEmoji(profile.avatar_preset)
  const shapeClass = shape === 'rounded' ? 'rounded-2xl' : 'rounded-full'

  return (
    <div
      className={`${s.box} ${shapeClass} flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ background: getAvatarBgGradient(profile.avatar_bg) }}
    >
      {emoji ? (
        <span className={s.emoji} style={{ lineHeight: 1 }}>{emoji}</span>
      ) : (
        <span className={`${s.initial} font-black text-white`}>
          {profile.username.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}
