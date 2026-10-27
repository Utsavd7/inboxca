import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chooseTemplate } from "@/src/lib/templates";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// New from the government (D42): a firm sees the last 14 days' items only in its clients' work
// areas, each person dismisses their own, and only Orelu's admin adds a line to an item or ends
// a form version, with the official link, logged.
let db: Client;
const gstFirm = "00000000-0000-4000-8000-0000000060a0", itFirm = "00000000-0000-4000-8000-0000000060b0";
const owner = "00000000-0000-4000-8000-0000000060a1", staff = "00000000-0000-4000-8000-0000000060a2", itOwner = "00000000-0000-4000-8000-0000000060b1", admin = "00000000-0000-4000-8000-0000000060c1";
const [gst, income, old] = ["a".repeat(16), "b".repeat(16), "c".repeat(16)];
const session = (id: string) => `${id.slice(0, -3)}d${id.slice(-2)}`;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

// Acts as a listed admin with the passkey proof the server sends after a check.
async function asAdmin() {
  await asOwner(db);
  const { key } = (await db.query("select public.office_proof_key() as key")).rows[0];
  const until = Math.floor(Date.now() / 1000) + 3600;
  await actAs(db, admin, "aal2", session(admin));
  await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-orelu-admin": `${until}.${createHmac("sha256", key).update(`admin:${admin}:${session(admin)}:${until}`).digest("hex")}` })]);
}

async function seed() {
  await asOwner(db);
  // As PostgREST sends it with every request (an earlier test's proof leaves it empty).
  await db.query("select set_config('request.headers', '{}', true)");
  await db.query("insert into auth.users(id,email) values ($1,'owner@gov.test'),($2,'staff@gov.test'),($3,'it-owner@gov.test'),($4,'admin@gov.test')", [owner, staff, itOwner, admin]);
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session(admin), admin]);
  await db.query("insert into public.orelu_admins(user_id) values ($1)", [admin]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'GST Work Firm','27','active'),($2,'Income Tax Work Firm','27','active')", [gstFirm, itFirm]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active'),($4,$5,'owner','active')", [gstFirm, owner, staff, itFirm, itOwner]);
  const client = async (firm: string, archived = false) => (await db.query("insert into public.clients(firm_id,name,kind,archived_at) values ($1,'Invented Client','business',$2) returning id", [firm, archived ? new Date() : null])).rows[0].id;
  const number = async (firm: string, id: string, kind: string, services: string[]) =>
    db.query("insert into public.client_registrations(firm_id,client_id,kind,number_enc,number_bidx,services) values ($1,$2,$3,'sealed',gen_random_uuid()::text,$4)", [firm, id, kind, services]);
  await number(gstFirm, await client(gstFirm), "gstin", ["GSTR1_M", "GSTR3B_M"]);
  await number(gstFirm, await client(gstFirm), "pan", []);
  await number(itFirm, await client(itFirm), "pan", ["ITR_NA"]);
  // An archived client's work is not the firm's work any more.
  await number(itFirm, await client(itFirm, true), "gstin", ["GSTR1_M"]);
  const today = (await db.query("select ((now() at time zone 'Asia/Kolkata')::date)::text d")).rows[0].d;
  const longAgo = (await db.query("select ((now() at time zone 'Asia/Kolkata')::date - 20)::text d")).rows[0].d;
  const item = (id: string, area: string, seen: string) => ({ id, source: "gst_news", area, title: `Invented ${id.slice(0, 1)}`, link: "https://www.gst.gov.in/newsandupdates/read/1", seen });
  await db.query("insert into public.platform_settings(key,value) values ('watch',$1) on conflict (key) do update set value=excluded.value", [
    JSON.stringify({ sources: { cbic_gst: { failures: 2 }, gst_news: { failures: 1 } }, changes: [], alerts: [], items: [item(old, "gst", longAgo), item(gst, "gst", today), item(income, "income_tax", today)] }),
  ]);
}
const updates = async (firm: string) => (await db.query("select public.gov_updates($1) u", [firm])).rows[0].u;

