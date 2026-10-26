import { isProvider, providerChoices, providers } from "@/src/lib/sign-in";
import { SignInForm } from "./sign-in-form";

// Why someone is back at sign in, when InboxCA sent them here.
const reasons: Record<string, string> = {
  idle: "You were signed out after a while without activity. Sign in again to carry on.",
  session: "Your firm asks for the 2 step code again after some hours. Sign in again to carry on.",
  link: "That sign in link has expired or was already used. Ask for a new code.",
  country: "Your firm allows InboxCA only from India. Sign in again when you are in India.",
  mailbox: "The firm's email address cannot be used to sign in.",
};
// Why Google or Microsoft did not sign the person in (app/auth/callback).
const refusals: Record<string, (name: string) => string> = {
  cancelled: (name) => `Sign in with ${name} was cancelled. Try again, or use your email.`,
  unverified: (name) => `${name} has not confirmed this email address. Use your email instead.`,
  provider: (name) => `Sign in with ${name} did not work. Try again, or use your email.`,
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ reason?: string; via?: string }> }) {
  const { reason = "", via } = await searchParams;
  const note = Object.hasOwn(reasons, reason) ? reasons[reason] : Object.hasOwn(refusals, reason) ? refusals[reason](providers[isProvider(via) ? via : "google"].name) : null;
  return (
    <>
      <h1>Sign in</h1>
      {note && (
        <p className="auth-note" role="status">
          {note}
        </p>
      )}
      <SignInForm providers={providerChoices()} />
    </>
  );
}
