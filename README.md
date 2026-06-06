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

Also set the same values in your local environment or deployment platform.

For Google OAuth, add these redirect URLs in Supabase Auth settings:

- `http://localhost:5173/lobby`
- `https://your-production-domain/lobby`

### Google OAuth setup

1. Open Google Cloud Console and create or choose a project.
2. Go to APIs & Services > Credentials and create an OAuth 2.0 Client ID.
3. Choose Web application as the application type.
4. Add this authorized redirect URI in Google Cloud:
	- `https://zrmqdxaxhzqjbjwqjkym.supabase.co/auth/v1/callback`
5. Copy the Google Client ID and Client Secret into Supabase Auth > Providers > Google.
6. Turn on the Google provider in Supabase.
7. Save the settings.

If Supabase still shows `Unsupported provider: provider is not enabled`, the Google provider has not been switched on yet, or the client ID and secret have not been saved.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Deploy On Vercel

1. Push this repo to GitHub, GitLab, or Bitbucket.
2. Import the project into Vercel.
3. Keep the default build settings, or set them explicitly to:
	- Build Command: `npm run build`
	- Output Directory: `dist`
4. Add these environment variables in Vercel:
	- `VITE_SUPABASE_URL`
	- `VITE_SUPABASE_ANON_KEY`
5. Deploy and copy the production URL.

For Supabase Google OAuth, add your Vercel production URL to the redirect URLs in Supabase Auth settings, along with any preview or custom domain URLs you plan to use.

This repo includes a Vercel rewrite in `vercel.json` so React Router routes like `/lobby` and `/rooms/:roomId` work on refresh and direct navigation.

## Supabase

This repo already includes the database migration in:

- `supabase/migrations/*.sql` (apply in timestamp order)

### Connect the app

1. Create a Supabase project.
2. Copy the project URL and anon key into `.env`.
3. In Supabase Auth, enable Google sign-in and add the redirect URLs above.

### Run the migration

From the project root:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

If you want to re-apply the database from scratch in a linked project, use:

```bash
supabase db reset
```

If you prefer local CLI helpers through npm scripts, use:

```bash
npm run supabase:login
npm run supabase:link
npm run supabase:db:push
```

## MVP Flow

Login → Complete profile → Enter lobby → Create/join room → Exchange IDs in room chat → End match → Rate opponent → Return to lobby.
