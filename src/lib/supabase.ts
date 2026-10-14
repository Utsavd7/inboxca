import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/src/db/types";

// Supabase from the server only. The browser never gets a Supabase client or key: every
// sign in step and every read runs in server actions, route handlers and server pages.

function connection(key: "SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_SECRET_KEY") {
  const url = process.env.SUPABASE_URL;
  const value = process.env[key];
  if (!url || !value) throw new Error(`SUPABASE_URL and ${key} must be set`);
  return { url, value };
}

// Acts as the signed in person: row level security applies to everything it reads.
export async function supabaseServer() {
  const store = await cookies();
  const { url, value } = connection("SUPABASE_PUBLISHABLE_KEY");
  return createServerClient<Database>(url, value, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value: cookie, options } of list) store.set(name, cookie, options);
        } catch {
          // A server page cannot set cookies; the proxy refreshes them on the next request.
        }
      },
    },
  });
}

// The server's own access, past row level security. Only for work no person may do
// themselves: creating people, accepting invites, running jobs.
export function supabaseAdmin() {
  const { url, value } = connection("SUPABASE_SECRET_KEY");
  return createClient<Database>(url, value, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
