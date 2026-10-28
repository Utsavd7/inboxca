"use client";
import { useActionState, useEffect, useState } from "react";
import { recoverTwoStep, startEnrollment, verifyTwoStep, type Enrollment, type StepState } from "../../actions";

// With factorId: the person already has an authenticator app; ask for its code.
// Without: show the QR code to scan once, then ask for the first code.
export function TwoStepForm({ factorId, codes = false }: { factorId?: string; codes?: boolean }) {
  const [setup, setSetup] = useState<Enrollment | null>(null);
  const [state, verify, verifying] = useActionState(verifyTwoStep, {} as StepState);
  const [lost, recover, recovering] = useActionState(recoverTwoStep, {} as StepState);

  useEffect(() => {
    if (!factorId) startEnrollment().then(setSetup);
  }, [factorId]);

  if (!factorId && !setup) return <p className="auth-lead">Preparing your setup.</p>;
  if (setup && "error" in setup)
    return (
      <p className="field-error" role="alert">
        {setup.error}
      </p>
    );
  const id = factorId ?? (setup as Exclude<Enrollment, { error: string }>).factorId;

  const fields = (
    <>
      <input type="hidden" name="factorId" value={id} />
      <label htmlFor="code">6 digit code from the app</label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className="num code-input"
        required
        aria-invalid={!!state.error}
        aria-describedby={state.error ? "code-error" : undefined}
      />
      {state.error && (
        <p className="field-error" id="code-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="btn" type="submit" disabled={verifying}>
        {verifying ? "Checking" : "Continue"}
      </button>
    </>
  );

  return (
    <>
    <form action={verify} className="auth-form" noValidate>
      {setup && !("error" in setup) ? (
        <>
          <p className="auth-lead">
            Scan this with an authenticator app, such as Google Authenticator or Microsoft
            Authenticator. You do this once.
          </p>
          <div className="auth-setup">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise */}
            <img className="qr" src={setup.qr} alt="QR code for your authenticator app" width={152} height={152} />
            <div className="auth-form">{fields}</div>
          </div>
          <p className="auth-small">
            Cannot scan? Type this key into the app: <span className="num secret">{setup.secret}</span>
          </p>
        </>
      ) : (
        <>
          <p className="auth-lead">Open your authenticator app and type the code shown for InboxCA.</p>
          {fields}
        </>
      )}
    </form>
    {factorId && !codes && <p className="auth-small">Lost your phone? Ask your firm&apos;s owner for help.</p>}
    {factorId && codes && (
      <details className="auth-small" open={!!lost.error}>
        <summary>Lost your phone? Use a recovery code</summary>
        <form action={recover} className="auth-form">
          <label htmlFor="recovery">Recovery code</label>
          <input id="recovery" name="recovery" autoComplete="off" className="num" required aria-invalid={!!lost.error} aria-describedby={lost.error ? "recovery-error" : undefined} />
          {lost.error && <p className="field-error" id="recovery-error" role="alert">{lost.error}</p>}
          <button className="btn" type="submit" disabled={recovering}>{recovering ? "Checking" : "Use recovery code"}</button>
        </form>
      </details>
    )}
    </>
  );
}