it("shows a firm the last 14 days' items in its clients' work areas only, and nobody outside the firm", () =>
  rollback(db, async () => {
    await seed();
    await actAs(db, owner);
    expect(await updates(gstFirm)).toMatchObject({ areas: ["gst"], failing: ["cbic_gst"], items: [{ id: gst, area: "gst", dismissed: false }] });
    expect((await updates(gstFirm)).items).toHaveLength(1);
    expect((await attempt(db, "select public.gov_updates($1)", [itFirm])).error).toBe("Members only");
    await actAs(db, itOwner);
    expect(await updates(itFirm)).toMatchObject({ areas: ["income_tax"], items: [{ id: income }] });
    await actAs(db, null);
    expect((await attempt(db, "select public.gov_updates($1)", [gstFirm])).error).toContain("permission denied");
  }));

it("lets each person dismiss an item for themselves only", () =>
  rollback(db, async () => {
    await seed();
    await actAs(db, owner);
    expect((await db.query("select public.dismiss_gov_update($1, $2) ok", [gstFirm, gst])).rows[0].ok).toBe(true);
    expect((await db.query("select public.dismiss_gov_update($1, $2) ok", [gstFirm, "not an item"])).rows[0].ok).toBe(false);
    expect((await db.query("select public.dismiss_gov_update($1, $2) ok", [itFirm, gst])).rows[0].ok).toBe(false);
    expect((await updates(gstFirm)).items).toMatchObject([{ id: gst, dismissed: true }]);
    await actAs(db, staff);
    expect((await updates(gstFirm)).items).toMatchObject([{ id: gst, dismissed: false }]);
    // Nobody changes the list by hand.
    expect((await attempt(db, "update public.firm_members set dismissed = '{}' where user_id = $1", [owner])).error).toContain("permission denied");
    await asOwner(db);
    expect((await db.query("select dismissed from public.firm_members where user_id = $1", [owner])).rows[0].dismissed).toEqual([gst]);
  }));

it("lets only an admin add the line firms see, logged", () =>
  rollback(db, async () => {
    await seed();
    await actAs(db, owner);
    expect((await attempt(db, "select public.admin_note_update($1, current_date)", [gst])).error).toBe("Orelu admins only");
    await asAdmin();
    expect((await attempt(db, "select public.admin_note_update($1)", [gst])).error).toBe("A date or the periods");
    expect((await attempt(db, "select public.admin_note_update($1, '2026-11-01', 'returns up to Oct 2026')", [gst])).error).toBe("A date or the periods");
    expect((await db.query("select public.admin_note_update($1, '2026-11-01') ok", [gst])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_note_update($1, keeps => ' returns up to Oct 2026 ') ok", [income])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_note_update($1, '2026-11-01') ok", ["d".repeat(16)])).rows[0].ok).toBe(false);
    await actAs(db, owner);
    expect((await updates(gstFirm)).items).toMatchObject([{ id: gst, note: { uses: "2026-11-01" } }]);
    await actAs(db, itOwner);
    expect((await updates(itFirm)).items).toMatchObject([{ id: income, note: { keeps: "returns up to Oct 2026" } }]);
    await asOwner(db);
    expect((await db.query("select firm_id, details from public.activity_log where action = 'admin.update_noted' and actor_id = $1 order by at", [admin])).rows).toEqual([
      { firm_id: null, details: { item: gst, uses: "2026-11-01", keeps: null } },
      { firm_id: null, details: { item: income, uses: null, keeps: "returns up to Oct 2026" } },
    ]);
  }));

