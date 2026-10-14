"use client";
import { useActionState } from "react";
import { requestCode, verifyCode, type CodeState } from "../actions";

export function SignInForm() {
  const [asked, ask, asking] = useActionState(requestCode, { step: "email" } as CodeState);
  const [checked, check, checking] = useActionState(verifyCode, { step: "code" } as CodeState);

  if (asked.step === "email")
    return (
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
      </form>
    );

  const error = checked.error;
  return (
    <form action={check} className="auth-form" noValidate>
      <p className="auth-lead">
        If <strong>{asked.email}</strong> has an InboxCA account, a 6 digit code is on its way.
        It works for 10 minutes.
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
