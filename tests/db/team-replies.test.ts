import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";

// Emails InboxCA cannot answer, for people (PLAN.md "Inbox, answered" E): who each is for, how
// long it has waited and whether it is late, and the owner's 09:00 list.
const id = (n: number) => `00000000-0000-4000-8000-00000007e${String(n).padStart(3, "0")}`;
const FIRM = id(1), QUIET = id(2), ACCOUNT = id(3), QUIET_ACCOUNT = id(4), TEAM = id(5);
const [OWNER, PARTNER, MANAGER, STAFF, OTHER, GONE] = [id(10), id(11), id(12), id(13), id(14), id(15)];
const [PEOPLE, MANAGED, TEAMED, NOBODY, LEFT] = [id(20), id(21), id(22), id(23), id(24)];
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

// An email that came the given number of days ago (India time, at noon), waiting for a person.
const waits = async (n: number, client: string | null, daysAgo: number, details: object = {}, firm = FIRM) => {
  await db.query(
    "insert into public.email_events(id,firm_id,account_id,provider_message_id,sender_bidx,client_id,received_at,label) values ($1,$2,$3,$4,'x',$5,(((now() at time zone 'Asia/Kolkata')::date - $6::int) + time '12:00') at time zone 'Asia/Kolkata','other')",
    [id(100 + n), firm, firm === FIRM ? ACCOUNT : QUIET_ACCOUNT, `<team-${n}@test>`, client, daysAgo],
  );
  await db.query("insert into public.requests(firm_id,kind,client_id,entity_type,entity_id,reason_code,details) values ($1,'team_reply',$2,'email',$3,'no_rule',$4)", [firm, client, id(100 + n), details]);
};
type Reply = { email_id: string; assignee: string | null; days: number; late: boolean };
const replies = async () => Object.fromEntries((await db.query<Reply>("select email_id, assignee, days, late from public.team_replies($1)", [FIRM])).rows.map((row) => [row.email_id, row])) as Record<string, Reply>;
const settings = (value: object) => db.query("update public.firms set settings = $2 where id = $1", [FIRM, value]);

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) select unnest($1::uuid[]), unnest($2::text[])", [[OWNER, PARTNER, MANAGER, STAFF, OTHER, GONE], ["owner", "partner", "manager", "staff", "other", "gone"].map((name) => `${name}@team-replies.test`)]);
  await db.query("insert into public.firms(id,name,state_code,status,settings) values ($1,'Team Replies Firm','24','active','{\"client_visibility\":\"restricted\"}'),($2,'Quiet Firm','24','active','{}')", [FIRM, QUIET]);
  await db.query("insert into public.groups(id,firm_id,kind,name) values ($1,$2,'team','GST team')", [TEAM, FIRM]);
  await db.query(
    "insert into public.firm_members(firm_id,user_id,role,status,team_id) values ($1,$2,'owner','active',null),($1,$3,'partner','active',null),($1,$4,'manager','active',$8),($1,$5,'staff','active',$8),($1,$6,'staff','active',null),($1,$7,'staff','deactivated',null),($9,$2,'owner','active',null)",
    [FIRM, OWNER, PARTNER, MANAGER, STAFF, OTHER, GONE, TEAM, QUIET],
  );
  await db.query("insert into public.clients(id,firm_id,name,kind) select unnest($1::uuid[]), $2, unnest($3::text[]), 'business'", [[PEOPLE, MANAGED, TEAMED, NOBODY, LEFT], FIRM, ["People Traders", "Managed Traders", "Teamed Traders", "Nobody Traders", "Left Traders"]]);
  await db.query(
    "insert into public.client_assignments(firm_id,client_id,user_id,team_id,role) values ($1,$2,$6,null,'partner_in_charge'),($1,$2,$7,null,'manager'),($1,$2,$8,null,'staff'),($1,$3,$6,null,'partner_in_charge'),($1,$3,$7,null,'manager'),($1,$4,null,$9,'staff'),($1,$5,$10,null,'staff')",
    [FIRM, PEOPLE, MANAGED, TEAMED, LEFT, PARTNER, MANAGER, OTHER, TEAM, GONE],
  );
  await db.query("insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values ($1,$2,'mail','imap','x','x'),($3,$4,'mail','imap','x','x')", [ACCOUNT, FIRM, QUIET_ACCOUNT, QUIET]);
}