it("lets only an admin end a form version, only with the official link, after its first period, logged", () =>
  rollback(db, async () => {
    await seed();
    await asOwner(db);
    await db.query("insert into public.templates(form_code,version,valid_from,status,source,mappings) values ('GSTR1','9.9','2026-04-01','active','{\"file\":\"invented.xlsx\"}','{\"format\":\"xlsx\"}')");
    await actAs(db, owner);
    expect((await attempt(db, "select public.admin_end_template('GSTR1', '9.9', '2026-10-01', 'https://cbic-gst.gov.in/invented.pdf')")).error).toBe("Orelu admins only");
    expect((await attempt(db, "update public.templates set valid_until = '2026-10-01' where version = '9.9'")).error).toContain("permission denied");
    await asAdmin();
    expect((await attempt(db, "select public.admin_end_template('GSTR1', '9.9', '2026-10-01', 'http://cbic-gst.gov.in/invented.pdf')")).error).toBe("The official link is needed");
    expect((await db.query("select public.admin_end_template('GSTR1', '9.9', '2026-04-01', 'https://cbic-gst.gov.in/invented.pdf') ok")).rows[0].ok).toBe(false);
    expect((await db.query("select public.admin_end_template('GSTR1', '9.9', '2026-10-01', 'https://cbic-gst.gov.in/invented.pdf') ok")).rows[0].ok).toBe(true);
    await asOwner(db);
    expect((await db.query("select valid_until::text, status, source from public.templates where form_code = 'GSTR1' and version = '9.9'")).rows[0]).toEqual({ valid_until: "2026-10-01", status: "active", source: { file: "invented.xlsx", ended_by: "https://cbic-gst.gov.in/invented.pdf" } });
    expect((await db.query("select details from public.activity_log where action = 'admin.template_ended' and actor_id = $1", [admin])).rows).toEqual([
      { details: { form: "GSTR1", version: "9.9", until: "2026-10-01", link: "https://cbic-gst.gov.in/invented.pdf" } },
    ]);
  }));

// The store for official files (D42): kept once by their hash, read and written by the server only.
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
it("keeps an official file once, by its hash, for the server only", () =>
  rollback(db, async () => {
    await seed();
    const bytes = Buffer.from("Invented official file"), keep = "insert into public.official_files (sha256, bytes) values ($1, $2)";
    await db.query("set local role service_role");
    await db.query(keep, [sha(bytes), bytes]);
    expect(await attempt(db, `${keep} on conflict do nothing`, [sha(bytes), bytes])).toMatchObject({ ok: true, count: 0 });
    expect((await attempt(db, keep, ["a".repeat(64), Buffer.from("Another invented file")])).error).toContain("check constraint");
    expect((await attempt(db, "update public.official_files set bytes = $1", [Buffer.from("Changed")])).error).toContain("permission denied");
    expect((await attempt(db, "delete from public.official_files")).error).toContain("permission denied");
    for (const person of [owner, admin, null]) {
      if (person === admin) await asAdmin();
      else await actAs(db, person);
      expect((await attempt(db, "select sha256 from public.official_files")).error).toContain("permission denied");
      expect((await attempt(db, keep, [sha(Buffer.from("x")), Buffer.from("x")])).error).toContain("permission denied");
    }
  }));

