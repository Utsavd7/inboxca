// Reused from the film. Compared with panel 2 of InboxCA-Brand-Kit.png.
export function Logo({ light = false, markOnly = false }: { light?: boolean; markOnly?: boolean }) {
  return <span className={`logo ${light ? "logo-light" : ""}`}>
    <svg className={`mark ${light ? "" : "dark"}`} viewBox="0 0 108 100" width="43" height="40" aria-hidden="true">
      <rect className="tile" x="5" y="5" width="90" height="90" rx="21" />
      <path className="tray" d="M28 45V60a10 10 0 0 0 10 10H62a10 10 0 0 0 10-10V45" />
      <path className="tick" pathLength="100" d="M100 18L40 41L52 57" />
    </svg>{!markOnly && <span>InboxCA</span>}
  </span>;
}
