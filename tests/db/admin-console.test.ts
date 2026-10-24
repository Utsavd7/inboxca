import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { actAs, asOwner, attempt, connect, rollback } from "./db";

// Orelu's admin console (M11): only a listed admin past the 2 step code reads it, and what it
// reads is firm health, never a client's name, email, documents or figures.
let db: Client;
const firm = "00000000-0000-4000-8000-000000000ad0", owner = "00000000-0000-4000-8000-000000000ad1", admin = "00000000-0000-4000-8000-000000000ad2";
const calls = ["admin_firms()", "admin_accounts()", "admin_failed_jobs()", "admin_watch()", "admin_retry_job(0)", "admin_review_change('gstr1', 'x')"];
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

async function seed() {
  await asOwner(db);
  await db.query("insert into auth.users(id,email) values ($1,'owner@admin-console.test'),($2,'admin@admin-console.test')", [owner, admin]);
  await db.query("insert into public.orelu_admins(user_id) values ($1)", [admin]);
  await db.query("insert into public.firms(id,name,state_code,status) values ($1,'Admin Console Test Firm','24','active')", [firm]);
  await db.query("insert into public.firm_members(firm_id,user_id,role,status) values ($1,$2,'owner','active')", [firm, owner]);
  const client = (await db.query("insert into public.clients(firm_id,name,kind,email_enc) values ($1,'Invented Secret Client','individual','secret@client.test') returning id", [firm])).rows[0].id;
  await db.query("insert into public.activity_log(firm_id,action,entity_type,entity_id,details) values ($1,'client.changed','client',$2,'{\"name\":\"Invented Secret Client\"}')", [firm, client]);
  const account = (await db.query("insert into public.connected_accounts(firm_id,kind,provider,address_enc,credentials_enc,settings) values ($1,'mail','imap','invented encrypted address','invented encrypted credentials','{\"mail_failures\":{\"read\":2}}') returning id", [firm])).rows[0].id;
  await db.query("insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key,state,last_error_code,run_at) values ($1,'mail_poll','account',$2,'admin-test:1','done',null,now()-interval '2 minutes'),($1,'mail_poll','account',$2,'admin-test:2','pending','mail_sign_in',now())", [firm, account]);
  const job = (await db.query("insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key,state,attempts,last_error_code) values ($1,'read_document','document',$2,'admin-test:3','failed',5,'exception') returning id", [firm, client])).rows[0].id;
  await db.query("insert into public.platform_settings(key,value) values ('watch',$1) on conflict (key) do update set value=excluded.value", [
    JSON.stringify({ sources: {}, changes: [{ source: "gstr1", name: "GSTR-1 tool", url: "https://example.test", at: "2026-10-25T00:00:00.000Z", status: "draft" }], alerts: [] }),
  ]);
  return { job, account };
}

it("refuses a firm owner and an admin who has not passed the 2 step code", () =>
  rollback(db, async () => {
    await seed();
    for (const [person, aal] of [[owner, "aal2"], [admin, "aal1"]] as const) {
      await actAs(db, person, aal);
      for (const call of calls) expect((await attempt(db, `select * from public.${call}`)).error).toBe("Orelu admins only");
      expect((await db.query("select public.is_orelu_admin() ok")).rows[0].ok).toBe(false);
    }
  }));

it("shows an admin each firm's health and no client data, and lets them retry a job and review a change", () =>
  rollback(db, async () => {
    const { job } = await seed();
    await actAs(db, admin);
    const firms = (await db.query("select * from public.admin_firms()")).rows;
    expect(firms.find((row) => row.id === firm)).toMatchObject({ name: "Admin Console Test Firm", members: 1, mailbox: true, drive: false });
    const accounts = (await db.query("select * from public.admin_accounts() where firm = 'Admin Console Test Firm'")).rows;
    expect(accounts).toMatchObject([{ kind: "mail", status: "connected", failures: 2, last_error: "mail_sign_in" }]);
    expect(accounts[0].last_run).not.toBeNull();
    const failed = (await db.query("select * from public.admin_failed_jobs()")).rows;
    expect(failed.find((row) => row.id === job)).toMatchObject({ kind: "read_document", firm: "Admin Console Test Firm", error: "exception" });
    const seen = JSON.stringify([firms, accounts, failed, (await db.query("select public.admin_watch() w")).rows]);
    for (const secret of ["Invented Secret Client", "secret@client.test", "invented encrypted"]) expect(seen).not.toContain(secret);
    expect((await db.query("select count(*)::int n from public.clients where firm_id = $1", [firm])).rows[0].n).toBe(0);

    expect((await db.query("select public.admin_retry_job($1) ok", [job])).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_review_change('gstr1', '2026-10-25T00:00:00.000Z') ok")).rows[0].ok).toBe(true);
    expect((await db.query("select public.admin_review_change('gstr1', '2026-10-25T00:00:00.000Z') ok")).rows[0].ok).toBe(false);
    await asOwner(db);
    expect((await db.query("select state, attempts from public.jobs where id = $1", [job])).rows[0]).toEqual({ state: "pending", attempts: 0 });
    expect((await db.query("select value #> '{changes,0}' c from public.platform_settings where key = 'watch'")).rows[0].c).toMatchObject({ status: "reviewed", reviewed_by: admin });
  }));
