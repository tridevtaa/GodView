import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Set them in frontend/.env before starting Vite.");
}

const make = () =>
  createClient(url, key, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

// In development, a hot reload can run this file again. A second client
// starts without the signed-in session, so screens load nothing ("Couldn't
// load students"). Keep one client for the life of the page. Production
// builds never hot reload, so they just make one.
export const supabase = import.meta.hot ? (globalThis.__godviewSupabase ??= make()) : make();
