import { createClient } from "@supabase/supabase-js";

/* The anon key is public by design, because it is baked into the static site.
 * It can read nothing: every table and function of the taste schema needs the
 * shared login (supabase/migrations/001_schema.sql). */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the .env file for local development)");
}

export const supabase = createClient(url, anonKey, { db: { schema: "taste" } });