it("gives each waiting email to the client's person, the team's manager or the owner, unless someone chose", () => rollback(db, async () => {
  await seed();
  const tomorrow = (await db.query("select to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD') as day")).rows[0].day;
  await waits(1, PEOPLE, 0);
  await waits(2, MANAGED, 0);
  await waits(3, TEAMED, 0);
  await waits(4, NOBODY, 0);
  await waits(5, LEFT, 0);
  await waits(6, null, 0);
  await waits(7, PEOPLE, 0, { assignee: STAFF });
  await waits(8, PEOPLE, 0, { assignee: null });
  await waits(9, PEOPLE, 0, { snooze: tomorrow });
  await actAs(db, OWNER);
  const seen = await replies();
  expect(Object.fromEntries(Object.entries(seen).map(([email, row]) => [email, row.assignee]))).toEqual({
    [id(101)]: OTHER, // the staff member assigned, before the manager and the partner in charge
    [id(102)]: MANAGER, // the manager, before the partner in charge
    [id(103)]: MANAGER, // only a team: its manager, before its staff
    [id(104)]: OWNER, // nobody assigned
    [id(105)]: OWNER, // the person assigned has left the firm
    [id(106)]: OWNER, // no client known yet
    [id(107)]: STAFF, // a teammate chose
    [id(108)]: null, // a teammate chose nobody
  });
  // The client's people change: emails nobody chose for follow them.
  await asOwner(db);
  await db.query("delete from public.client_assignments where client_id = $1 and user_id = $2", [PEOPLE, OTHER]);
  await actAs(db, OWNER);
  expect((await replies())[id(101)].assignee).toBe(MANAGER);
  expect((await replies())[id(107)].assignee).toBe(STAFF);

  // With clients restricted, a staff member sees only the emails of the clients given to them,
  // and mail from no known client, which everyone sees.
  await actAs(db, STAFF);
  expect(Object.keys(await replies()).sort()).toEqual([id(103), id(106)]);
  await actAs(db, null);
  expect((await db.query("select count(*)::int n from pg_proc where proname = 'team_replies' and has_function_privilege('anon', oid, 'execute')")).rows[0].n).toBe(0);
}));

it("counts the days an email waited and makes it late after the firm's working days, Sundays and holidays left out", () => rollback(db, async () => {
  await seed();
  await waits(1, PEOPLE, 0);
  await waits(2, PEOPLE, 3);
  await waits(3, PEOPLE, 10);
  const days = (await db.query("select array_agg(to_char((now() at time zone 'Asia/Kolkata')::date - n, 'YYYY-MM-DD')) as last from generate_series(0, 2) n")).rows[0].last as string[];
  const late = async () => Object.fromEntries(Object.entries(await replies()).map(([email, row]) => [email, row.late]));
  await actAs(db, OWNER);
  expect(Object.values(await replies()).map((row) => row.days)).toEqual([10, 3, 0]);
  // Two working days unless the owner chose: three days ago is late only when none of them was a Sunday.
  const sunday = (await db.query("select bool_or(extract(isodow from d::date) = 7) as any from unnest($1::text[]) d", [days])).rows[0].any;
  expect(await late()).toEqual({ [id(101)]: false, [id(102)]: !sunday, [id(103)]: true });
  await asOwner(db);
  await settings({ client_visibility: "restricted", reply_days: 1 });
  await actAs(db, OWNER);
  expect(await late()).toEqual({ [id(101)]: false, [id(102)]: true, [id(103)]: true });
  // The firm's holidays do not count.
  await asOwner(db);
  await settings({ client_visibility: "restricted", reply_days: 1, holidays: days });
  await actAs(db, OWNER);
  expect(await late()).toEqual({ [id(101)]: false, [id(102)]: false, [id(103)]: true });
  await asOwner(db);
  await settings({ client_visibility: "restricted", reply_days: 5 });
  await actAs(db, OWNER);
  expect(await late()).toEqual({ [id(101)]: false, [id(102)]: false, [id(103)]: true });
}));

it("queues the owner's 09:00 list once a day for a firm with an email waiting more than a day, unless it is off", () => rollback(db, async () => {
  await seed();
  await waits(1, PEOPLE, 2);
  await waits(2, null, 0, {}, QUIET);
  const queued = async () => (await db.query("select firm_id from public.jobs where kind = 'reply_waiting' and firm_id = any($1)", [[FIRM, QUIET]])).rows.map((row) => row.firm_id);
  await db.query("select private.queue_reply_waiting()");
  await db.query("select private.queue_reply_waiting()");
  expect(await queued()).toEqual([FIRM]);
  await db.query("delete from public.jobs where kind = 'reply_waiting' and firm_id = $1", [FIRM]);
  // Snoozed to a later day, it waits for that day; with the list off, nothing is queued.
  await db.query("update public.requests set details = jsonb_build_object('snooze', to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD')) where firm_id = $1", [FIRM]);
  await db.query("select private.queue_reply_waiting()");
  expect(await queued()).toEqual([]);
  await db.query("update public.requests set details = '{}' where firm_id = $1", [FIRM]);
  await settings({ reply_list: false });
  await db.query("select private.queue_reply_waiting()");
  expect(await queued()).toEqual([]);
  expect((await db.query("select count(*)::int n from cron.job where jobname = 'reply-waiting' and schedule = '30 3 * * *'")).rows[0].n).toBe(1);
}));
