// Fills the local demo firm (npm run demo) with invented data, so every page has
// something to show: clients with their numbers and services, filed and overdue returns,
// teams, branches, people, contacts and sorted client mail. Every name, number and email
// here is made up. When the demo firm has a drive connected, invented client papers that look
// like the real ones (scripts/demo-files.mts) are saved into its client folders there, as
// InboxCA would file them from client mail; more papers come by email (npm run demo:mail). Run with `npm run demo:data` after `npm run demo`; running it again
// replaces the demo firm's data with a fresh copy.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !process.env[line.slice(0, at)]) process.env[line.slice(0, at)] = line.slice(at + 1);
}
const { default: pg } = await import("pg");
const { createClient } = await import("@supabase/supabase-js");
const { accountIdentity, numberIdentity, serverCrypto } = await import("../src/lib/crypto");
const { describeFile, filePeriod } = await import("../src/lib/documents");
const { fileName, folderPath } = await import("../src/lib/drive");
const { openDrive } = await import("../src/lib/drive-account");
const { demoFiles, gstin } = await import("./demo-files.mts");
const { DEMO_PEOPLE, demoKeyName } = await import("../src/lib/dev-login");


type Client = { name: string; kind: string; email?: string; pan: string; gst?: [string, string[]]; tan?: string[]; panServices?: string[]; llpin?: [string, string[]]; group?: string; branch?: string };
const clients: Client[] = [
  { name: "Mehta Traders", kind: "business", email: "accounts@mehtatraders.example", pan: "ZZZFZ0101Z", gst: ["24", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], tan: ["TDS_PAY", "TDS_RET"], branch: "Ahmedabad" },
  { name: "Shah & Sons", kind: "business", email: "shahandsons@example.in", pan: "ZZZFZ0102Z", gst: ["24", ["GSTR1_Q", "GSTR3B_Q", "PMT06"]], branch: "Ahmedabad" },
  { name: "Patel Textiles Pvt Ltd", kind: "company", email: "finance@pateltextiles.example", pan: "ZZZCZ0103Z", gst: ["24", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], tan: ["TDS_PAY", "TDS_RET"], group: "Patel group", branch: "Surat" },
  { name: "Patel Exim LLP", kind: "llp", email: "exim@pateltextiles.example", pan: "ZZZFZ0104Z", gst: ["24", ["GSTR1_M", "GSTR3B_M"]], llpin: ["AAB-1234", ["LLP11", "LLP8"]], group: "Patel group", branch: "Surat" },
  { name: "Rajesh Desai", kind: "individual", email: "rajesh.desai@example.in", pan: "ZZZPZ0105Z", panServices: ["ITR_NA", "ADV_TAX"], group: "Desai family", branch: "Ahmedabad" },
  { name: "Meena Desai", kind: "individual", email: "meena.desai@example.in", pan: "ZZZPZ0106Z", panServices: ["ITR_NA"], group: "Desai family", branch: "Ahmedabad" },
  { name: "Kapoor Enterprises", kind: "tax_audit", email: "kapoor.ent@example.in", pan: "ZZZFZ0107Z", gst: ["27", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], panServices: ["TAX_AUDIT", "ITR_AUDIT"], tan: ["TDS_PAY", "TDS_RET"], branch: "Ahmedabad" },
  { name: "Iyer Consultants", kind: "individual", email: "iyer.consult@example.in", pan: "ZZZPZ0108Z", panServices: ["ITR_BIZ", "ADV_TAX"], gst: ["24", ["GSTR1_Q", "GSTR3B_Q", "PMT06"]], branch: "Ahmedabad" },
  { name: "S.K. Builders", kind: "business", email: "skbuilders@example.in", pan: "ZZZFZ0109Z", gst: ["24", ["GSTR1_M", "GSTR3B_M"]], tan: ["TDS_PAY", "TDS_RET"], branch: "Surat" },
  { name: "Trivedi Foods", kind: "business", email: "trivedi.foods@example.in", pan: "ZZZFZ0110Z", gst: ["24", ["CMP08", "GSTR4"]], branch: "Surat" },
  { name: "Bhatt Dental Clinic", kind: "individual", email: "dr.bhatt@example.in", pan: "ZZZPZ0111Z", panServices: ["ITR_BIZ", "ADV_TAX"], branch: "Ahmedabad" },
  { name: "Rao Exports Pvt Ltd", kind: "company", email: "accounts@raoexports.example", pan: "ZZZCZ0112Z", gst: ["24", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], tan: ["TDS_PAY", "TDS_RET"], branch: "Ahmedabad" },
  { name: "Nair Charitable Trust", kind: "trust", email: "trustee@nairtrust.example", pan: "ZZZTZ0113Z", panServices: ["ITR_NA"], branch: "Ahmedabad" },
];
const people = [
  [DEMO_PEOPLE.partner, "partner", null],
  [DEMO_PEOPLE.manager, "manager", "GST team"],
  [DEMO_PEOPLE.staff, "staff", "GST team"],
  ["anita.staff@demo.inboxca.test", "staff", "Income tax team"],
  [DEMO_PEOPLE.front_desk, "front_desk", null],
] as const;

