import { crc32, deflateRawSync } from "node:zlib";
import { serverCrypto } from "./crypto";

type Export = {
  clients: { id: string; name: string; kind: string; email_enc: string | null; archived_at: string | null }[];
  registrations: { client_id: string; kind: string; number_enc: string; state_code: string | null }[];
  tasks: { client_id: string; kind: string; code: string | null; period_key: string | null; due_on: string; status: string }[];
  documents: { client_id: string; name: string; document_type: string; work_type: string; period_key: string | null; status: string; received_at: string }[];
  activity: { at: string; email: string | null; action: string; entity_type: string | null; entity_id: string | null; details: unknown }[];
};

// One spreadsheet row. A cell that starts like a formula is kept as text.
const row = (cells: unknown[]) =>
  cells.map((cell) => {
    const text = cell == null ? "" : typeof cell === "string" ? cell : JSON.stringify(cell);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }).join(",");
export const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map(row).join("\r\n") + "\r\n";

// A ZIP of the given files, each compressed: text, or the bytes of a paper.
export function zip(files: { name: string; text: string | Uint8Array }[]) {
  const parts: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), bytes = Buffer.from(file.text), compressed = deflateRawSync(bytes), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); local.copy(central, 6, 4, 30); central.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed); directory.push(central, name); offset += local.length + name.length + compressed.length;
  }
  const end = Buffer.alloc(22), index = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, index, end]);
}

// The owner's download (PLAN.md 5.5.1): the client list, returns and notices, the list of
// papers and the activity log, as CSV files. The papers themselves stay in the firm's drive.
export async function firmDownload(firmId: string, data: Export) {
  const crypto = serverCrypto();
  const names = new Map(data.clients.map((client) => [client.id, client.name]));
  const numbers = new Map<string, string[]>();
  for (const registration of data.registrations) {
    const number = await crypto.decrypt(firmId, `clients/${registration.client_id}/${registration.kind}`, registration.number_enc);
    numbers.set(registration.client_id, [...(numbers.get(registration.client_id) ?? []), `${registration.kind.toUpperCase()} ${number}`]);
  }
  const clients = await Promise.all(data.clients.map(async (client) => [
    client.name, client.kind, client.email_enc && (await crypto.decrypt(firmId, `clients/${client.id}/email`, client.email_enc)),
    (numbers.get(client.id) ?? []).join("; "), client.archived_at?.slice(0, 10),
  ]));
  return zip([
    { name: "clients.csv", text: csv(["Client", "Kind", "Email", "Numbers", "Archived on"], clients) },
    { name: "returns-and-notices.csv", text: csv(["Client", "Return or notice", "Form", "Period", "Due on", "Status"],
      data.tasks.map((task) => [names.get(task.client_id), task.kind === "notice" ? "Notice" : "Return", task.code, task.period_key, task.due_on, task.status])) },
    { name: "papers.csv", text: csv(["Client", "File name", "Type", "Work", "Period", "Status", "Received"],
      data.documents.map((document) => [names.get(document.client_id), document.name, document.document_type, document.work_type, document.period_key, document.status, document.received_at])) },
    { name: "activity-log.csv", text: csv(["When", "Person", "Action", "About", "Record", "Details"],
      data.activity.map((entry) => [entry.at, entry.email, entry.action, entry.entity_type, entry.entity_id, entry.details])) },
  ]);
}