it("lets only an admin use a same layout file in the store from a period of the version it matches, as a new version, logged", () =>
  rollback(db, async () => {
    await seed();
    const bytes = Buffer.from("Invented same layout workbook"), url = "https://tutorial.gst.gov.in/offlineutilities/returns/gst_offline_tool.zip";
    const source = { file: "gstr1-v9.9/GSTR1_Excel_Workbook_Template_V9.9.xlsx", url, sha256: sha(bytes) }, mappings = { format: "xlsx", sheets: { b2b: 2 } };
    const at = "2026-10-26T03:00:00.000Z", compared = (file: string, form: string, version: string, layout: object) => ({ file, with: "9.8", ...layout, template: { form_code: form, version, source: { ...source, file: `invented/${file}` } } });
    await db.query("insert into public.templates (form_code, version, valid_from, valid_until, status, source, mappings) values ('GSTR1', '9.8', '2026-04-01', '2027-04-01', 'active', $1, $2), ('ITR1', '9.8', '2026-04-01', null, 'active', $1, '{\"format\":\"json\"}')", [{ ...source, file: "invented.xlsx", sha256: "b".repeat(64) }, mappings]);
    await db.query("update public.platform_settings set value = value || jsonb_build_object('changes', $1::jsonb) where key = 'watch'", [JSON.stringify([{ source: "gst_offline_tool", at, status: "draft", compared: [
      { ...compared("GSTR1_Excel_Workbook_Template_V9.9.xlsx", "GSTR1", "9.9", { same: true }), template: { form_code: "GSTR1", version: "9.9", source } },
      // Even with a version recorded beside it, a changed layout is never taken in one click.
      compared("GSTR1_Excel_Workbook_Template_V9.7.xlsx", "GSTR1", "9.7", { differences: ["Sheet added: hsn"], more: 0 }),
      // Named for another year: used only once the admin says they checked the year.
      compared("ITR-1_2026_Main_V9.9.json", "ITR1", "9.9", { same: true, renamed: true }),
    ] }])]);
    const use = (file: string, starts: string, when = at, checked = false) => attempt(db, "select public.admin_add_template('gst_offline_tool', $1, $2, $3, $4) ok", [when, file, starts, checked]);
    await actAs(db, owner);
    expect((await use("GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2026-11-01")).error).toBe("Orelu admins only");
    expect((await attempt(db, "insert into public.templates (form_code, version, valid_from, status, source, mappings) values ('GSTR1', '9.9', '2026-11-01', 'active', $1, $2)", [source, mappings])).error).toContain("permission denied");
    await asAdmin();
    // Not in the store yet.
    expect((await use("GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2026-11-01")).rows).toEqual([{ ok: false }]);
    await asOwner(db);
    await db.query("insert into public.official_files (sha256, bytes) values ($1, $2)", [sha(bytes), bytes]);
    await asAdmin();
    for (const [file, starts, when] of [["GSTR1_Excel_Workbook_Template_V9.7.xlsx", "2026-11-01"], ["GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2026-03-01"], ["GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2027-04-01"],
      ["GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2026-11-15"], ["GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2026-11-01", "2026-10-25T03:00:00.000Z"], ["ITR-1_2026_Main_V9.9.json", "2026-05-01"]])
      expect((await use(file, starts, when)).rows).toEqual([{ ok: false }]);
    expect((await use("GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2026-11-01")).rows).toEqual([{ ok: true }]);
    expect((await use("GSTR1_Excel_Workbook_Template_V9.9.xlsx", "2026-12-01")).rows).toEqual([{ ok: false }]);
    expect((await use("ITR-1_2026_Main_V9.9.json", "2027-04-01")).rows).toEqual([{ ok: false }]);
    expect((await use("ITR-1_2026_Main_V9.9.json", "2027-04-01", at, true)).rows).toEqual([{ ok: true }]);
    await asOwner(db);
    const { rows } = await db.query("select form_code, version, valid_from::text, valid_until::text, status, source, mappings from public.templates where version in ('9.8', '9.9') order by form_code, version");
    expect(rows.filter((row) => row.version === "9.9")).toEqual([
      { form_code: "GSTR1", version: "9.9", valid_from: "2026-11-01", valid_until: "2027-04-01", status: "active", source, mappings },
      { form_code: "ITR1", version: "9.9", valid_from: "2027-04-01", valid_until: null, status: "active", source: { ...source, file: "invented/ITR-1_2026_Main_V9.9.json" }, mappings: { format: "json" } },
    ]);
    // The version it matches keeps its periods; from the first period both work, the newer by default.
    const gst = rows.filter((row) => row.form_code === "GSTR1");
    expect(chooseTemplate(gst, "GSTR1", "2026-10").version).toBe("9.8");
    expect(chooseTemplate(gst, "GSTR1", "2026-11").version).toBe("9.9");
    expect(chooseTemplate(gst, "GSTR1", "2026-11", "9.8", "Filing software needs the earlier version").version).toBe("9.8");
    expect((await db.query("select firm_id, entity_type, details from public.activity_log where action = 'admin.template_added' and actor_id = $1 order by details ->> 'form'", [admin])).rows).toEqual([
      { firm_id: null, entity_type: "rule", details: { form: "GSTR1", version: "9.9", from: "2026-11-01", sha256: sha(bytes) } },
      { firm_id: null, entity_type: "rule", details: { form: "ITR1", version: "9.9", from: "2027-04-01", sha256: sha(bytes) } },
    ]);
  }));

