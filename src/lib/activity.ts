// What each line of the firm's activity log says, in plain words: a client's Activity panel,
// Today's "What InboxCA did today" and the bell all read this one list.
export const activityNames: Record<string, string> = {
  "dataset.edit_saved":"Unfinished correction kept", "form.started":"Form preparation started", "form.prepared":"Form prepared", "form.edited_outside":"Corrected form added", "form.downloaded":"Form downloaded for filing", "form.filed":"Form marked filed", "form.approved":"Form approved", "form.rejected":"Form needs a correction",
  "dataset.created": "Figures ready to check", "dataset.checked": "Figure checked", "dataset.changed": "Figure corrected",
  "client.added": "Client added", "client.changed": "Client details changed",
  "registration.added": "Number added", "registration.changed": "Services changed", "registration.removed": "Number removed",
  "assignment.added": "Person or team assigned", "assignment.removed": "Assignment removed",
  "contact_link.added": "Contact linked", "contact_link.changed": "Contact permissions changed", "contact_link.removed": "Contact removed",
  "task.changed": "Return or notice updated", "document.viewed": "Document viewed",
  "document.uploaded": "Document uploaded", "document.filed": "Document filed", "document.renamed": "Document renamed",
  "document.removed": "Document removed", "document.shared": "Document shared", "document.downloaded": "Document downloaded", "share.code_sent": "Code emailed for a private document",
  "document.safety_copy": "Safety copy kept for 30 days", "document.safety_restored": "Put back from the safety copy",
  "reminder.sent": "Reminder sent", "email.changed": "Email label corrected",
  "email.acknowledged": "Files received reply sent", "request.changed": "Request updated", "request.receipt_sent": "Receipt emailed for uploaded papers",
  "email.replied": "Reply sent", "email.written": "Email written to the client",
  "document.added": "Filing record added", "document.virus": "File with a virus kept out", "document.refused": "Unsafe attachment left out", "document.password_saved": "PDF password saved", "request.created": "Papers asked for", "notice.added": "Notice added",
  "lead.added": "Enquiry received", "lead.moved": "Lead moved", "lead.lost": "Lead marked lost", "lead.won": "Lead turned into a client",
  "lead.follow_up_set": "Follow up day set", "lead.followed_up": "Follow up email sent", "lead.noted": "Lead notes changed",
};

