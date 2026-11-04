# StudyDeck

Exam practice app: timed quizzes, personal question banks, and a community test library. The UI is a Vite + React app. Accounts and data live in the StudyDeck Supabase project.

## Run locally

Requirements: Node.js 20+.

```bash
cp .env.example .env
```

Set these in `.env`:

- `VITE_SUPABASE_URL` — `https://<project-ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY` — the project’s anon (public) key

Then:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 43123
```

Open http://127.0.0.1:43123

In the Supabase dashboard, Authentication → URL configuration should include this app’s origin (for local work, `http://localhost:43123` and `http://127.0.0.1:43123`) so sign-up confirmation and password reset links return here.

## Production

`railway.toml` starts the built app with `npm start`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_URL` and `SUPABASE_ANON_KEY`) on the Railway service.
