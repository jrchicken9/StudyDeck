/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Set by `scripts/inject-railway-supabase-env.mjs` before `serve` on Railway. */
interface Window {
  __STUDYDECK_SUPABASE__?: { url?: string; anon?: string };
}
