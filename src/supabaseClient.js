import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Helpful console hint if env vars weren't set in Netlify / .env
  console.warn(
    "[Kopi Run] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Set them in your .env file (local) and in Netlify > Site settings > Environment variables."
  );
}

export const supabase = createClient(url || "", anon || "");
