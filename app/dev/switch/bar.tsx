import { headers } from "next/headers";
import { DEMO_PEOPLE, devLoginOpen } from "@/src/lib/dev-login";
import { roleLabel } from "@/src/lib/roles";

// The developer preview's bar at the foot of the sign in and app pages: one button for each demo
// person (route.ts). Drawn only when the switcher's guards pass.
export async function DevSwitch() {
  if (!devLoginOpen(process.env, (await headers()).get("host"))) return null;
  return (
    <form method="post" action="/dev/switch" aria-label="Developer preview" style={{ position: "fixed", left: "50%", bottom: 8, transform: "translateX(-50%)", zIndex: 50, display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 8, background: "#0b1f3a", color: "#fff", fontSize: 12, whiteSpace: "nowrap", boxShadow: "0 4px 16px rgb(11 31 58 / 0.25)" }}>
      <span>Developer preview, demo firm only. Sign in as</span>
      {Object.keys(DEMO_PEOPLE).map((role) => (
        <button key={role} type="submit" name="role" value={role} style={{ border: 0, borderRadius: 6, padding: "3px 8px", background: "#1a4bb0", color: "#fff", font: "inherit", cursor: "pointer" }}>
          {roleLabel(role)}
        </button>
      ))}
    </form>
  );
}
