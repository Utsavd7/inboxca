import { headers } from "next/headers";
import { DEMO_PEOPLE, devLoginOpen } from "@/src/lib/dev-login";
import { personName, roleLabel } from "@/src/lib/roles";
import { supabaseServer } from "@/src/lib/supabase";
import styles from "./bar.module.css";

// The developer preview's switcher in the corner of the sign in and app pages: a small chip
// that opens a card with one button for each demo person (route.ts). A native popover, so it
// closes on Escape or a click outside without any browser script. Drawn only when the
// switcher's guards pass.
export async function DevSwitch() {
  if (!devLoginOpen(process.env, (await headers()).get("host"))) return null;
  const { data } = await (await supabaseServer()).auth.getUser();
  const current = Object.entries(DEMO_PEOPLE).find(([, email]) => email === data.user?.email)?.[0];
  return (
    <>
      <button type="button" popoverTarget="dev-switch" className={styles.chip} aria-label="Developer preview: switch demo person">
        <span className={styles.tag}>DEV</span>
        {current ? roleLabel(current) : "Sign in as"}
        <svg className={styles.caret} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 6.5 5 3.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <form id="dev-switch" popover="auto" method="post" action="/dev/switch" className={styles.card} aria-label="Developer preview">
        <p className={styles.title}>Developer preview</p>
        <p className={styles.note}>Demo CA Firm on this laptop only. Never on the live site.</p>
        <div className={styles.people}>
          {Object.entries(DEMO_PEOPLE).map(([role, email]) => {
            const name = role === "owner" ? "Demo owner" : personName(email);
            return (
              <button key={role} type="submit" name="role" value={role} className={styles.person} aria-current={role === current || undefined}>
                <span className={styles.initial} aria-hidden="true">{name[0]}</span>
                <span className={styles.who}>
                  <span className={styles.name}>{name}</span>
                  <span className={styles.role}>{roleLabel(role)}</span>
                </span>
                {role === current && <span className={styles.now}>You</span>}
              </button>
            );
          })}
        </div>
      </form>
    </>
  );
}
