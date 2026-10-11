"use client";
import { useState, useId } from "react";
import { Mail } from "lucide-react";
import type { Invite } from "@/src/lib/submit-invite";
import { clientRanges } from "@/content/site";
import { contactEmail } from "@/src/lib/site";
export function InviteForm() {
  const id = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { inviteSchema, submitInvite, inviteMailto } =
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
    setDraft(inviteMailto(parsed.data));
    submitInvite(parsed.data);
  }
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
      <button className="action" type="submit">
        <Mail size={19} aria-hidden="true" />
        Open email draft
      </button>
      <p className="form-note">
        This opens your email app with your answers. You still need to send the
        email.
      </p>
      {draft && (
        <p role="status" className="draft-note">
          No email has been sent by this page.{" "}
          <a href={draft}>Open the draft again</a>, or email{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      )}
    </form>
  );
}
