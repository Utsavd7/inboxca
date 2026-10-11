"use client";
import { useState, useId } from "react";
import { Check, Mail, Send } from "lucide-react";
import type { Invite } from "@/src/lib/submit-invite";
import { clientRanges } from "@/content/site";
import { contactEmail, inviteEndpoint } from "@/src/lib/site";
export function InviteForm() {
  const id = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { inviteSchema, submitInvite, inviteMailto, sendInvite } =
      await import("@/src/lib/submit-invite");
    const parsed = inviteSchema.safeParse(
      Object.fromEntries(new FormData(form)),
    );
    if (!parsed.success) {
      const next: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        next[String(issue.path[0])] = issue.message;
      });
      setErrors(next);
      form
        .querySelector<HTMLInputElement | HTMLSelectElement>(
          `[name="${Object.keys(next)[0]}"]`,
        )
        ?.focus();
      return;
    }
    setErrors({});
    if (inviteEndpoint) {
      // "Sent" is shown only when the server confirms it. If it does not, the
      // visitor is offered the email draft so the request is not lost.
      setState("sending");
      const saved = await sendInvite(inviteEndpoint, parsed.data);
      setState(saved ? "sent" : "failed");
      if (!saved) setDraft(inviteMailto(parsed.data));
      return;
    }
    setDraft(inviteMailto(parsed.data));
    submitInvite(parsed.data);
  }
  if (state === "sent")
    return (
      <div className="invite-done" role="status">
        <span className="invite-tick">
          <Check size={22} strokeWidth={3} aria-hidden />
        </span>
        <p>
          <strong>We have your request.</strong> We will reply to you by email.
        </p>
      </div>
    );
  const fields: {
    key: keyof Invite;
    label: string;
    autoComplete: string;
    type?: string;
    maxLength: number;
  }[] = [
    { key: "name", label: "Your name", autoComplete: "name", maxLength: 100 },
    {
      key: "firm",
      label: "Firm name",
      autoComplete: "organization",
      maxLength: 150,
    },
    {
      key: "city",
      label: "City",
      autoComplete: "address-level2",
      maxLength: 100,
    },
    {
      key: "email",
      label: "Email",
      autoComplete: "email",
      type: "email",
      maxLength: 254,
    },
  ];
  return (
    <form noValidate onSubmit={submit} className="invite-form">
      <div className="form-fields">
        {fields.map(({ key, label, autoComplete, type, maxLength }) => (
          <div key={key}>
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <input
              required
              id={`${id}-${key}`}
              name={key}
              type={type || "text"}
              autoComplete={autoComplete}
              maxLength={maxLength}
              aria-invalid={!!errors[key]}
              aria-describedby={errors[key] ? `${id}-error-${key}` : undefined}
            />
            {errors[key] && (
              <p role="alert" className="field-error" id={`${id}-error-${key}`}>
                {errors[key]}
              </p>
            )}
          </div>
        ))}
      </div>
      <div>
        <label htmlFor={`${id}-clients`}>Number of clients, roughly</label>
        <select
          required
          defaultValue=""
          name="clients"
          id={`${id}-clients`}
          aria-invalid={!!errors.clients}
          aria-describedby={errors.clients ? `${id}-error-clients` : undefined}
        >
          <option value="" disabled>
            Choose a range
          </option>
          {clientRanges.map((range) => (
            <option key={range}>{range}</option>
          ))}
        </select>
        {errors.clients && (
          <p role="alert" className="field-error" id={`${id}-error-clients`}>
            {errors.clients}
          </p>
        )}
      </div>
      {inviteEndpoint ? (
        <button className="btn" type="submit" disabled={state === "sending"}>
          <Send size={18} aria-hidden="true" />
          {state === "sending" ? "Sending" : "Send request"}
        </button>
      ) : (
        <>
          <button className="btn" type="submit">
            <Mail size={19} aria-hidden="true" />
            Open email draft
          </button>
          <p className="form-note">
            This opens your email app with your answers. You still need to send
            the email.
          </p>
        </>
      )}
      {state === "failed" && draft && (
        <p role="alert" className="draft-note">
          Your request did not go through. <a href={draft}>Send it by email</a>{" "}
          instead, or write to{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      )}
      {state === "idle" && draft && (
        <p role="status" className="draft-note">
          No email has been sent by this page.{" "}
          <a href={draft}>Open the draft again</a>, or email{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      )}
    </form>
  );
}