it("puts a newer version with the same layout live by itself for the periods of the version it matches, once, logged; a changed layout stays a draft", () =>
  rollback(db, async () => {
    await seed();
    // The official ITR-1 schema written on one line as version 1.3: the same fields, its own hash.
    const bytes = Buffer.from(JSON.stringify(JSON.parse(readFileSync("reference/official/itr/ITR-1_2026_Main_V1.1.json", "utf8"))));
    const source = (file: string) => ({ file, url: `https://official.invalid/f/${file.split("/").pop()}`, sha256: sha(bytes) });
    await db.query("update public.platform_settings set value = value || jsonb_build_object('changes', $1::jsonb) where key = 'watch'", [JSON.stringify([{ source: "itr_downloads", at: "2026-10-27T03:00:00.000Z", status: "draft", compared: [
      { file: "ITR-1_2026_Main_V1.3.json", with: "1.1", same: true, live: true, template: { form_code: "ITR1", version: "1.3", source: source("itr/ITR-1_2026_Main_V1.3.json") } },
      // The GSTR-1 v2.0 workbook beside v2.2: a changed layout never goes live, even with a version recorded beside it.
      { file: "GSTR1_Excel_Workbook_Template_V9.10.xlsx", with: "2.2", differences: ["Sheet added: hsn"], more: 0, live: true, template: { form_code: "GSTR1", version: "9.10", source: source("gstr1-v9.10/GSTR1_Excel_Workbook_Template_V9.10.xlsx") } },
    ] }])]);
    await db.query("insert into public.official_files (sha256, bytes) values ($1, $2) on conflict do nothing", [sha(bytes), bytes]);
    for (const person of [owner, admin]) {
      if (person === admin) await asAdmin();
      else await actAs(db, person);
      expect((await attempt(db, "select public.forms_go_live()")).error).toContain("permission denied");
    }
    await asOwner(db);
    await db.query("set local role service_role");
    expect((await db.query("select public.forms_go_live() n")).rows).toEqual([{ n: 1 }]);
    expect((await db.query("select public.forms_go_live() n")).rows).toEqual([{ n: 0 }]);
    await asOwner(db);
    const { rows } = await db.query("select form_code, version, valid_from::text, valid_until::text, status, source, mappings from public.templates where form_code in ('ITR1', 'GSTR1') order by form_code, version");
    expect(rows.filter((row) => ["1.3", "9.10"].includes(row.version))).toEqual([
      { form_code: "ITR1", version: "1.3", valid_from: "2026-04-01", valid_until: "2027-04-01", status: "active", source: source("itr/ITR-1_2026_Main_V1.3.json"), mappings: { format: "json" } },
    ]);
    // Both work for AY 2026-27, the newer by default.
    const itr = rows.filter((row) => row.form_code === "ITR1");
    expect(chooseTemplate(itr, "ITR1", "2026").version).toBe("1.3");
    expect(chooseTemplate(itr, "ITR1", "2026", "1.1", "Filing software needs the earlier version").version).toBe("1.1");
    expect((await db.query("select firm_id, actor_id, entity_type, details from public.activity_log where action = 'form.went_live' and details ->> 'sha256' = $1", [sha(bytes)])).rows).toEqual([
      { firm_id: null, actor_id: null, entity_type: "rule", details: { form: "ITR1", version: "1.3", with: "1.1", sha256: sha(bytes) } },
    ]);
  }));

it("runs the daily check at 08:30 India time", async () => {
  expect((await db.query("select schedule from cron.job where jobname = 'forms-watch'")).rows).toEqual([{ schedule: "0 3 * * *" }]);
  expect((await db.query("select ('2026-10-26 03:00:00+00'::timestamptz at time zone 'Asia/Kolkata')::time::text t")).rows[0].t).toBe("08:30:00");
});
