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
const { describeFile, filePeriod, placeUnderFreeName, receivedLabel } = await import("../src/lib/documents");
const { folderPath } = await import("../src/lib/drive");
const { openDrive } = await import("../src/lib/drive-account");
const { arn, demoFiles, gstin } = await import("./demo-files.mts");
const { draftSchema, saveDraft } = await import("../src/lib/datasets");
const { DEMO_PEOPLE, demoKeyName } = await import("../src/lib/dev-login");


type Client = { name: string; kind: string; email?: string; pan: string; gst?: [string, string[]]; tan?: string[]; panServices?: string[]; llpin?: [string, string[]]; cin?: [string, string[]]; group?: string; branch?: string };
const clients: Client[] = [
  { name: "Mehta Traders", kind: "business", email: "accounts@mehtatraders.example", pan: "ZZZFZ0101Z", gst: ["24", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], tan: ["TDS_PAY", "TDS_RET"], branch: "Ahmedabad" },
  { name: "Shah & Sons", kind: "business", email: "shahandsons@example.in", pan: "ZZZFZ0102Z", gst: ["24", ["GSTR1_Q", "GSTR3B_Q", "PMT06"]], branch: "Ahmedabad" },
  { name: "Patel Textiles Pvt Ltd", kind: "company", email: "finance@pateltextiles.example", pan: "ZZZCZ0103Z", gst: ["24", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], tan: ["TDS_PAY", "TDS_RET", "TCS_RET"], cin: ["U17120ZZ2009PTC000103", ["AOC4", "MGT7", "ADT1", "DPT3", "MSME1"]], group: "Patel group", branch: "Surat" },
  { name: "Patel Exim LLP", kind: "llp", email: "exim@pateltextiles.example", pan: "ZZZFZ0104Z", gst: ["24", ["GSTR1_M", "GSTR3B_M"]], llpin: ["ZZZ-0104", ["LLP11", "LLP8"]], group: "Patel group", branch: "Surat" },
  { name: "Rajesh Desai", kind: "individual", email: "rajesh.desai@example.in", pan: "ZZZPZ0105Z", panServices: ["ITR_NA", "ADV_TAX", "DIR3KYC"], group: "Desai family", branch: "Ahmedabad" },
  { name: "Meena Desai", kind: "individual", email: "meena.desai@example.in", pan: "ZZZPZ0106Z", panServices: ["ITR_NA"], group: "Desai family", branch: "Ahmedabad" },
  { name: "Kapoor Enterprises", kind: "tax_audit", email: "kapoor.ent@example.in", pan: "ZZZFZ0107Z", gst: ["27", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], panServices: ["TAX_AUDIT", "ITR_AUDIT"], tan: ["TDS_PAY", "TDS_RET"], branch: "Ahmedabad" },
  { name: "Iyer Consultants", kind: "individual", email: "iyer.consult@example.in", pan: "ZZZPZ0108Z", panServices: ["ITR_BIZ", "ADV_TAX"], gst: ["24", ["GSTR1_Q", "GSTR3B_Q", "PMT06"]], branch: "Ahmedabad" },
  { name: "S.K. Builders", kind: "business", email: "skbuilders@example.in", pan: "ZZZFZ0109Z", gst: ["24", ["GSTR1_M", "GSTR3B_M"]], tan: ["TDS_PAY", "TDS_RET"], branch: "Surat" },
  { name: "Trivedi Foods", kind: "business", email: "trivedi.foods@example.in", pan: "ZZZFZ0110Z", gst: ["24", ["CMP08", "GSTR4"]], branch: "Surat" },
  { name: "Bhatt Dental Clinic", kind: "individual", email: "dr.bhatt@example.in", pan: "ZZZPZ0111Z", panServices: ["ITR_BIZ", "ADV_TAX"], branch: "Ahmedabad" },
  { name: "Rao Exports Pvt Ltd", kind: "company", email: "accounts@raoexports.example", pan: "ZZZCZ0112Z", panServices: ["TAX_AUDIT", "ITR_TP"], gst: ["24", ["GSTR1_M", "GSTR3B_M", "GSTR9"]], tan: ["TDS_PAY", "TDS_RET"], branch: "Ahmedabad" },
  { name: "Nair Charitable Trust", kind: "trust", email: "trustee@nairtrust.example", pan: "ZZZTZ0113Z", panServices: ["ITR_NA"], branch: "Ahmedabad" },
  { name: "Anaya Designs (OPC) Pvt Ltd", kind: "company", email: "anaya@anayadesigns.example", pan: "ZZZCZ0114Z", cin: ["U74999ZZ2021OPC000114", ["AOC4_OPC"]], branch: "Ahmedabad" },
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

// Start clean, keeping the firm, its owner and any connected drive. The papers this firm saved
// last time leave its drive first, but not a file another firm's record also points at (the
// local test drive is shared, and the walkthrough's firm was copied from this one).
const [driveAccount] = (await db.query("select id, provider, credentials_enc from public.connected_accounts where firm_id = $1 and kind = 'drive'", [firm])).rows;
const drive = driveAccount ? await openDrive(firm, driveAccount) : null;
const ownFiles = (await db.query("select distinct d.drive_file_id from public.documents d where d.firm_id = $1 and d.drive_file_id is not null and not exists (select 1 from public.documents o where o.drive_file_id = d.drive_file_id and o.firm_id <> d.firm_id)", [firm])).rows;
for (const { drive_file_id } of ownFiles) await drive?.trash(drive_file_id).catch(() => {});
await db.query("begin");
await db.query("delete from public.email_events where firm_id = $1", [firm]);
await db.query("delete from public.requests where firm_id = $1", [firm]);
await db.query("delete from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm]);
await db.query("delete from public.contacts where firm_id = $1", [firm]);
await db.query("delete from public.clients where firm_id = $1", [firm]);
await db.query("delete from public.firm_members where firm_id = $1 and role <> 'owner'", [firm]);
await db.query("delete from public.groups where firm_id = $1", [firm]);
// The meter keeps a return or paper once counted, and the size of what is deleted, even after it
// goes; the demo's own deleted ones go with it, so Returns this year and the storage used stay the
// same however often this runs.
await db.query(
  `delete from public.usage_ledger u where u.firm_id = $1 and (u.bytes is null and not exists (select 1 from public.client_registrations r where r.id = u.registration_id)
     or u.bytes is not null and u.ref is null
     or u.ref is not null and not exists (select 1 from public.documents d where d.id = u.ref) and not exists (select 1 from public.email_events e where e.id = u.ref))`,
  [firm],
);
await db.query("commit");
// Papers earlier runs left in the client folders, which no firm's record points at.
if (drive) {
  const kept = new Set((await db.query("select drive_file_id from public.documents where drive_file_id is not null")).rows.map((row) => row.drive_file_id));
  for (const file of (await drive.check()).files)
    if (!kept.has(file.id) && clients.some((client) => file.path.split("/").pop()!.startsWith(`${client.name} - `))) await drive.trash(file.id).catch(() => {});
}

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
const ids = new Map<string, string>(), registrations = new Map<string, string>(), acks = new Map<string, string>();
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
  if (client.cin) numbers.push(["cin", client.cin[0], client.cin[1], null]);
  for (const [kind, number, services, state] of numbers) {
    const [{ id: registration }] = (
      await db.query(
        "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code, identity_hash) values ($1, $2, $3, $4, $5, $6, $7) returning id",
        [firm, id, kind, await crypto.encrypt(firm, `clients/${id}/${kind}`, number), await crypto.blindIndex(firm, kind, number), state, numberIdentity(kind, number)],
      )
    ).rows;
    // Setting services makes the next 12 months of due dates (the calendar's own trigger).
    if (services.length) await db.query("update public.client_registrations set services = $1 where id = $2", [services, registration]);
    registrations.set(`${client.name}|${kind}`, registration);
  }
}

// The returns already due, or for the year just gone, which the calendar no longer plans (it plans
// the next 12 months): the last two months' and the last quarter's, and those of FY 2025-26 (AY
// 2026-27). Most are filed with an acknowledgement number, some still open, late once past their
// date. They are written below, with the papers that are their acknowledgements.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lastMonth = new Date(Date.parse(`${today.slice(0, 7)}-01`) - 86_400_000).toISOString().slice(0, 7), monthName = `${MONTHS[Number(lastMonth.slice(5)) - 1]} ${lastMonth.slice(0, 4)}`;
const prevMonth = new Date(Date.parse(`${lastMonth}-01`) - 86_400_000).toISOString().slice(0, 7);
const ended = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3, quarter = ended ? `${today.slice(0, 4)}-${String(ended).padStart(2, "0")}` : `${Number(today.slice(0, 4)) - 1}-12`;
const afterQuarter = new Date(Date.UTC(Number(quarter.slice(0, 4)), Number(quarter.slice(5)), 1)).toISOString().slice(0, 7);
type Plan = { client: string; code: string; period: string; filed?: { on: string; ack: string; udin?: string }; due?: string; details?: Record<string, string> };
const plan: Plan[] = [];
clients.filter((client) => client.gst?.[1].includes("GSTR1_M")).forEach((client, i) => {
  // Patel Exim's GSTR-3B for the month before is still not filed: late.
  plan.push({ client: client.name, code: "GSTR1_M", period: prevMonth, filed: { on: `${lastMonth}-10`, ack: arn(client.gst![0], prevMonth, 1100 + i) } },
    { client: client.name, code: "GSTR3B_M", period: prevMonth, ...(client.name !== "Patel Exim LLP" && { filed: { on: `${lastMonth}-19`, ack: arn(client.gst![0], prevMonth, 2100 + i) } }) },
    { client: client.name, code: "GSTR1_M", period: lastMonth }, { client: client.name, code: "GSTR3B_M", period: lastMonth });
});
// Iyer Consultants' GSTR-3B for the last quarter is late, its papers just in.
for (const [i, name] of ["Shah & Sons", "Iyer Consultants"].entries())
  plan.push({ client: name, code: "GSTR1_Q", period: quarter, filed: { on: `${afterQuarter}-12`, ack: arn("24", quarter, 3100 + i) } }, { client: name, code: "GSTR3B_Q", period: quarter });
// TDS paid for the month before by every deductor; last quarter's statements filed, but for Patel
// Textiles' and Rao Exports' (papers by email) and Patel Textiles' TCS statement.
clients.filter((client) => client.tan).forEach((client, i) => {
  plan.push({ client: client.name, code: "TDS_PAY", period: prevMonth, filed: { on: `${lastMonth}-06`, ack: `051030806${lastMonth.slice(5)}${lastMonth.slice(0, 4)}${String(201 + i).padStart(5, "0")}` } });
  plan.push({ client: client.name, code: "TDS_RET", period: quarter, ...(!["Patel Textiles Pvt Ltd", "Rao Exports Pvt Ltd"].includes(client.name) && { filed: { on: `${afterQuarter}-28`, ack: `99000000${client.pan.slice(5, 9)}${String(301 + i)}` } }) });
});
plan.push(
  { client: "Patel Textiles Pvt Ltd", code: "TCS_RET", period: quarter },
  { client: "Iyer Consultants", code: "ITR_BIZ", period: "2026-03" },
  { client: "Nair Charitable Trust", code: "ITR_NA", period: "2026-03", filed: { on: "2026-07-30", ack: "990000000113701" } },
  { client: "Rao Exports Pvt Ltd", code: "TAX_AUDIT", period: "2026-03", due: "2026-10-31", filed: { on: "2026-10-28", ack: "990000000112300", udin: "26000000ZZZZZZ0112" } },
  ...["Rajesh Desai", "Iyer Consultants", "Bhatt Dental Clinic"].map((client, i) => ({ client, code: "ADV_TAX", period: "2026-09", filed: { on: "2026-09-14", ack: `0510417140920260${5130 + i}` } })),
  // Patel Textiles' AGM for FY 2025-26 was on 26 Sep 2026: the forms that follow it are due from then.
  ...([["AOC4", "2026-10-26"], ["ADT1", "2026-10-11"], ["MGT7", "2026-11-25"]] as const).map(([code, due]) => ({ client: "Patel Textiles Pvt Ltd", code, period: "2026-03", due, details: { agm: "2026-09-26" }, ...(code === "ADT1" && { filed: { on: "2026-10-06", ack: "ZZ0298311" } }) })),
  // Rajesh Desai is a director; his last DIR-3 KYC was for FY 2023-24.
  { client: "Rajesh Desai", code: "DIR3KYC", period: "2027-03", due: "2027-06-30", details: { last_kyc: "2024-03" } },
);

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

// The papers that come by email are sent by npm run demo:mail, for InboxCA to file itself.
const files = (await demoFiles(lastMonth, today)).filter((file) => !file.mail);
const papers = new Map<string, string>();
if (drive) {
  for (const { client, original, bytes, upload, received, filing } of files) {
    // A paper from the upload page came with no email.
    const event = upload ? null : (events.get(client) ?? null), at = received ? `${received}T11:00:00+05:30` : new Date().toISOString();
    const about = describeFile(original, "", event?.label ?? null, at);
    const folder = await drive.ensureFolder([...folderPath("year_client_work", about.year, client, about.work), ...(about.sure ? [] : ["To check"])]);
    // A name still taken is another firm's file: this one takes a free name beside it, as InboxCA does.
    const placed = await placeUnderFreeName({ client, type: about.type, period: filePeriod(about.period), extension: original.split(".").pop()! }, receivedLabel(at), (name) => drive.save(folder, name, bytes));
    if (placed === "taken") continue;
    const id = randomUUID();
    papers.set(`${client}|${original}`, id);
    await db.query(
      "insert into public.documents (id, firm_id, client_id, work_type, document_type, period_key, status, email_event_id, drive_file_id, name, original_name_enc, size, sha256, received_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
      [id, firm, ids.get(client), about.work, about.type, about.period, about.sure ? "filed" : "to_check", event?.id ?? null, placed.id, placed.name, await crypto.encrypt(firm, `documents/${id}/original_name`, original), bytes.length, createHash("sha256").update(bytes).digest("hex"), at],
    );
    // Read as InboxCA reads every paper it files (src/jobs/read-document.ts), so its figures show.
    await db.query("insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) values ($1, 'read_document', 'document', $2, $3)", [firm, id, `read_document:${id}`]);
    if (!filing) continue;
    const planned = plan.find((task) => task.client === client && task.code === filing.code && task.period === filing.period);
    const filed = { on: filing.on, ack: filing.ack, ...(filing.udin && { udin: filing.udin }) };
    if (planned) planned.filed = filed;
    else plan.push({ client, code: filing.code, period: filing.period, filed });
    acks.set(`${client}|${filing.code}|${filing.period}`, id);
  }
}
const forKind = new Map((await db.query("select code, due_rule ->> 'for' as kind from public.compliance_types where period_key = ''")).rows.map((row) => [row.code, row.kind]));
for (const task of plan) {
  const ack = acks.get(`${task.client}|${task.code}|${task.period}`);
  const details = { ...task.details, ...(task.filed && { filed_on: task.filed.on, ack: task.filed.ack, ...(task.filed.udin && { udin: task.filed.udin }), ...(ack && { ack_document: ack }), ...(/^ITR_/.test(task.code) && { verified_on: task.filed.on }) }) };
  await db.query(
    `insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on, status, details)
     select $1, r.client_id, r.id, t.code, $4, coalesce($5::date, private.due_on(t.due_rule, ($4 || '-01')::date, r.state_code)), $6, $7
     from public.compliance_types t, public.client_registrations r where t.code = $3 and t.period_key = '' and r.id = $2
     on conflict (firm_id, registration_id, code, period_key) do update set due_on = excluded.due_on, status = excluded.status, details = excluded.details`,
    [firm, registrations.get(`${task.client}|${forKind.get(task.code)}`), task.code, task.period, task.due ?? null, task.filed ? "filed" : "upcoming", details],
  );
}

// The papers asked for: some all in, some still awaited (the email ones arrive by npm run
// demo:mail and are received when InboxCA files them), so each step has a return to show.
const asks: [string, string, [string, string, string?][], boolean][] = [
  ["Mehta Traders", lastMonth, [["Sales bills", "gst", `sales register ${monthName}.xlsx`], ["Purchase bills", "gst", `purchase bills ${monthName}.pdf`], ["GSTR-2B", "gst", `GSTR-2B ${monthName}.json`], ["Bank statement", "gst", `bank statement ${monthName}.pdf`]], true],
  ["Patel Textiles Pvt Ltd", lastMonth, [["Sales bills", "gst", `sales register ${monthName}.xlsx`], ["Purchase bills", "gst", `purchase bills ${monthName}.pdf`], ["GSTR-2B", "gst", `GSTR-2B ${monthName}.json`]], true],
  ["S.K. Builders", lastMonth, [["Purchase bills", "gst", `purchase bills ${monthName}.pdf`]], true],
  ["Kapoor Enterprises", lastMonth, [["Sales bills", "gst"], ["Purchase bills", "gst"], ["Bank statement", "gst"]], false],
  ["Patel Exim LLP", lastMonth, [["Sales bills", "gst"], ["Purchase bills", "gst"]], false],
  ["Iyer Consultants", quarter, [["Sales bills", "gst"], ["GSTR-2B", "gst"]], false],
  ["Patel Textiles Pvt Ltd", quarter, [["TDS register", "tds"], ["Salary register", "tds"], ["TDS challans", "tds"]], false],
  ["Rao Exports Pvt Ltd", quarter, [["TDS register", "tds"], ["TDS challans", "tds"]], false],
  ["Iyer Consultants", "2026-03", [["Form 16", "income_tax", "Form 16 FY 2025-26.pdf"], ["Interest certificate", "income_tax", "interest certificate FY 2025-26.pdf"]], true],
  ["Meena Desai", "2027-03", [["Form 16", "income_tax"], ["Rent receipts", "income_tax", `rent receipt ${monthName}.jpg`], ["Interest certificate", "income_tax"]], false],
  ["Patel Textiles Pvt Ltd", "2026-03", [["List of shareholders", "other"], ["Board meeting minutes", "other"]], false],
  ["Rao Exports Pvt Ltd", "2026-03", [["Transfer pricing working", "other", "transfer pricing working FY 2025-26.xlsx"], ["Agreements with associated enterprises", "other"]], false],
];
for (const [client, period, items, done] of asks) {
  const id = randomUUID();
  await db.query("insert into public.requests (id, firm_id, kind, client_id, entity_type, entity_id, status, expires_at, details) values ($1, $2, 'documents', $3, 'checklist', $1, $4, now() + interval '30 days', $5)", [
    id, firm, ids.get(client), done ? "done" : "pending", { period, items: items.map(([type, work, paper]) => ({ type, work, received: paper && papers.has(`${client}|${paper}`) ? [papers.get(`${client}|${paper}`)] : [] })) },
  ]);
}

// Patel Textiles' October returns taken further, as its people would: once the jobs runner (npm
// run preview) has read the papers, the staff member checks every figure and InboxCA fills both
// returns, approved at once as the firm asks for no second approval (public.finish_form). With no
// runner going, nothing reads the papers and this is left out.
const wait = async (seconds: number, ready: () => Promise<boolean>) => {
  for (let at = 0; at < seconds; at += 5) { if (await ready()) return true; await new Promise((done) => setTimeout(done, 5000)); }
  return false;
};
const patel = ids.get("Patel Textiles Pvt Ltd"), patelPapers = [...papers].filter(([key]) => key.startsWith("Patel Textiles Pvt Ltd|") && key.includes(monthName)).map(([, id]) => id);
const read = () => db.query("select count(*)::int as n from public.jobs where kind = 'read_document' and state = 'done' and entity_id = any($1)", [patelPapers]).then(({ rows }) => rows[0].n > 0);
const datasets = () => db.query("select * from public.datasets where firm_id = $1 and client_id = $2 and period_key = $3 and form_code in ('GSTR1', 'GSTR3B')", [firm, patel, lastMonth]).then(({ rows }) => rows);
const approvedForms = () => db.query("select count(distinct prepared ->> 'form')::int as n from public.documents where firm_id = $1 and client_id = $2 and period_key = $3 and prepared ->> 'status' = 'approved'", [firm, patel, lastMonth]).then(({ rows }) => rows[0].n === 2);
let approved = false;
if (drive && (await wait(90, read)) && (await wait(300, async () => (await datasets()).length === 2))) {
  for (const row of await datasets()) {
    const data = draftSchema.parse(row.data), at = new Date().toISOString();
    for (const line of data.lines) Object.assign(line, { state: "confirmed", by: staff.get(DEMO_PEOPLE.staff), at });
    await saveDraft(row, data, staff.get(DEMO_PEOPLE.staff)!, "dataset.checked", { section: "all", rows: data.lines.length, flagged: 0 });
  }
  approved = await wait(300, approvedForms);
}
const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
const [{ count: returns }] = (await db.query("select count(*)::int from public.usage_ledger where firm_id = $1 and bytes is null and due_on >= $2 and due_on < $3", [firm, `${year}-04-01`, `${year + 1}-04-01`])).rows;
await db.end();
console.log(`Demo firm filled: ${clients.length} clients, ${people.length} people, ${contacts.length} contacts, ${mail.length} client emails, ${driveAccount ? files.length : 0} files, ${plan.length} returns due or filed already, ${asks.length} asks; returns this year ${returns}.`);
console.log(approved ? "Patel Textiles' October GSTR-1 and GSTR-3B are checked, filled and approved." : "No jobs runner read the papers, so no return is checked or approved yet: run this again while npm run preview runs.");