const db = new pg.Client({ connectionString: process.env.TEST_DB_URL });
await db.connect();
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const crypto = serverCrypto();
const [firmRow] = (
  await db.query("select m.firm_id from public.firm_members m join auth.users u on u.id = m.user_id where u.email = 'demo-owner@inboxca.test'")
).rows;
if (!firmRow) throw new Error("Run npm run demo first.");
const firm: string = firmRow.firm_id;

// Start clean, keeping the firm, its owner and any connected drive.
await db.query("begin");
await db.query("delete from public.email_events where firm_id = $1", [firm]);
await db.query("delete from public.requests where firm_id = $1", [firm]);
await db.query("delete from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm]);
await db.query("delete from public.contacts where firm_id = $1", [firm]);
await db.query("delete from public.clients where firm_id = $1", [firm]);
await db.query("delete from public.firm_members where firm_id = $1 and role <> 'owner'", [firm]);
await db.query("delete from public.groups where firm_id = $1", [firm]);
await db.query("commit");

const group = async (kind: string, name: string) =>
  (await db.query("insert into public.groups (firm_id, kind, name) values ($1, $2, $3) returning id", [firm, kind, name])).rows[0].id as string;
const groups = new Map<string, string>();
for (const [kind, name] of [["team", "GST team"], ["team", "Income tax team"], ["branch", "Ahmedabad"], ["branch", "Surat"], ["client_group", "Patel group"], ["client_group", "Desai family"]])
  groups.set(name, await group(kind, name));

// The firm's people. One of each role signs in (src/lib/dev-login.ts) with their own 2 step key,
// written to .env.local as DEMO_<ROLE>_TOTP and never printed (npm run demo:code <role> shows
// the code); kept once made, so an authenticator app set up with it keeps working.
const staff = new Map<string, string>();
const newKeys: string[] = [];
for (const [email, role, team] of people) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = data.users.find((u) => u.email === email);
  if (!user) user = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user!;
  await db.query("insert into public.firm_members (firm_id, user_id, role, status, team_id, branch_id) values ($1, $2, $3, 'active', $4, $5)", [
    firm, user.id, role, team ? groups.get(team) : null, groups.get("Ahmedabad"),
  ]);
  staff.set(email, user.id);
  if (DEMO_PEOPLE[role] !== email) continue;
  const name = demoKeyName(role);
  const key = process.env[name] ?? Array.from(randomBytes(16), (byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte % 32]).join("");
  if (!process.env[name]) newKeys.push(`${name}=${key}`);
  if ((await db.query("select 1 from auth.mfa_factors where user_id = $1 and secret = $2 and status = 'verified'", [user.id, key])).rowCount) continue;
  await db.query("delete from auth.mfa_factors where user_id = $1", [user.id]);
  await db.query(
    "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), $1, 'Demo app', 'totp', 'verified', $2, now(), now())",
    [user.id, key],
  );
}
if (newKeys.length) writeFileSync(".env.local", readFileSync(".env.local", "utf8").replace(/\n?$/, "\n") + newKeys.join("\n") + "\n");

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const ids = new Map<string, string>();
for (const client of clients) {
  const id = randomUUID();
  ids.set(client.name, id);
  await db.query(
    "insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx, group_id, branch_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, firm, client.name, client.kind, client.email ? await crypto.encrypt(firm, `clients/${id}/email`, client.email) : null, client.email ? await crypto.blindIndex(firm, "email", client.email) : null, client.group ? groups.get(client.group) : null, client.branch ? groups.get(client.branch) : null],
  );
  const numbers: [string, string, string[], string | null][] = [["pan", client.pan, client.panServices ?? [], null]];
  if (client.gst) numbers.push(["gstin", gstin(client.gst[0], client.pan), client.gst[1], client.gst[0]]);
  if (client.tan) numbers.push(["tan", `ZZZZ${client.pan.slice(5, 9)}1Z`, client.tan, null]);
  if (client.llpin) numbers.push(["llpin", client.llpin[0], client.llpin[1], null]);
  for (const [kind, number, services, state] of numbers) {
    const [{ id: registration }] = (
      await db.query(
        "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code, identity_hash) values ($1, $2, $3, $4, $5, $6, $7) returning id",
        [firm, id, kind, await crypto.encrypt(firm, `clients/${id}/${kind}`, number), await crypto.blindIndex(firm, kind, number), state, numberIdentity(kind, number)],
      )
    ).rows;
    // Setting services makes the next 12 months of due dates (the calendar's own trigger).
    if (services.length) await db.query("update public.client_registrations set services = $1 where id = $2", [services, registration]);
  }
}

