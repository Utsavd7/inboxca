import { Logo } from "./logo";

// The sign in card: sign in, sign up, the 2 step code, and the app's gates for someone not in a
// firm yet. On a wide screen InboxCA's navy band sits beside it, as on a client's upload page.
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-band" aria-hidden>
        <Logo light />
        <p>Every client email, read, filed and answered.</p>
      </div>
      <div className="auth-card">
        <Logo />
        {children}
      </div>
    </main>
  );
}
