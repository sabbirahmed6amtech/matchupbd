import type { PropsWithChildren } from 'react'

export const MobileShell = ({ children }: PropsWithChildren) => (
  <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-6">{children}</div>
)
