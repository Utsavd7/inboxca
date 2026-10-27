import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// India only checked in the database, Remote friendly's approved devices anywhere, and the
// policy tester (PLAN.md 5.17).
const FIRM = "00000000-0000-4000-8000-00000000e100";
const OWNER = "00000000-0000-4000-8000-00000000e101";
const STAFF = "00000000-0000-4000-8000-00000000e102";
const PARTNER = "00000000-0000-4000-8000-00000000e103";
const BRANCH = "00000000-0000-4000-8000-00000000e104";
const OTHER_FIRM = "00000000-0000-4000-8000-00000000e110";
const SESSION = (id: string) => `${id.slice(0, -3)}c${id.slice(-2)}`;
const OFFICE = { ipv4: "203.0.113.10" };

let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

async function seed(settings: object) {
  await asOwner(db);
  for (const id of [OWNER, STAFF, PARTNER]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-3)}@policies.test`]);
    await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [SESSION(id), id]);
  }
  await db.query("insert into public.firms (id, name, state_code, status, settings) values ($1, 'Policy Firm', '24', 'active', $2), ($3, 'Other Firm', '24', 'active', '{}')", [FIRM, settings, OTHER_FIRM]);
  await db.query("insert into public.groups (id, firm_id, kind, name) values ($1, $2, 'branch', 'Pune')", [BRANCH, FIRM]);
  await db.query("insert into public.firm_members (firm_id, user_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'staff', 'active'), ($1, $4, 'partner', 'active')", [FIRM, OWNER, STAFF, PARTNER]);
  return (await db.query("select public.office_proof_key() as key")).rows[0].key as string;
}

// The server's proofs: the office one for this person and session, and India's.
const sign = (key: string, message: string, until = Math.floor(Date.now() / 1000) + 300) =>
  `${until}.${createHmac("sha256", key).update(`${message}:${until}`).digest("hex")}`;
const role = async (person: string, headers: Record<string, string>, aal: "aal1" | "aal2" = "aal2") => {
  await actAs(db, person, aal, SESSION(person));
  await db.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
  const found = (await db.query("select public.member_role($1) as role", [FIRM])).rows[0].role;
  const closed = (await db.query("select reason from public.closed_firms()")).rows[0]?.reason ?? null;
  await asOwner(db);
  return { role: found, closed };
};

describe("India only, in the database", () => {
  it("lets anyone it binds in only with the server's proof that the request came from India", () => rollback(db, async () => {
    const key = await seed({ access: { india_only: true } });
    const india = (person: string, until?: number) => ({ "x-inboxca-country": sign(key, `country:${person}:${SESSION(person)}`, until) });
    expect(await role(STAFF, {})).toEqual({ role: null, closed: "country" });
    expect(await role(STAFF, india(STAFF))).toEqual({ role: "staff", closed: null });
    expect(await role(PARTNER, {})).toEqual({ role: null, closed: "country" });
    // Someone else's proof, an old one, or an office proof in its place opens nothing.
    expect((await role(STAFF, india(PARTNER))).role).toBeNull();
    expect((await role(STAFF, india(STAFF, Math.floor(Date.now() / 1000) - 10))).role).toBeNull();
    expect((await role(STAFF, { "x-inboxca-country": sign(key, `${STAFF}:${SESSION(STAFF)}`) })).role).toBeNull();
    // The owner works from anywhere, and a role the owner excepts is not bound.
    expect((await role(OWNER, {})).role).toBe("owner");
    await db.query("update public.firms set settings = $2 where id = $1", [FIRM, { access: { india_only: true, roles: { partner: { india_only: false } } } }]);
    expect((await role(PARTNER, {})).role).toBe("partner");
  }));
});

describe("Remote friendly's approved devices", () => {
  it("needs the 2 step code and the approved device's proof from any connection; a branch with its own office stays in the office", () => rollback(db, async () => {
    const key = await seed({ office: { on: true, anywhere: true, lines: [] } });
    const device = { "x-inboxca-office": sign(key, `${STAFF}:${SESSION(STAFF)}`) };
    expect(await role(STAFF, device)).toEqual({ role: "staff", closed: null });
    expect(await role(STAFF, {})).toEqual({ role: null, closed: "office" });
    // The email code alone is enough only on the office connection, never with devices anywhere.
    expect((await role(STAFF, device, "aal1")).role).toBeNull();

    await db.query("update public.groups set settings = $2 where id = $1", [BRANCH, { office: { on: true, lines: [OFFICE] } }]);
    await db.query("update public.firm_members set branch_id = $3 where firm_id = $1 and user_id = $2", [FIRM, STAFF, BRANCH]);
    expect((await db.query("select private.branch_settings(settings, $2) -> 'office' as office from public.firms where id = $1", [FIRM, BRANCH])).rows[0].office)
      .toEqual({ on: true, anywhere: false, lines: [OFFICE] });
    expect((await role(STAFF, device, "aal1")).role).toBe("staff");
  }));
});

describe("the policy tester", () => {
  it("answers for the firm's own people with the rules every request meets, and only to the owner or the co-admin", () => rollback(db, async () => {
    await seed({ office: { on: true, lines: [OFFICE], deputies: [PARTNER] } });
    const pc = async (hash: string, values: string) => (await db.query(`insert into public.devices (firm_id, token_hash, name, status, kind, person_id, ends_on) values ($1, $2, 'PC', ${values}) returning id`, [FIRM, hash.repeat(64)])).rows[0].id;
    await pc("a", "'approved', 'laptop', null, null");
    await pc("b", "'waiting', null, null, null");
    await pc("c", "'refused', null, null, null");
    await pc("d", `'approved', 'personal', '${STAFF}', current_date + 3`);
    await pc("e", `'approved', 'personal', '${PARTNER}', current_date + 3`);
    const check = async (asker: string, person: string, hash: string | null, connection: object | null = OFFICE, country = "") => {
      await actAs(db, asker, "aal2", SESSION(asker));
      await db.query("select set_config('request.headers', '{}', true)");
      const result = await attempt(db, "select public.access_check($1, $2, $3, $4, $5) as found", [FIRM, person, connection, hash ? hash.repeat(64) : "", country]);
      await asOwner(db);
      return result.ok ? result.rows[0].found : "refused";
    };

    expect(await check(OWNER, STAFF, "a")).toEqual([]);
    expect(await check(OWNER, STAFF, "a", { ipv4: "192.0.2.1" })).toEqual(["connection"]);
    expect(await check(OWNER, STAFF, "a", null)).toEqual(["connection"]);
    expect(await check(OWNER, STAFF, "b")).toEqual(["pc_new"]);
    expect(await check(OWNER, STAFF, null)).toEqual(["pc_new"]);
    expect(await check(OWNER, STAFF, "c")).toEqual(["pc_refused"]);
    expect(await check(OWNER, STAFF, "d", null)).toEqual(["view_only"]);
    expect(await check(OWNER, STAFF, "e")).toEqual(["pc_personal"]);
    // The owner and partners are not bound by the office.
    expect(await check(OWNER, PARTNER, null, null)).toEqual([]);
    expect(await check(OWNER, OWNER, null, null)).toEqual([]);
    expect(await check(OWNER, "00000000-0000-4000-8000-00000000e1ff", "a")).toEqual(["not_member"]);

    // Hours, India only and approved devices anywhere, each by the same rules.
    await db.query("update public.firms set settings = $2 where id = $1", [FIRM, { office: { on: true, anywhere: true, deputies: [PARTNER] }, hours: {}, access: { hours_only: true, india_only: true } }]);
    expect(await check(OWNER, STAFF, "a", null, "US")).toEqual(["hours", "country"]);
    expect(await check(OWNER, STAFF, "a", null, "IN")).toEqual(["hours"]);
    expect(await check(OWNER, OWNER, null, null, "US")).toEqual([]);

    // Only the owner or the co-admin asks, and only about their own firm.
    expect(await check(STAFF, STAFF, "a")).toBe("refused");
    expect(await check(PARTNER, STAFF, "a")).toBe("refused");
    await db.query("update public.firms set settings = $2 where id = $1", [FIRM, { office: { on: false, deputies: [PARTNER], co_admin: PARTNER } }]);
    expect(await check(PARTNER, STAFF, "a")).toEqual([]);
    await actAs(db, OWNER, "aal2", SESSION(OWNER));
    expect((await attempt(db, "select public.access_check($1, $2, null, '', '')", [OTHER_FIRM, STAFF])).ok).toBe(false);
  }));
});

describe("the owner's computers (D38)", () => {
  // The owner's sign in token carries the digests of the computers they approved.
  const asTheOwner = async (devices: string[], headers: Record<string, string>, session = SESSION(OWNER), person = OWNER) => {
    await asOwner(db);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: person, role: "authenticated", aal: "aal2", session_id: session, app_metadata: { devices } })]);
    await db.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
  };
  const proof = (key: string, person = OWNER, session = SESSION(OWNER), until?: number) => ({ "x-inboxca-device": sign(key, `device:${person}:${session}`, until) });

  it("a computer the owner has not approved reads nothing of the firm; the server's proof for this person and session opens it", () => rollback(db, async () => {
    const key = await seed({});
    await db.query("insert into public.clients (firm_id, name, kind) values ($1, 'Invented Computer Client', 'individual')", [FIRM]);
    const reads = async (devices: string[], headers: Record<string, string>) => {
      await asTheOwner(devices, headers);
      const found = (await db.query("select public.member_role($1) as role, (select count(*)::int from public.clients) as clients", [FIRM])).rows[0];
      await asOwner(db);
      return found;
    };
    // The first computer needs no proof: the server approves it by itself.
    expect(await reads([], {})).toEqual({ role: "owner", clients: 1 });
    expect(await reads(["approved"], {})).toEqual({ role: null, clients: 0 });
    expect(await reads(["approved"], proof(key))).toEqual({ role: "owner", clients: 1 });
    // Someone else's proof, another session's, an old one, or the office proof opens nothing.
    for (const wrong of [proof(key, PARTNER), proof(key, OWNER, SESSION(STAFF)), proof(key, OWNER, SESSION(OWNER), Math.floor(Date.now() / 1000) - 10), { "x-inboxca-device": sign(key, `${OWNER}:${SESSION(OWNER)}`) }])
      expect(await reads(["approved"], wrong)).toEqual({ role: null, clients: 0 });
    // Only the owner's login is held to it.
    expect((await role(PARTNER, {})).role).toBe("partner");
  }));

  it("the owner approves or refuses from an approved computer, never from the one asking, while the request is open", () => rollback(db, async () => {
    const key = await seed({});
    const asking = ["00000000-0000-4000-8000-00000000e1a1", "00000000-0000-4000-8000-00000000e1a2", "00000000-0000-4000-8000-00000000e1a3"];
    const [first, second, old] = (await db.query(
      "insert into public.requests (firm_id, kind, entity_type, entity_id, reason_code, details, expires_at) select $1, 'alert', 'owner_device', s, 'owner_device', $2, case when s = $5 then now() - interval '1 minute' else now() + interval '30 minutes' end from unnest(array[$3, $4, $5]::uuid[]) with ordinality u (s, n) order by n returning id",
      [FIRM, { by: OWNER, name: "Chrome on Windows" }, ...asking],
    )).rows.map((row) => row.id as string);
    const review = async (request: string, decision: string, headers: Record<string, string> = proof(key), session = SESSION(OWNER), person = OWNER) => {
      await asTheOwner(["approved"], headers, session, person);
      const result = await attempt(db, "select public.review_owner_device($1, $2) as done", [request, decision]);
      await asOwner(db);
      return result.ok ? result.rows[0].done : result.error;
    };
    const status = async (id: string) => (await db.query("select status from public.requests where id = $1", [id])).rows[0].status;

    // Not from an unapproved computer, nor the asking one itself, nor a partner, nor once it ended.
    expect(await review(first, "approve", {})).toBeNull();
    expect(await review(first, "approve", proof(key, OWNER, asking[0]), asking[0])).toBeNull();
    expect(await review(first, "approve", proof(key, PARTNER, SESSION(PARTNER)), SESSION(PARTNER), PARTNER)).toBeNull();
    expect(await review(old, "approve")).toBeNull();
    expect(await status(first)).toBe("pending");
    expect(await review(first, "approve")).toBe(true);
    expect(await review(second, "refuse")).toBe(true);
    // Answered once: a second answer changes nothing.
    expect(await review(first, "refuse")).toBeNull();
    expect([await status(first), await status(second), await status(old)]).toEqual(["approved", "refused", "pending"]);
    expect((await db.query("select action from public.activity_log where firm_id = $1 and entity_type = 'owner_device' order by action", [FIRM])).rows.map((row) => row.action)).toEqual(["device.approved", "device.refused"]);
    // Only the owner sees them.
    await actAs(db, STAFF, "aal2", SESSION(STAFF));
    expect((await db.query("select count(*)::int as n from public.requests where entity_type = 'owner_device'")).rows[0].n).toBe(0);
  }));
});
