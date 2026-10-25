import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Leads (PLAN.md 5.12): a lead is a client at an earlier stage, seen and worked only by the
// owner, partners and the front desk, each change one plain line in the log.
const FIRM = "00000000-0000-4000-8000-00000000c1a0";
const OTHER = "00000000-0000-4000-8000-00000000c1b0";
const OWNER = "00000000-0000-4000-8000-00000000c1a1";
const PARTNER = "00000000-0000-4000-8000-00000000c1a2";
const DESK = "00000000-0000-4000-8000-00000000c1a3";
const STAFF = "00000000-0000-4000-8000-00000000c1a4";
const MANAGER = "00000000-0000-4000-8000-00000000c1a5";
const OUTSIDER = "00000000-0000-4000-8000-00000000c1b1";
const LEAD = "00000000-0000-4000-8000-00000000c1c1";
const CLIENT = "00000000-0000-4000-8000-00000000c1c2";
const ACCOUNT = "00000000-0000-4000-8000-00000000c1d1";
const OFFER = "00000000-0000-4000-8000-00000000c1e1";

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  for (const id of [OWNER, PARTNER, DESK, STAFF, MANAGER, OUTSIDER]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@leads.test`]);
  await db.query("insert into public.firms (id, name, state_code, status) values ($1, 'Lead Firm', '27', 'active'), ($2, 'Other', '24', 'active')", [FIRM, OTHER]);
  await db.query(
    "insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'partner', 'active'), ($1, $4, 'front_desk', 'active'), ($1, $5, 'staff', 'active'), ($1, $6, 'manager', 'active'), ($7, $8, 'owner', 'active')",
    [FIRM, OWNER, PARTNER, DESK, STAFF, MANAGER, OTHER, OUTSIDER],
  );
  await db.query("insert into public.clients (id, firm_id, name, kind) values ($1, $2, 'Patel Textiles', 'business')", [CLIENT, FIRM]);
}
const addLead = async (lead = LEAD, enquiry: string | null = null) =>
  (await db.query("select public.add_lead($1, $2, 'Meera Shah', 'individual', 'sealed', 'index', $3, '', $4) as ok", [FIRM, lead, { service: "gst", follow_up_on: "2026-10-26" }, enquiry])).rows[0].ok as boolean;
const change = async (what: string, value: string | null = null, firm = FIRM) => (await db.query("select public.change_lead($1, $2, $3, $4) as ok", [firm, LEAD, what, value])).rows[0].ok as boolean;
const seen = async () => (await db.query("select id, stage from public.clients order by name")).rows;
const lines = async () => {
  await asOwner(db);
  return (await db.query("select action, actor_id, details from public.activity_log where firm_id = $1 and entity_id = $2 order by at, action", [FIRM, LEAD])).rows;
};

describe("leads", () => {
  it("lets the owner, a partner and the front desk add and see a lead, logged once; staff and managers never see it", () =>
    rollback(db, async () => {
      await seed();
      for (const person of [STAFF, MANAGER]) {
        await actAs(db, person);
        expect(await addLead()).toBe(false);
      }
      await actAs(db, DESK);
      expect(await addLead()).toBe(true);
      expect(await seen()).toEqual([{ id: LEAD, stage: "lead_new" }, { id: CLIENT, stage: "client" }]);
      await actAs(db, PARTNER);
      expect((await seen()).map((row) => row.id)).toContain(LEAD);
      for (const person of [STAFF, MANAGER]) {
        await actAs(db, person);
        expect(await seen()).toEqual([{ id: CLIENT, stage: "client" }]);
        expect(await change("move", "qualifying")).toBe(false);
      }
      await actAs(db, OUTSIDER);
      expect(await seen()).toEqual([]);
      expect(await change("move", "qualifying")).toBe(false);
      // The general change log stands aside: one line, saying where the lead came from.
      expect(await lines()).toEqual([{ action: "lead.added", actor_id: DESK, details: { source: "staff" } }]);
      // Nobody changes a lead's stage, details or notes but through change_lead.
      await actAs(db, OWNER);
      expect((await attempt(db, "update public.clients set stage = 'client' where id = $1", [LEAD])).ok).toBe(false);
    }));

  it("moves a lead, sets its follow up, keeps its notes sealed, marks it lost with a reason; only the owner or a partner makes it a client", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, DESK);
      expect(await addLead()).toBe(true);
      expect(await change("move", "qualifying")).toBe(true);
      expect(await change("move", "qualifying")).toBe(false);
      expect(await change("move", "client")).toBe(false);
      expect(await change("follow_up", "29 Oct")).toBe(false);
      expect(await change("follow_up", "2026-10-29")).toBe(true);
      expect(await change("followed_up")).toBe(true);
      expect(await change("notes", "sealed-notes")).toBe(true);
      expect(await change("lost")).toBe(false);
      expect(await change("lost", "price")).toBe(true);
      expect(await change("move", "proposal")).toBe(true);
      expect(await change("won")).toBe(false);
      await actAs(db, PARTNER);
      expect(await change("won")).toBe(true);
      expect(await change("move", "qualifying")).toBe(false);
      await asOwner(db);
      expect((await db.query("select stage, details, notes_enc from public.clients where id = $1", [LEAD])).rows[0]).toEqual({ stage: "client", details: { service: "gst" }, notes_enc: "sealed-notes" });
      // One transaction has one time, so the lines are compared in any order.
      const logged = (await lines()).map((line) => JSON.stringify([line.action, line.details])).sort();
      expect(logged).toEqual([
        ["lead.added", { source: "staff" }],
        ["lead.moved", { stage: "qualifying" }],
        ["lead.follow_up_set", { on: "2026-10-29" }],
        ["lead.followed_up", {}],
        ["lead.noted", {}],
        ["lead.lost", { reason: "price" }],
        ["lead.moved", { stage: "proposal" }],
        ["lead.won", {}],
      ].map((line) => JSON.stringify(line)).sort());
      // Won, it is an ordinary client that staff see, listed as won for those who work leads.
      await actAs(db, STAFF);
      expect((await seen()).map((row) => row.id)).toContain(LEAD);
      expect((await db.query("select id from public.won_leads($1)", [FIRM])).rows).toEqual([]);
      await actAs(db, DESK);
      expect((await db.query("select id, name from public.won_leads($1)", [FIRM])).rows).toEqual([{ id: LEAD, name: "Meera Shah" }]);
    }));

  it("takes the public form's leads from the server alone", () =>
    rollback(db, async () => {
      await seed();
      await actAs(db, OWNER);
      expect((await attempt(db, "select public.add_form_lead($1, $2, 'Bot', 'individual', '', '', '{}', '', 'ip')", [FIRM, LEAD])).ok).toBe(false);
      await db.query("reset role");
      await db.query("set local role service_role");
      await db.query("select public.add_form_lead($1, $2, 'Meera Shah', 'individual', 'sealed', 'index', '{}', '', 'ip-hash')", [FIRM, LEAD]);
      expect(await lines()).toEqual([{ action: "lead.added", actor_id: null, details: { source: "form", ip: "ip-hash" } }]);
      expect((await db.query("select email_enc, notes_enc from public.clients where id = $1", [LEAD])).rows[0]).toEqual({ email_enc: "sealed", notes_enc: null });
    }));

  it("shows an email offered as a lead only to those who work leads, and uses it once", () =>
    rollback(db, async () => {
      await seed();
      await db.query("insert into public.connected_accounts (id, firm_id, kind, provider, address_enc, credentials_enc) values ($1, $2, 'mail', 'imap', 'x', 'y')", [ACCOUNT, FIRM]);
      const offer = async (id: string) =>
        db.query("insert into public.email_events (id, firm_id, account_id, provider_message_id, sender_bidx, received_at, decision_source, reason_code) values ($1, $2, $3, $4, 'index', now(), 'rule', 'enquiry')", [id, FIRM, ACCOUNT, `<${id}@leads.test>`]);
      await offer(OFFER);
      const offers = async () => (await db.query("select id from public.email_events where reason_code = 'enquiry'")).rows.length;
      await actAs(db, STAFF);
      expect(await offers()).toBe(0);
      expect((await db.query("select public.dismiss_enquiry($1, $2) as ok", [FIRM, OFFER])).rows[0].ok).toBe(false);
      await actAs(db, DESK);
      expect(await offers()).toBe(1);
      expect(await addLead(LEAD, OFFER)).toBe(true);
      expect(await addLead(CLIENT.replace("c2", "c3"), OFFER)).toBe(false);
      expect(await offers()).toBe(0);
      expect((await lines())[0]).toEqual({ action: "lead.added", actor_id: DESK, details: { source: "email" } });
      const second = OFFER.replace("e1", "e2");
      await offer(second);
      await actAs(db, OWNER);
      expect((await db.query("select public.dismiss_enquiry($1, $2) as ok", [FIRM, second])).rows[0].ok).toBe(true);
      expect(await offers()).toBe(0);
      await asOwner(db);
      expect((await db.query("select action, actor_id from public.activity_log where entity_id = $1", [second])).rows).toEqual([{ action: "enquiry.dismissed", actor_id: OWNER }]);
    }));
});
