import {regenerateForm} from "./regenerate-form";
import {fillReturn} from "./fill-return";
import {formAck} from "./form-ack";
import { answerMail } from "./answer-mail";
import { bulkSend } from "./bulk-send";
import { readSalesRegister } from "./read-sales";
import { readPortalFile } from "./read-portal";
import { officeHousekeeping } from "./office-housekeeping";
import { calendarTopUp } from "./calendar-top-up";
import { driveCheck } from "./drive-check";
import { driveSetup } from "./drive-setup";
import { drivePurge } from "./drive-purge";
import { deleteFirm } from "./delete-firm";
import { fileMail } from "./file-mail";
import { importFiles, undoImport } from "./import-files";
import { noticeFromMail } from "./notice-from-mail";
import { readDocument } from "./read-document";
import { recordsReply } from "./records-reply";
import { replyWaiting } from "./reply-waiting";
import { sendReminders } from "./reminders";
import { uploadReceipt } from "./upload-receipt";
import { formsWatch } from "./forms-watch";
import { outageEmail } from "./outage-email";
import { mailPoll } from "./mail-poll";
import { approvalNudge, approvalSummary, noticeAlert, returnAlert, mailboxReconnect, notifyDevices, notifyRequest } from "./notify";
import { billingDay, billingReconcile, billingRefund, PAUSED_WHILE_READ_ONLY, pausedWhileReadOnly } from "./billing";
import type { Handler } from "./runner";
import { splitFirms } from "./split-firms";
import { mailHeld, usageAlert } from "./usage-alerts";

// Every kind of job and the code that runs it. Each kind is added by the step that
// builds it; a job of a kind not listed here fails with "no_handler".
export const handlers: Record<string, Handler> = { regenerate_form:regenerateForm, fill_return:fillReturn, form_ack:formAck, read_portal:readPortalFile, read_sales:readSalesRegister, mailbox_reconnect:mailboxReconnect, bulk_send: bulkSend, return_alert: returnAlert, notice_alert: noticeAlert, office_housekeeping: officeHousekeeping, calendar_top_up: calendarTopUp, mail_poll: mailPoll, file_mail: fileMail, drive_purge: drivePurge, drive_check: driveCheck, drive_setup: driveSetup, read_document: readDocument, import_files: importFiles, undo_import: undoImport, reminders: sendReminders, records_reply: recordsReply, answer_mail: answerMail, reply_waiting: replyWaiting, notice_from_mail: noticeFromMail, notify_request: notifyRequest, notify_devices: notifyDevices, approval_nudge: approvalNudge, approval_summary: approvalSummary, forms_watch: formsWatch, delete_firm: deleteFirm, upload_receipt: uploadReceipt, outage_email: outageEmail, billing: billingDay, billing_reconcile: billingReconcile, billing_refund: billingRefund, split_firms: splitFirms, usage_alert: usageAlert, mail_held: mailHeld };
for (const kind of PAUSED_WHILE_READ_ONLY) handlers[kind] = pausedWhileReadOnly(handlers[kind]);
