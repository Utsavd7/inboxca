import { drivePurge } from "./drive-purge";
import { fileMail } from "./file-mail";
import { mailPoll } from "./mail-poll";
import type { Handler } from "./runner";

// Every kind of job and the code that runs it. Each kind is added by the step that
// builds it; a job of a kind not listed here fails with "no_handler".
export const handlers: Record<string, Handler> = { mail_poll: mailPoll, file_mail: fileMail, drive_purge: drivePurge };