// Last month's GST returns: most filed with an acknowledgement, a few still overdue.
const lastMonth = new Date(Date.parse(`${today.slice(0, 7)}-01`) - 86_400_000).toISOString().slice(0, 7);
const gstins = (await db.query("select id, client_id, services from public.client_registrations where firm_id = $1 and kind = 'gstin'", [firm])).rows;
let n = 0;
for (const reg of gstins)
  for (const [code, day] of [["GSTR1_M", "11"], ["GSTR3B_M", "20"]] as const) {
    if (!reg.services.includes(code)) continue;
    const due = `${today.slice(0, 7)}-${day}`;
    // Of the returns already past their date, every third is still waiting: overdue.
    const filed = due < today && n++ % 3 !== 2;
    await db.query(
      `insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on, status, details) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (firm_id, registration_id, code, period_key) do update set status = excluded.status, details = excluded.details`,
      [firm, reg.client_id, reg.id, code, lastMonth, due, filed ? "filed" : "upcoming", filed ? { filed_on: due, ack: `AA24${lastMonth.slice(2, 4)}${lastMonth.slice(5, 7)}${String(100000 + n * 7919).slice(0, 6)}X` } : {}],
    );
  }

// Who does what for a few clients.
const assign = (client: string, user: string | null, team: string | null, role: string) =>
  db.query("insert into public.client_assignments (firm_id, client_id, user_id, team_id, role) values ($1, $2, $3, $4, $5)", [firm, ids.get(client), user, team, role]);
await assign("Mehta Traders", staff.get(DEMO_PEOPLE.partner)!, null, "partner_in_charge");
await assign("Patel Textiles Pvt Ltd", staff.get(DEMO_PEOPLE.partner)!, null, "partner_in_charge");
await assign("Mehta Traders", staff.get(DEMO_PEOPLE.manager)!, null, "manager");
await assign("S.K. Builders", staff.get(DEMO_PEOPLE.manager)!, null, "manager");
await assign("Shah & Sons", staff.get(DEMO_PEOPLE.staff)!, null, "staff");
await assign("S.K. Builders", staff.get(DEMO_PEOPLE.staff)!, null, "staff");
await assign("Trivedi Foods", staff.get(DEMO_PEOPLE.staff)!, null, "staff");
await assign("Mehta Traders", null, groups.get("GST team")!, "staff");
await assign("Kapoor Enterprises", staff.get("anita.staff@demo.inboxca.test")!, null, "staff");
await assign("Patel Textiles Pvt Ltd", null, groups.get("GST team")!, "staff");

// Contact people who write for clients.
const contacts = [
  ["Hitesh Patel", "hitesh@pateltextiles.example", ["Patel Textiles Pvt Ltd", "Patel Exim LLP"], "Director"],
  ["Sunita Mehta", "sunita@mehtatraders.example", ["Mehta Traders"], "Accountant"],
  ["Vikram Desai", "vikram.desai@example.in", ["Rajesh Desai", "Meena Desai"], "Son"],
] as const;
const contactIds = new Map<string, string>();
for (const [name, email, forClients, relation] of contacts) {
  const id = randomUUID();
  contactIds.set(name, id);
  await db.query("insert into public.contacts (id, firm_id, name_enc, email_enc, email_bidx) values ($1, $2, $3, $4, $5)", [
    id, firm, await crypto.encrypt(firm, `contacts/${id}/name`, name), await crypto.encrypt(firm, `contacts/${id}/email`, email), await crypto.blindIndex(firm, "email", email),
  ]);
  for (const client of forClients)
    await db.query("insert into public.contact_clients (firm_id, contact_id, client_id, relation, can_view_status, can_receive_documents) values ($1, $2, $3, $4, true, true)", [firm, id, ids.get(client), relation]);
}

