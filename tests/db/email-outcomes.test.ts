import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, connect, rollback } from "./db";
const FIRM = "00000000-0000-4000-8000-000000000ee0", OWNER = "00000000-0000-4000-8000-000000000ee1", STAFF = "00000000-0000-4000-8000-000000000ee2", MINE = "00000000-0000-4000-8000-000000000ee3", OTHER = "00000000-0000-4000-8000-000000000ee4", ACCOUNT = "00000000-0000-4000-8000-000000000ee5";
let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });
const email = (n: number) => `00000000-0000-4000-8000-0000000e00${String(n).padStart(2, "0")}`;
const outcomes = async () => Object.fromEntries((await db.query("select id, outcomes from public.email_outcomes where firm_id = $1", [FIRM])).rows.map((row) => [row.id, row.outcomes]));

// The Inbox's "what InboxCA did" for each email, worked out from what the firm's records
// already hold, most pressing first, and only from what the person may see.
it("works out each email's outcome from its requests, papers, notices and receipt", () => rollback(db, async () => {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner@outcomes.test'),($2,'staff@outcomes.test')", [OWNER, STAFF]);
  await db.query("insert into public.firms(id,name,state_code,status,settings) values ($1,'Outcomes Test Firm','24','active','{\"client_visibility\":\"restricted\"}')", [FIRM]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active'),($1,$3,'staff','active')", [FIRM, OWNER, STAFF]);
  await db.query("insert into public.clients(id,firm_id,name,kind) values ($1,$3,'Mine Traders','business'),($2,$3,'Other Traders','business')", [MINE, OTHER, FIRM]);
  await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values ($1,$2,$3,'staff')", [FIRM, MINE, STAFF]);
  await db.query("insert into public.connected_accounts(id,firm_id,kind,provider,address_enc,credentials_enc) values ($1,$2,'mail','imap','x','x')", [ACCOUNT, FIRM]);
  for (let n = 1; n <= 11; n++)
    await db.query("insert into public.email_events(id,firm_id,account_id,provider_message_id,sender_bidx,client_id,received_at,label,delivery) values ($1,$2,$3,$4,'x',$5,now(),$6,$7)",
      [email(n), FIRM, ACCOUNT, `<outcome-${n}@test>`, n === 11 ? OTHER : MINE, n === 5 ? "records_current" : n === 10 ? "data_gst" : "other", n === 10 ? { ack: "sent" } : {}]);
  const tomorrow = (await db.query("select to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD') as tomorrow")).rows[0].tomorrow;
  const request = (n: number, status: string, details: object = {}) => db.query("insert into public.requests(firm_id,kind,client_id,entity_type,entity_id,status,details) values ($1,'team_reply',$2,'email',$3,$4,$5)", [FIRM, n === 11 ? OTHER : MINE, email(n), status, details]);
  await request(1, "pending");
  await request(2, "pending", { snooze: tomorrow });
  await request(7, "done", { replied: true });
  await request(9, "done");
  await request(11, "pending");
  const paper = async (n: number, status: string) => (await db.query("insert into public.documents(firm_id,client_id,work_type,document_type,drive_file_id,name,size,sha256,status,email_event_id) values ($1,$2,'gst','Purchase bills','x','Bills.pdf',1,gen_random_uuid()::text,$3,$4) returning id", [FIRM, MINE, status, email(n)])).rows[0].id;
  const share = async (n: number, status: string) => db.query("insert into public.shares(firm_id,document_id,status,email_event_id,link_token_hash,link_expires_at) values ($1,$2,$3,$4,$5,now() + interval '7 days')", [FIRM, await paper(n, "filed"), status, email(n), status === "sent" ? `hash-${n}` : null]);
  await share(3, "waiting");
  await paper(4, "to_check");
  await share(6, "sent");
  await share(7, "sent");
  await db.query("insert into public.tasks(firm_id,client_id,kind,due_on,status,details) values ($1,$2,'notice',current_date + 7,'upcoming',$3)", [FIRM, MINE, { email_event_id: email(8) }]);
  await paper(8, "earlier");

  await actAs(db, OWNER);
  expect(await outcomes()).toEqual({
    [email(1)]: ["reply"],
    [email(2)]: ["snoozed"],
    [email(3)]: ["approval", "filed"],
    [email(4)]: ["check"],
    [email(5)]: ["unanswered"],
    [email(6)]: ["answered", "filed"],
    [email(7)]: ["replied", "filed"],
    [email(8)]: ["notice", "filed"],
    [email(9)]: [],
    [email(10)]: ["answered"],
    [email(11)]: ["reply"],
  });
  // The Inbox filters on it.
  expect((await db.query("select count(*)::int n from public.email_outcomes where firm_id = $1 and outcomes @> '{filed}'", [FIRM])).rows[0].n).toBe(4);

  // With clients restricted, the staff member sees only the email of the client given to them.
  await actAs(db, STAFF);
  const seen = await outcomes();
  expect(Object.keys(seen)).toHaveLength(10);
  expect(seen[email(11)]).toBeUndefined();
  expect(seen[email(1)]).toEqual(["reply"]);
  await actAs(db, null);
  await expect(db.query("select outcomes from public.email_outcomes limit 1")).rejects.toThrow();
}));
