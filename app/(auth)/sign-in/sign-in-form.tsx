"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestCode, verifyCode, type CodeState } from "../actions";
import { ProviderButtons, type ProviderChoice } from "../providers";

// With an email (just signed up, code already sent) it starts at the code step. Google and
// Microsoft lead the first step when they are set up.
export function SignInForm({ email, providers = [] }: { email?: string; providers?: ProviderChoice[] }) {
  const [asked, ask, asking] = useActionState(requestCode, (email ? { step: "code", email } : { step: "email" }) as CodeState);
  const [checked, check, checking] = useActionState(verifyCode, { step: "code" } as CodeState);

  if (asked.step === "email")
    return (
      <>
      <ProviderButtons providers={providers} />
      <form action={ask} className="auth-form" noValidate>
        <p className="auth-lead">We will email you a code. No password needed.</p>
        <label htmlFor="email">Your work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={asked.email}
          required
          aria-invalid={!!asked.error}
          aria-describedby={asked.error ? "email-error" : undefined}
        />
        {asked.error && (
          <p className="field-error" id="email-error" role="alert">
            {asked.error}
          </p>
        )}
        <button className="btn" type="submit" disabled={asking}>
          {asking ? "Sending" : "Email me a code"}
        </button>
        {!email && (
          <p className="auth-small">
            New to InboxCA? <Link href="/sign-up">Set up your firm</Link>
          </p>
        )}
        {/* IT Rules 2021 rule 3(1)(c) and (f): users hear of the terms and what breaking them means. */}
        <p className="auth-small">
          Using InboxCA means following its <Link href="/terms#use">terms</Link> and <Link href="/privacy">privacy policy</Link>. Breaking them or the law can end your access.
        </p>
      </form>
      </>
    );

  const error = checked.error;
  return (
    <form action={check} className="auth-form" noValidate>
      <p className="auth-lead">
        {/* Sign up always sends one, so only the sign in page keeps the "if". */}
        {email ? "A 6 digit code is on its way to " : "If "}<strong>{asked.email}</strong>{email ? "." : " has an InboxCA account, a 6 digit code is on its way."}
        {" "}It works for 10 minutes.
      </p>
      <input type="hidden" name="email" value={asked.email} />
      <label htmlFor="code">Code from the email</label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className="num code-input"
        required
        aria-invalid={!!error}
        aria-describedby={error ? "code-error" : undefined}
      />
      {error && (
        <p className="field-error" id="code-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" type="submit" disabled={checking}>
        {checking ? "Checking" : "Continue"}
      </button>
      <button
        className="text-button"
        type="submit"
        formAction={ask}
        formNoValidate
        disabled={asking}
      >
        Send a new code
      </button>
    </form>
  );
}