// The firm's mailbox, pointing at the local test mail server, and some sorted client mail.
const account = randomUUID();
await db.query(
  "insert into public.connected_accounts (id, firm_id, kind, provider, address_enc, credentials_enc, sync_cursor, status, settings, identity_hash) values ($1, $2, 'mail', 'imap', $3, $4, null, 'connected', $5, $6)",
  [account, firm, await crypto.encrypt(firm, `accounts/${account}/address`, "office@demo-firm.example"), await crypto.encrypt(firm, `accounts/${account}/credentials`, JSON.stringify({ password: "demo" })), { imap: { host: "imap.demo-firm.example", port: 993 }, smtp: { host: "smtp.demo-firm.example", port: 465 } }, accountIdentity("mail", "imap", "office@demo-firm.example")],
);
const mail = [
  ["Mehta Traders", "data_gst", 2],
  ["Kapoor Enterprises", "data_tax_audit", 5],
  ["Rajesh Desai", "records_past", 20],
  ["Shah & Sons", "other", 26],
  ["Patel Textiles Pvt Ltd", "notice_received", 30],
  ["S.K. Builders", "data_gst", 50],
  ["Bhatt Dental Clinic", "other", 75],
  ["Iyer Consultants", "data_income_tax", 120],
] as const;
const events = new Map<string, { id: string; label: string }>();
for (const [client, label, minutesAgo] of mail) {
  const [{ id }] = (
    await db.query(
      "insert into public.email_events (firm_id, account_id, provider_message_id, thread_id, sender_bidx, client_id, received_at, label, decision_source, reason_code) values ($1, $2, $3, $3, 'demo', $4, now() - make_interval(mins => $5), $6, 'rule', $7) returning id",
      [firm, account, `<demo-${randomUUID()}@example>`, ids.get(client), minutesAgo, label, label === "other" ? "no_rule" : "notice_words"],
    )
  ).rows;
  if (label === "other") await db.query("insert into public.requests (firm_id, kind, client_id, entity_type, entity_id, reason_code) values ($1, 'team_reply', $2, 'email', $3, 'no_rule')", [firm, ids.get(client), id]);
  events.set(client, { id, label });
}

// Two invented notices: one with its action date confirmed, one waiting for review.
await db.query(
  `insert into public.tasks (firm_id, client_id, kind, status, due_on, details) values
   ($1, $2, 'notice', 'upcoming', $4::date + 12, jsonb_build_object('authority', 'income_tax', 'notice_type', 'Notice u/s 148', 'reference', 'ITBA/AST/F/148/2026-27/1000000001', 'received_on', $4::date - 1, 'action_date', $4::date + 12)),
   ($1, $3, 'notice', 'upcoming', $4::date + 1, jsonb_build_object('authority', 'gst', 'notice_type', 'ASMT-10', 'reference', '', 'received_on', $4::date, 'suggested_date', $4::date + 30))`,
  [firm, ids.get("Patel Textiles Pvt Ltd"), ids.get("Kapoor Enterprises"), today],
);

const [driveAccount] = (await db.query("select id, provider, credentials_enc from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm])).rows;
// The papers that come by email are sent by npm run demo:mail, for InboxCA to file itself.
const files = demoFiles(lastMonth, today).filter((file) => !file.mail);
if (driveAccount) {
  const drive = await openDrive(firm, driveAccount);
  for (const { client, original, bytes } of files) {
    const event = events.get(client)!;
    const about = describeFile(original, "", event.label, new Date().toISOString());
    const folder = await drive.ensureFolder([...folderPath("year_client_work", about.year, client, about.work), ...(about.sure ? [] : ["To check"])]);
    const name = fileName({ client, type: about.type, period: filePeriod(about.period), extension: original.split(".").pop()! });
    // Already there from an earlier run: that copy gives way to this run's, so the paper and its
    // record agree (InboxCA reads a paper only when its bytes are the ones recorded).
    let saved = await drive.save(folder, name, bytes);
    if (saved === "taken") saved = await drive.trash(`${folder}/${name}`).then(() => drive.save(folder, name, bytes));
    const id = randomUUID();
    await db.query(
      "insert into public.documents (id, firm_id, client_id, work_type, document_type, period_key, status, email_event_id, drive_file_id, name, original_name_enc, size, sha256) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
      [id, firm, ids.get(client), about.work, about.type, about.period, about.sure ? "filed" : "to_check", event.id, saved === "taken" ? `${folder}/${name}` : saved.id, name, await crypto.encrypt(firm, `documents/${id}/original_name`, original), bytes.length, createHash("sha256").update(bytes).digest("hex")],
    );
    // Read as InboxCA reads every paper it files (src/jobs/read-document.ts), so its figures show.
    await db.query("insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) values ($1, 'read_document', 'document', $2, $3)", [firm, id, `read_document:${id}`]);
  }
}
await db.end();
console.log(`Demo firm filled: ${clients.length} clients, ${people.length} people, ${contacts.length} contacts, ${mail.length} client emails, ${driveAccount ? files.length : 0} files.`);
