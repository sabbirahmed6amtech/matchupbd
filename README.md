# eFootball Match BD (MVP)

Mobile-first matchmaking web app for eFootball players.

## Stack

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui-style components
- Zustand
- TanStack Query
- React Hook Form + Zod
- Supabase Auth / Database / Realtime / Presence

## Environment

Create `.env` with:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Commands

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Supabase

SQL schema and policies are in:

- `supabase/migrations/*.sql` (apply in timestamp order)

Apply migration in your Supabase project before running the app.

## MVP Flow

Login → Complete profile → Enter lobby → Create/join room → Exchange IDs in room chat → End match → Rate opponent → Return to lobby.
