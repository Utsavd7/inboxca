"use client";
import { useActionState } from "react";
import { clientKinds } from "@/src/lib/clients";
import { services, urgencies } from "@/src/lib/leads";
import { Pending } from "../pending";

export type LeadState = { error?: string; values?: Record<string, string> };

// An enquiry's fields, for the firm's public form and for Add a lead. A refused one comes
// back with what was typed, and why.
export function LeadForm({ action, hidden, submit, busy, open = false, today }: { action: (state: LeadState, form: FormData) => Promise<LeadState>; hidden: Record<string, string>; submit: string; busy: string; open?: boolean; today?: string }) {
  const [state, send] = useActionState(action, {});
  const typed = state.values ?? {};
  return (
    <form key={JSON.stringify(typed)} action={send} className={open ? "public-card public-form" : "fields lead-form"} noValidate>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div>
        <label htmlFor="lead-name">{open ? "Your name" : "Name"}</label>
        <input id="lead-name" name="name" required maxLength={200} autoComplete={open ? "name" : "off"} defaultValue={typed.name} />
      </div>
      <div>
        <label htmlFor="lead-email">{open ? "Your email" : "Email"}</label>
        <input id="lead-email" name="email" type="email" required={open} maxLength={254} autoComplete={open ? "email" : "off"} defaultValue={typed.email} />
      </div>
      <div>
        <label htmlFor="lead-phone">{open ? "Phone, if you like" : "Phone"}</label>
        <input id="lead-phone" name="phone" type="tel" maxLength={20} autoComplete={open ? "tel" : "off"} defaultValue={typed.phone} />
      </div>
      <div>
        <label htmlFor="lead-service">{open ? "What do you need help with?" : "Help needed"}</label>
        <select id="lead-service" name="service" defaultValue={typed.service ?? "itr"}>
          {Object.entries(services).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="lead-kind">{open ? "The work is for" : "Kind"}</label>
        <select id="lead-kind" name="kind" defaultValue={typed.kind ?? "individual"}>
          {Object.entries(clientKinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="lead-urgency">When is it needed?</label>
        <select id="lead-urgency" name="urgency" defaultValue={typed.urgency ?? "month"}>
          {Object.entries(urgencies).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {today && (
        <div>
          <label htmlFor="lead-follow">Follow up on</label>
          <input id="lead-follow" name="follow_up" type="date" defaultValue={typed.follow_up ?? today} />
        </div>
      )}
      <div className="lead-wide">
        <label htmlFor="lead-message">{open ? "Anything else we should know?" : "Notes"}</label>
        <textarea id="lead-message" name="message" rows={3} maxLength={1000} defaultValue={typed.message} />
      </div>
      {open && (
        // Left empty by people, who never see it; filled by bots.
        <div className="public-hp" aria-hidden>
          <label htmlFor="lead-website">Leave this empty</label>
          <input id="lead-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
      )}
      {state.error && (
        <p className="alert lead-wide" role="alert">
          {state.error}
        </p>
      )}
      <Pending className={`b b-primary${open ? " public-download" : ""}`} busy={busy}>
        {submit}
      </Pending>
    </form>
  );
}
