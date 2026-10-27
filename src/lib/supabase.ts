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
// The signed in person's own connection; `headers` go with every request it makes (the
// office proof, for one).
export async function supabaseServer(headers?: Record<string, string>) {
  const store = await cookies();
  const { url, value } = connection("SUPABASE_PUBLISHABLE_KEY");
  return createServerClient<Database>(url, value, {
    ...(headers && { global: { headers } }),
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

// Acts as nobody, with no cookies: for emailing a sign in code to someone else (an invite)
// without touching the signed in person's own session.
export function supabaseAnonymous() {
  const { url, value } = connection("SUPABASE_PUBLISHABLE_KEY");
  return createClient<Database>(url, value, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The server's own access, past row level security. Only for work no person may do
// themselves: creating people, accepting invites, running jobs. `headers` as for supabaseServer.
export function supabaseAdmin(headers?: Record<string, string>) {
  const { url, value } = connection("SUPABASE_SECRET_KEY");
  return createClient<Database>(url, value, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(headers && { global: { headers } }),
  });
}
