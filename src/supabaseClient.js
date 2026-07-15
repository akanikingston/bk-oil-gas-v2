import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // This shows up in the browser console if the .env.local (or Vercel env vars)
  // haven't been set up yet — see README.md, "Set up Supabase".
  console.warn(
    "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "(see README.md) or the app will not be able to save or load data."
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
