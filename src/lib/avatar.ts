export const AVATARS = [
  { id: 'football',  emoji: '⚽', label: 'Football'   },
  { id: 'gamepad',   emoji: '🎮', label: 'Gamepad'    },
  { id: 'trophy',    emoji: '🏆', label: 'Trophy'     },
  { id: 'monster',   emoji: '👾', label: 'Monster'    },
  { id: 'lion',      emoji: '🦁', label: 'Lion'       },
  { id: 'dragon',    emoji: '🐉', label: 'Dragon'     },
  { id: 'robot',     emoji: '🤖', label: 'Robot'      },
  { id: 'target',    emoji: '🎯', label: 'Target'     },
  { id: 'gem',       emoji: '💎', label: 'Diamond'    },
  { id: 'lightning', emoji: '⚡', label: 'Lightning'  },
  { id: 'fire',      emoji: '🔥', label: 'Fire'       },
  { id: 'star',      emoji: '🌟', label: 'Star'       },
] as const

export const AVATAR_BGS = [
  { id: 'indigo', gradient: 'linear-gradient(135deg,#6366f1,#8b5cf6)', label: 'Indigo'  },
  { id: 'blue',   gradient: 'linear-gradient(135deg,#3b82f6,#4f46e5)', label: 'Blue'    },
  { id: 'purple', gradient: 'linear-gradient(135deg,#a855f7,#ec4899)', label: 'Purple'  },
  { id: 'green',  gradient: 'linear-gradient(135deg,#10b981,#0d9488)', label: 'Green'   },
  { id: 'red',    gradient: 'linear-gradient(135deg,#f97316,#dc2626)', label: 'Red'     },
  { id: 'amber',  gradient: 'linear-gradient(135deg,#f59e0b,#ea580c)', label: 'Amber'   },
  { id: 'sky',    gradient: 'linear-gradient(135deg,#38bdf8,#06b6d4)', label: 'Sky'     },
  { id: 'rose',   gradient: 'linear-gradient(135deg,#fb7185,#db2777)', label: 'Rose'    },
  { id: 'slate',  gradient: 'linear-gradient(135deg,#64748b,#1e293b)', label: 'Slate'   },
] as const

export type AvatarId  = typeof AVATARS[number]['id']
export type AvatarBgId = typeof AVATAR_BGS[number]['id']

const DEFAULT_GRADIENT = 'linear-gradient(135deg,#6366f1,#8b5cf6)'

export const getAvatarEmoji = (id: string | null | undefined): string | null =>
  id ? (AVATARS.find(a => a.id === id)?.emoji ?? null) : null

export const getAvatarBgGradient = (id: string | null | undefined): string =>
  id ? (AVATAR_BGS.find(b => b.id === id)?.gradient ?? DEFAULT_GRADIENT) : DEFAULT_GRADIENT
