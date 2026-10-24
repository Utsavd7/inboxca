"use client";
import Link from "next/link";
import { useActionState } from "react";
import { SignInForm } from "../sign-in/sign-in-form";
import { signUp, type SignUpState } from "./actions";
import { states } from "./states";

export function SignUpForm() {
  const [state, send, sending] = useActionState(signUp, {} as SignUpState);
  if (state.email) return <SignInForm email={state.email} />;

  return (
    <form action={send} className="auth-form" noValidate>
      <p className="auth-lead">Set up InboxCA for your firm. We will email you a code to sign in.</p>
      <label htmlFor="firm">Firm name</label>
      <input id="firm" name="firm" autoComplete="organization" maxLength={200} defaultValue={state.fields?.firm} required />
      <label htmlFor="email">Your work email</label>
      <input id="email" name="email" type="email" autoComplete="email" defaultValue={state.fields?.email} required />
      <label htmlFor="state">State</label>
      {/* The key brings back the chosen state: React's form reset does not for a select. */}
      <select key={state.fields?.state} id="state" name="state" required defaultValue={state.fields?.state ?? ""}>
        <option value="" disabled>
          Choose your firm&apos;s state
        </option>
        {states.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
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
      <p className="auth-small">
        Already using InboxCA? <Link href="/sign-in">Sign in</Link>
      </p>
    </form>
  );
}
