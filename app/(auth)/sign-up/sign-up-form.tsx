"use client";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { signOut } from "../actions";
import { ProviderButtons, type ProviderChoice } from "../providers";
import { SignInForm } from "../sign-in/sign-in-form";
import { setUpFirm, signUp, type SignUpState } from "./actions";
import { states } from "./states";

// Google and Microsoft lead when they are set up. With an account (back from either, in no
// firm yet) only the firm's details are asked for.
export function SignUpForm({ account, providers, plan }: { account?: string; providers: ProviderChoice[]; plan?: string }) {
  const [state, send, sending] = useActionState(account ? setUpFirm : signUp, {} as SignUpState);
  // The plan chosen on the site waits for the plan and payment step (/start) through the email
  // code, Google or Microsoft and the 2 step setup: plan answers only, for a day.
  useEffect(() => {
    if (plan) document.cookie = `plan_ask=${plan}; path=/; max-age=86400; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  }, [plan]);
  if (state.email) return <SignInForm email={state.email} />;

  return (
    <>
    {providers.length > 0 && <p className="auth-lead">Set up InboxCA for your firm.</p>}
    <ProviderButtons providers={providers} />
    <form action={send} className="auth-form" noValidate>
      <p className="auth-lead">
        {account ? (
          <>
            Signed in as <strong>{account}</strong>. Now add your firm&apos;s details.
          </>
        ) : providers.length ? (
          "We will email you a code to sign in."
        ) : (
          "Set up InboxCA for your firm. We will email you a code to sign in."
        )}
      </p>
      <div className="auth-row">
        <div>
          <label htmlFor="firm">Firm name</label>
          <input id="firm" name="firm" autoComplete="organization" maxLength={200} defaultValue={state.fields?.firm} required />
        </div>
        <div>
          <label htmlFor="state">State</label>
          {/* The key brings back the chosen state: React's form reset does not for a select. */}
          <select key={state.fields?.state} id="state" name="state" required defaultValue={state.fields?.state ?? ""}>
            <option value="" disabled>
              Choose a state
            </option>
            {states.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!account && (
        <>
          <label htmlFor="email">Your work email</label>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={state.fields?.email} required />
        </>
      )}
      <label className="auth-check">
        <input type="checkbox" name="accept" required />
        <span>
          I accept the <Link href="/terms">terms</Link>, the <Link href="/privacy">privacy notice</Link> and
          the <Link href="/dpa">data processing agreement</Link>.
        </span>
      </label>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="btn" type="submit" disabled={sending}>
        {sending ? "Setting up" : "Sign up"}
      </button>
      {account ? (
        <p className="auth-small">Joining a firm that already uses InboxCA? Ask its owner to add {account}, then sign in again.</p>
      ) : (
        <p className="auth-small">
          Already using InboxCA? <Link href="/sign-in">Sign in</Link>
        </p>
      )}
    </form>
    {account && (
      <form action={signOut} className="auth-form">
        <button className="text-button" type="submit">
          Use another account
        </button>
      </form>
    )}
    </>
  );
}
