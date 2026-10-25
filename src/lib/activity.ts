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
  "document.deleted": "Document removed", "document.shared": "Document shared", "document.downloaded": "Document downloaded", "share.code_sent": "Code emailed for a private document",
  "reminder.sent": "Reminder sent", "email.changed": "Email label corrected",
  "email.acknowledged": "Files received reply sent", "request.changed": "Request updated", "request.receipt_sent": "Receipt emailed for uploaded papers",
  "email.replied": "Reply sent", "email.written": "Email written to the client",
  "document.added": "Filing record added", "request.created": "Papers asked for", "notice.added": "Notice added",
};
