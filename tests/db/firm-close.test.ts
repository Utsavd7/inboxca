import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// An invented firm with an owner, a staff member, a client, a connected drive and waiting work.
async function seed(db: Awaited<ReturnType<typeof connect>>) {
  const firm = randomUUID(), other = randomUUID(), owner = randomUUID(), staff = randomUUID(), outsider = randomUUID(), client = randomUUID();
  const [ownerSession, ownerPhone, staffSession] = [randomUUID(), randomUUID(), randomUUID()];
  await db.query("insert into auth.users(id,email) values($1,'invented-close-owner@close.test'),($2,'invented-close-staff@close.test'),($3,'invented-close-outsider@close.test')", [owner, staff, outsider]);
  await db.query("insert into public.firms(id,name,state_code,status) values($1,'Invented Closing Firm','24','active'),($2,'Invented Other Firm','24','active')", [firm, other]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'owner','active'),($1,$3,'staff','active'),($4,$3,'staff','active'),($4,$5,'owner','active')", [firm, owner, staff, other, outsider]);
  await db.query("insert into auth.sessions(id,user_id) values($1,$4),($2,$4),($3,$5)", [ownerSession, ownerPhone, staffSession, owner, staff]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values($1,$2,'Invented Close Client','business')", [client, firm]);
  await db.query("insert into public.tasks(firm_id,client_id,kind,code,due_on) values($1,$2,'compliance','GSTR1',current_date)", [firm, client]);
  await db.query("insert into public.connected_accounts(firm_id,kind,provider,address_enc,credentials_enc) values($1,'drive','local','invented','invented')", [firm]);
  await db.query("insert into public.jobs(firm_id,kind,idempotency_key) values($1,'reminders',$2)", [firm, `invented-close:${firm}`]);
  return { firm, other, owner, staff, outsider, client, ownerSession, ownerPhone, staffSession };
}

it("lets only the owner download the firm's data, and logs each download", async () => {
  const db = await connect();
  try {
    await rollback(db, async () => {
      const s = await seed(db);
      for (const person of [s.staff, s.outsider]) {
        await actAs(db, person);
        expect((await attempt(db, "select public.firm_export($1)", [s.firm])).ok).toBe(false);
      }
      await actAs(db, s.owner);
      const data = (await db.query("select public.firm_export($1) data", [s.firm])).rows[0].data;
      expect(data.clients).toEqual([{ id: s.client, name: "Invented Close Client", kind: "business", email_enc: null, archived_at: null }]);
      expect(data.tasks).toMatchObject([{ client_id: s.client, kind: "compliance", code: "GSTR1" }]);
      expect(data.activity).toContainEqual(expect.objectContaining({ email: "invented-close-owner@close.test", action: "firm.downloaded" }));
      await asOwner(db);
      expect((await db.query("select count(*)::int n from public.activity_log where firm_id=$1 and action='firm.downloaded'", [s.firm])).rows[0].n).toBe(1);
    });
  } finally {
    await db.end();
  }
});

it("closes the firm only for its owner with its name, and deletes it 30 days later", async () => {
  const db = await connect();
  try {
    await rollback(db, async () => {
      const s = await seed(db);
      await actAs(db, s.staff);
      expect((await attempt(db, "select public.close_firm($1,'Invented Closing Firm')", [s.firm])).ok).toBe(false);
      expect((await attempt(db, "select public.delete_firm($1)", [s.firm])).ok).toBe(false);
      await actAs(db, s.outsider);
      expect((await attempt(db, "select public.close_firm($1,'Invented Closing Firm')", [s.firm])).ok).toBe(false);
      await actAs(db, s.owner, "aal2", s.ownerSession);
      expect((await db.query("select public.close_firm($1,'Invented Other Firm') ok", [s.firm])).rows[0].ok).toBe(false);
      expect((await db.query("select public.close_firm($1,'  invented closing firm ') ok", [s.firm])).rows[0].ok).toBe(true);
      expect((await db.query("select public.close_firm($1,'Invented Closing Firm') ok", [s.firm])).rows[0].ok).toBe(false);
      // The owner keeps this session to download; the staff member is out at once.
      expect((await db.query("select count(*)::int n from public.clients")).rows[0].n).toBe(1);
      await actAs(db, s.staff);
      expect((await db.query("select count(*)::int n from public.clients where firm_id=$1", [s.firm])).rows[0].n).toBe(0);
      await asOwner(db);
      expect((await db.query("select status from public.firms where id=$1", [s.firm])).rows[0].status).toBe("closed");
      expect((await db.query("select user_id,status from public.firm_members where firm_id=$1 order by role", [s.firm])).rows).toEqual([{ user_id: s.owner, status: "active" }, { user_id: s.staff, status: "deactivated" }]);
      expect((await db.query("select status from public.firm_members where firm_id=$1", [s.other])).rows.every((m) => m.status === "active")).toBe(true);
      expect((await db.query("select id from auth.sessions where user_id = any($1)", [[s.owner, s.staff]])).rows).toEqual([{ id: s.ownerSession }]);
      expect((await db.query("select count(*)::int n from public.connected_accounts where firm_id=$1", [s.firm])).rows[0].n).toBe(0);
      expect((await db.query("select state from public.jobs where firm_id=$1", [s.firm])).rows).toEqual([{ state: "cancelled" }]);
      const job = (await db.query("select firm_id, run_at > now() + interval '29 days' later from public.jobs where kind='delete_firm' and entity_id=$1", [s.firm])).rows;
      expect(job).toEqual([{ firm_id: null, later: true }]);
      expect((await db.query("select actor_id from public.activity_log where firm_id=$1 and action='firm.closed'", [s.firm])).rows).toEqual([{ actor_id: s.owner }]);

      // Not before the 30 days are over.
      expect((await db.query("select public.delete_firm($1) ok", [s.firm])).rows[0].ok).toBe(false);
      await db.query("insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,at) values($1,$2,'firm.closed','firm',$1,now()-interval '31 days')", [s.firm, s.owner]);
      await db.query("set local role service_role");
      expect((await db.query("select public.delete_firm($1) ok", [s.firm])).rows[0].ok).toBe(true);
      await db.query("reset role");
      // The data and logins go; the firm's log stays a year longer.
      for (const table of ["clients where firm_id=$1", "tasks where firm_id=$1", "firm_members where firm_id=$1", "firm_keys where firm_id=$1"])
        expect((await db.query(`select count(*)::int n from public.${table}`, [s.firm])).rows[0].n).toBe(0);
      expect((await db.query("select count(*)::int n from public.activity_log where firm_id=$1 and action='firm.closed'", [s.firm])).rows[0].n).toBeGreaterThan(0);
      // The owner's login goes; the staff member still works for another firm.
      expect((await db.query("select id from auth.users where id = any($1) order by email", [[s.owner, s.staff, s.outsider]])).rows.map((u) => u.id)).toEqual([s.outsider, s.staff]);
      expect((await db.query("select count(*)::int n from public.firms where id=$1", [s.other])).rows[0].n).toBe(1);
      expect((await db.query("select count(*)::int n from public.jobs where kind='delete_firm' and entity_id=$1", [s.firm])).rows[0].n).toBe(2);
      // A year later the second run removes the log and the firm itself.
      await db.query("set local role service_role");
      expect((await db.query("select public.delete_firm($1) ok", [s.firm])).rows[0].ok).toBe(false);
      await db.query("reset role");
      await db.query("update public.firms set settings = jsonb_build_object('data_deleted_on', current_date - 366) where id=$1", [s.firm]);
      await db.query("set local role service_role");
      expect((await db.query("select public.delete_firm($1) ok", [s.firm])).rows[0].ok).toBe(true);
      await db.query("reset role");
      for (const table of ["firms where id=$1", "activity_log where firm_id=$1"])
        expect((await db.query(`select count(*)::int n from public.${table}`, [s.firm])).rows[0].n).toBe(0);
    });
  } finally {
    await db.end();
  }
});
