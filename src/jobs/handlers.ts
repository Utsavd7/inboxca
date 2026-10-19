import { officeHousekeeping } from "./office-housekeeping";
import { calendarTopUp } from "./calendar-top-up";
import { driveCheck } from "./drive-check";
import { drivePurge } from "./drive-purge";
import { fileMail } from "./file-mail";
import { importFiles, undoImport } from "./import-files";
import { noticeFromMail } from "./notice-from-mail";
import { readDocument } from "./read-document";
import { recordsReply } from "./records-reply";
import { sendReminders } from "./reminders";
import { mailPoll } from "./mail-poll";
import { approvalNudge, approvalSummary, notifyDevices, notifyRequest } from "./notify";
import type { Handler } from "./runner";

// Every kind of job and the code that runs it. Each kind is added by the step that
// builds it; a job of a kind not listed here fails with "no_handler".
export const handlers: Record<string, Handler> = { office_housekeeping: officeHousekeeping, calendar_top_up: calendarTopUp, mail_poll: mailPoll, file_mail: fileMail, drive_purge: drivePurge, drive_check: driveCheck, read_document: readDocument, import_files: importFiles, undo_import: undoImport, reminders: sendReminders, records_reply: recordsReply, notice_from_mail: noticeFromMail, notify_request: notifyRequest, notify_devices: notifyDevices, approval_nudge: approvalNudge, approval_summary: approvalSummary };
