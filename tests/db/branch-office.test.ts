import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// A branch's own office (PLAN.md 5.17, 5.17.4 #13).
const FIRM = "00000000-0000-4000-8000-00000000d100";
const OWNER = "00000000-0000-4000-8000-00000000d101";
const STAFF = "00000000-0000-4000-8000-00000000d102";
const BRANCH_STAFF = "00000000-0000-4000-8000-00000000d103";
const BRANCH = "00000000-0000-4000-8000-00000000d104";
const TEAM = "00000000-0000-4000-8000-00000000d105";
const SESSION = (id: string) => `${id.slice(0, -3)}c${id.slice(-2)}`;
const MAIN = { ipv4: "203.0.113.10" };
const BRANCH_LINE = { ipv4: "198.51.100.5" };

let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

async function seed(office: object, branchSettings: object) {
  await asOwner(db);
  for (const id of [OWNER, STAFF, BRANCH_STAFF]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-3)}@branch.test`]);
    await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [SESSION(id), id]);
  }
  await db.query("insert into public.firms (id, name, state_code, status, settings) values ($1, 'Branch Firm', '24', 'active', $2)", [FIRM, { office }]);
  await db.query("insert into public.groups (id, firm_id, kind, name, settings) values ($1, $2, 'branch', 'Pune', $3), ($4, $2, 'team', 'GST', '{}')", [BRANCH, FIRM, branchSettings, TEAM]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status, branch_id) values ($1, $2, 'owner', 'active', null), ($1, $3, 'staff', 'active', null), ($1, $4, 'staff', 'active', $5)", [FIRM, OWNER, STAFF, BRANCH_STAFF, BRANCH]);
}

const role = async (person: string, withProof = false) => {
  await asOwner(db);
  const key = (await db.query("select public.office_proof_key() as key")).rows[0].key as string;
  const until = Math.floor(Date.now() / 1000) + 300;
  const proof = `${until}.${createHmac("sha256", key).update(`${person}:${SESSION(person)}:${until}`).digest("hex")}`;
  await actAs(db, person, "aal2", SESSION(person));
  await db.query("select set_config('request.headers', $1, true)", [JSON.stringify(withProof ? { "x-inboxca-office": proof } : {})]);
  const found = (await db.query("select public.member_role($1) as role", [FIRM])).rows[0].role;
  await asOwner(db);
  return found;
};
const branchOffice = async () => (await db.query("select settings -> 'office' as office from public.groups where id = $1", [BRANCH])).rows[0].office;
const firmOffice = async () => (await db.query("select settings -> 'office' as office from public.firms where id = $1", [FIRM])).rows[0].office;

describe("branch office", () => {
  it("checks a branch's people against their branch's office and everyone else against the firm's", () => rollback(db, async () => {
    // The firm is off; the branch is on.
    await seed({ on: false, lines: [] }, { office: { on: true, lines: [BRANCH_LINE] } });
    expect(await role(STAFF)).toBe("staff");
    expect(await role(BRANCH_STAFF)).toBeNull();
    expect(await role(BRANCH_STAFF, true)).toBe("staff");
    await actAs(db, BRANCH_STAFF, "aal2", SESSION(BRANCH_STAFF));
    await db.query("select set_config('request.headers', '{}', true)");
    expect((await db.query("select reason from public.closed_firms()")).rows).toEqual([{ reason: "office" }]);
    expect((await db.query("select public.end_other_sessions() as ended")).rows[0].ended).toBe(0);

    // The firm is on; the branch is off.
    await asOwner(db);
    await db.query("update public.firms set settings = $2 where id = $1", [FIRM, { office: { on: true, lines: [MAIN] } }]);
    await db.query("update public.groups set settings = $2 where id = $1", [BRANCH, { office: { on: false } }]);
    expect(await role(STAFF)).toBeNull();
    expect(await role(STAFF, true)).toBe("staff");
    expect(await role(BRANCH_STAFF)).toBe("staff");

    // A branch without its own office follows the firm's, and so does everyone once it is removed.
    await db.query("update public.groups set settings = '{}' where id = $1", [BRANCH]);
    expect(await role(BRANCH_STAFF)).toBeNull();
    expect(await role(OWNER)).toBe("owner");
  }));

  it("lets the owner switch a branch's own office, and matches and learns its lines only for its people", () => rollback(db, async () => {
    await seed({ on: true, lines: [MAIN] }, {});
    const pc = async (hash: string) => (await db.query("insert into public.devices (firm_id, token_hash, name, kind, status) values ($1, $2, 'PC', 'laptop', 'approved') returning id", [FIRM, hash.repeat(64)])).rows[0].id as string;
    const [branchPc, mainPc] = [await pc("a"), await pc("b")];
    const observe = async (person: string, device: string, line: object) =>
      (await db.query("select public.observe_office($1, $2, $3, $4) as allowed", [FIRM, person, device, line])).rows[0].allowed;

    // A branch's own office starts off with only what the owner confirms there.
    await db.query("select public.office_control($1, $2, 'on', connection => $3, branch => $4)", [FIRM, OWNER, BRANCH_LINE, BRANCH]);
    expect(await branchOffice()).toEqual({ on: true, lines: [BRANCH_LINE] });
    expect(await firmOffice()).toEqual({ on: true, lines: [MAIN] });
    expect((await attempt(db, "select public.office_control($1, $2, 'on', branch => $3)", [FIRM, OWNER, TEAM])).ok).toBe(false);

    expect(await observe(BRANCH_STAFF, branchPc, MAIN)).toBe(false);
    expect(await observe(STAFF, mainPc, BRANCH_LINE)).toBe(false);
    expect(await observe(STAFF, mainPc, MAIN)).toBe(true);
    expect(await observe(BRANCH_STAFF, branchPc, { ...BRANCH_LINE, ipv6: "2001:db8:1:2" })).toBe(true);
    expect((await branchOffice()).lines).toEqual([expect.objectContaining({ ...BRANCH_LINE, ipv6: "2001:db8:1:2" })]);
    expect((await firmOffice()).lines).toEqual([expect.objectContaining(MAIN)]);
    expect((await db.query("select count(*)::int as n from public.activity_log where firm_id = $1 and actor_id = $2 and action = 'office.refused'", [FIRM, BRANCH_STAFF])).rows[0].n).toBe(1);

    // The branch person's waiting connection is confirmed into the branch's office.
    const [request] = (await db.query("select id from public.requests where firm_id = $1 and entity_id = $2 and status = 'pending'", [FIRM, branchPc])).rows;
    await db.query("select public.office_control($1, $2, 'confirm', request_id => $3)", [FIRM, OWNER, request.id]);
    expect((await branchOffice()).lines.map((line: { ipv4: string }) => line.ipv4)).toEqual([BRANCH_LINE.ipv4, MAIN.ipv4]);
    expect((await firmOffice()).lines).toEqual([expect.objectContaining(MAIN)]);

    // Turning the branch off frees its people only; old unused lines go like the firm's.
    await db.query("select public.office_control($1, $2, 'off', branch => $3)", [FIRM, OWNER, BRANCH]);
    expect((await branchOffice()).on).toBe(false);
    expect((await firmOffice()).on).toBe(true);
    await db.query("select public.office_housekeeping($1, now() + interval '30 days')", [FIRM]);
    expect((await branchOffice()).lines).toEqual([]);
  }));
});
