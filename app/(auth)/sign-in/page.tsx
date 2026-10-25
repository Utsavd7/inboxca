import { SignInForm } from "./sign-in-form";

// Why someone is back at sign in, when InboxCA sent them here.
const reasons: Record<string, string> = {
  idle: "You were signed out after a while without activity. Sign in again to carry on.",
  session: "Your firm asks for the 2 step code again after some hours. Sign in again to carry on.",
  link: "That sign in link has expired or was already used. Ask for a new code.",
  country: "Your firm allows InboxCA only from India. Sign in again when you are in India.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      {reason && reasons[reason] && (
        <p className="auth-note" role="status">
          {reasons[reason]}
        </p>
      )}
      <SignInForm />
    </>
  );
}