// Every action written to activity_log and the details it may carry (PLAN.md 8.0, 8.9): ids,
// counts, codes and setting names, never a client's email, PAN, GSTIN, phone, file contents or a
// token. tests/unit/activity.test.ts (the app's code) and tests/db/security.test.ts (the
// database's functions) fail on an action or a detail missing here.
export const activityDetails: Record<string, readonly string[]> = {
  // Written by the database as rows change (log_change): what changed, or the new row's kind.
  ...Object.fromEntries(["group", "member", "client", "registration", "assignment", "contact", "contact_link", "task", "account", "email", "request"]
    .flatMap((thing) => [[`${thing}.added`, ["kind"]], [`${thing}.removed`, ["kind"]], [`${thing}.changed`, ["changed"]]])),
  "firm.signed_up": ["accepted"], "firm.changed": ["name", "settings"], "firm.downloaded": [], "firm.closed": [], "firm.data_deleted": [],
  "member.invited": ["role"], "member.joined": [], "member.role_changed": ["role"], "member.removed": [], "member.invite_withdrawn": [], "member.restored": [],
  "session.ended_other": ["ended"], "recovery.codes_made": [], "recovery.used": ["left"], "hours.extended": ["until"],
  "admin.passkey_added": [], "admin.passkey_copied": [], "admin.passkey_used": [], "admin.passkeys_removed": ["removed"], "admin.job_retried": ["job"],
  "admin.incident_posted": ["parts", "level"], "admin.incident_updated": [], "admin.incident_closed": [], "admin.incident_emailed": ["firms"],
  "admin.rule_verified": ["code", "period", "by"], "admin.extension_added": ["code", "period", "on"], "admin.office_thresholds": ["taps", "days"], "admin.change_reviewed": ["source", "at"],
  "support.asked": [], "support.approved": [], "support.refused": [], "support.ended": [], "support.viewed": [],
  "office.learned": [], "office.refused": ["reason"], "office.no_fixed": [], "branch.hours": ["settings"],
  ...Object.fromEntries(["on", "off", "forget", "fixed", "here", "confirm", "today", "refuse", "deputies", "follow"].map((decision) => [`office.${decision}`, ["deputies", "co_admin", "branch"]])),
  "device.first_seen": [], "device.approved": ["kind", "until"], "device.refused": [], "device.withdrawn": [], "device.key_added": [], "device.key_synced": [],
  "approval.denied": ["kind"], "capture_attempt": [],
  "permission.asked": ["right", "until"], "permission.allowed": ["right", "for"], "permission.refused": ["right", "for"], "permission.always": ["right", "for", "clients", "until"],
  "permission.undone": ["right", "for"], "permission.withdrawn": [], "permissions.changed": ["permissions"],
  "mailbox.connected": ["provider"], "mailbox.reconnected": ["provider"],
  // Each use and save of a mailbox's sign in token (8.7): never the token itself.
  "mailbox.token_read": ["provider", "why"], "mailbox.token_saved": ["provider", "why"], "mailbox.token_deleted": ["provider", "revoked"], "drive.consent": ["provider", "level", "terms_version"], "drive.folder_order": ["order", "naming"],
  "document.uploaded": [], "document.filed": ["from"], "document.added": ["form", "kind"], "document.renamed": ["from", "to"], "document.removed": ["from"], "document.restored": ["from"],
  "document.viewed": ["thumb"], "document.downloaded": ["stamped", "limit", "sheet", "permission", "zip"], "document.downloaded_by_client": [], "document.sharing": ["policy"],
  "document.shared": ["share", "reply"], "document.missing": [], "document.safety_copy": [], "document.safety_restored": [],
  // The file worker (5.15): the scanner's name for what it found, or why a file was refused.
  "document.virus": ["found"], "document.refused": ["reason"], "document.password_saved": [], "document.changed_outside": ["renamed"], "document.purged": [],
  "share.code_sent": [], "share.approved": [], "share.refused": [], "bulk_send.asked": ["clients", "type", "period"],
  "request.created": [], "request.receipt_sent": [], "import.started": ["files", "scope"], "import.finished": ["files"], "import.undo_asked": [], "import.undone": [],
  "email.acknowledged": ["template"], "email.replied": ["files", "papers"], "email.written": ["to", "files", "papers"],
  // Leads (5.12); ip is the enquiry form sender's keyed digest, never the address.
  "lead.added": ["source", "ip"], "lead.moved": ["stage"], "lead.lost": ["reason"], "lead.won": [], "lead.follow_up_set": ["on"], "lead.followed_up": ["next"],
  "lead.noted": [], "enquiry.dismissed": [], "enquiries.capture": ["on"],
  "reminders.asked": ["what"], "reminder.sent": ["template", "tasks", "requests", "works"], "notice.added": [], "notice.date_confirmed": ["date"],
  "dataset.created": ["dataset", "revision", "entered", "zeroed"], "dataset.checked": ["dataset", "revision", "line", "state"], "dataset.edit_saved": ["dataset", "line"],
  "dataset.changed": ["dataset", "revision", "line", "state", "before", "after", "reason_enc", "registration", "entered", "zeroed"], // before, after and reason encrypted
  "form.started": ["version", "template", "reason_code"], "form.prepared": [], "form.edited_outside": ["version", "template"], "form.approved": [],
  "form.rejected": ["code", "text_enc"], // the reason's code, and its words encrypted
  "form.downloaded": [], "form.filed": ["ack", "paper"],
};
