import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";
const FIRM = "00000000-0000-4000-8000-000000000dd0", OWNER = "00000000-0000-4000-8000-000000000dd1", STAFF = "00000000-0000-4000-8000-000000000dd2", MINE = "00000000-0000-4000-8000-000000000dd3", OTHER = "00000000-0000-4000-8000-000000000dd4";
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });
const feed = async (mine: boolean) => (await db.query("select action, client_name from public.activity_feed($1, now() - interval '1 day', $2)", [FIRM, mine])).rows;

// Today's "What InboxCA did today" and the bell read the owner-only log through one function:
// only lines about clients the person can open, InboxCA's own work or others' work on theirs.
it("shows InboxCA's own work and others' work on a person's clients, never hidden clients", () => rollback(db, async () => {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner@feed.test'),($2,'staff@feed.test')", [OWNER, STAFF]);
  await db.query("insert into public.firms(id,name,state_code,status,settings) values ($1,'Feed Test Firm','24','active','{\"client_visibility\":\"restricted\"}')", [FIRM]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active')", [FIRM, OWNER, STAFF]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values ($1,$3,'Mine Traders','business'),($2,$3,'Other Traders','business')", [MINE, OTHER, FIRM]);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')", [FIRM, MINE, STAFF]);
  await db.query("insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id) values ($1,null,'reminder.sent','client',$2),($1,null,'reminder.sent','client',$3),($1,$4,'email.written','client',$2),($1,$5,'email.written','client',$2),($1,null,'registration.added','client',$2)", [FIRM, MINE, OTHER, OWNER, STAFF]);
  await actAs(db, OWNER);
  expect(await feed(false)).toHaveLength(2);
  await actAs(db, STAFF);
  expect(await feed(false)).toEqual([{ action: "reminder.sent", client_name: "Mine Traders" }]);
  // The bell leaves out the person's own work (the assignment was logged with no person here).
  expect((await feed(true)).map((row) => row.action).sort()).toEqual(["assignment.added", "email.written", "reminder.sent"]);
  await actAs(db, null);
  await expect(db.query("select public.activity_feed($1, now(), false)", [FIRM])).rejects.toThrow();
}));
