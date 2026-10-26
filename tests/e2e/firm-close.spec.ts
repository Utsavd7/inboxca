import {randomBytes,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {loadEnvConfig} from "@next/env";
import {test,expect} from "@playwright/test";
import {serverCrypto} from "@/src/lib/crypto";
import {readCsv,xlsxEntries} from "@/src/lib/sheet";
import {emailStep,localSupabase,query,seedFirm,systemMail,totp} from "./local-supabase";
const local=localSupabase();
test.skip(!local.url || !local.mailUrl,"Needs local Supabase");

// PLAN.md 5.5.1: the owner downloads the firm's data and closes the firm; staff can do neither.
test("the owner downloads the firm's data and closes the firm, and staff are refused",async({page,browser})=>{
  test.setTimeout(90_000);loadEnvConfig(process.cwd());
  const key=Array.from(randomBytes(16),byte=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte%32]).join("");
  const ownerEmail=`close-owner-${randomUUID()}@invented.test`,staffEmail=`close-staff-${randomUUID()}@invented.test`,name=`Invented Closing ${randomUUID().slice(0,8)}`;
  const firm=await seedFirm(name,ownerEmail,key),staff=await seedFirm("Invented Close Staff Setup",staffEmail,key);
  const context=await browser.newContext(),person=await context.newPage();
  try {
    await query(local.dbUrl,"delete from public.firm_members where firm_id=$1 and user_id=$2",[staff.firmId,staff.ownerId]);
    await query(local.dbUrl,"insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'staff','active')",[firm.firmId,staff.ownerId]);
    const client=randomUUID();
    await query(local.dbUrl,"insert into public.clients(id,firm_id,name,kind,email_enc) values($1,$2,'Invented Close Client','business',$3)",[client,firm.firmId,await serverCrypto().encrypt(firm.firmId,`clients/${client}/email`,"accounts@invented-close.test")]);
    for(const [tab,email] of [[page,ownerEmail],[person,staffEmail]] as const) {
      await emailStep(tab,email);await tab.getByLabel("6 digit code from the app").fill(totp(key));await tab.getByRole("button",{name:"Continue"}).click();await expect(tab).toHaveURL(/\/app$/);
    }
    const origin=new URL(person.url()).origin;
    expect((await person.request.post("/app/settings/download",{headers:{Origin:origin}})).status()).toBe(404);

    await page.goto("/app/settings#data");
    const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Download your data"}).click()]);
    const files=xlsxEntries(await readFile((await download.path())!));
    expect([...files.keys()]).toEqual(["clients.csv","returns-and-notices.csv","papers.csv","activity-log.csv"]);
    expect(readCsv(files.get("clients.csv")!().toString())[1]).toEqual(["Invented Close Client","Business","accounts@invented-close.test","",""]);
    expect(files.get("activity-log.csv")!().toString()).toContain("firm.downloaded");

    await page.getByText("Close the firm",{exact:true}).last().click();
    await page.getByLabel(`Type ${name} to confirm`).fill("Another firm");await page.getByRole("button",{name:"Close the firm for good"}).click();
    await expect(page.getByText("Type the firm name exactly as it is shown.")).toBeVisible();
    await page.getByLabel(`Type ${name} to confirm`).fill(name);await page.getByRole("button",{name:"Close the firm for good"}).click();
    await expect(page.getByRole("heading",{name:"Your firm is closing"})).toBeVisible();
    await expect(page.getByRole("button",{name:"Download your data"})).toBeVisible();
    expect((await query(local.dbUrl,"select status from public.firms where id=$1",[firm.firmId]))[0].status).toBe("closed");
    // The notice before deletion comes by Orelu's system email, with the day.
    await expect.poll(()=>systemMail(ownerEmail),{timeout:15_000}).toMatch(new RegExp(`You closed ${name} on InboxCA[\\s\\S]*On \\d{1,2} \\w{3} \\d{4} InboxCA deletes your firm's data`));
    await person.goto("/app/clients");await expect(person.getByText("Invented Close Client")).toHaveCount(0);
  } finally {
    await context.close().catch(()=>{});
    await query(local.dbUrl,"delete from public.jobs where kind='delete_firm' and entity_id=$1",[firm.firmId]);
    await firm.remove();await staff.remove();
  }
});
