import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { test, expect, type Page } from "@playwright/test";
import { serverCrypto } from "@/src/lib/crypto";
import { addPerson, appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// Taking work (20261113100000_take_work.sql): a staff member takes a client's GST from the Clients
// list (and Undo gives it back), their name shows on the client and on Today, the manager gives
// it to someone else, the staff member covers one return for that person, and filing the return
// clears the cover. Invented firm, people and client only.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

const tag = randomUUID().slice(0, 8);
const emails = { owner: `owner.take-${tag}@invented.test`, manager: `meera.take-${tag}@invented.test`, staff: `ravi.take-${tag}@invented.test`, other: `anita.take-${tag}@invented.test` };
const keys = { owner: appKey(), manager: appKey(), staff: appKey(), other: appKey() };
const name = `Invented Mehta Traders ${tag}`;
const chipOf = (page: Page) => page.getByRole("row").filter({ hasText: name }).locator(".desk-chip");
const desk = () => query(local.dbUrl, "select user_id, work from public.client_assignments a join public.clients c on c.id = a.client_id where c.name = $1 and a.role = 'staff'", [name]);
const todayRow = (page: Page) => page.locator(".work-rows .app-row").filter({ hasText: name });

test("staff take a client's GST, a manager gives it to someone else, and one return is covered until filed", async ({ browser }) => {
  test.setTimeout(180_000);
  loadEnvConfig(process.cwd());
  const firm = await seedFirm(`Invented Take Firm ${tag}`, emails.owner, keys.owner);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    const [, ravi, anita] = [await addPerson(firm.firmId, emails.manager, "manager", keys.manager), await addPerson(firm.firmId, emails.staff, "staff", keys.staff), await addPerson(firm.firmId, emails.other, "staff", keys.other)];
    // A client with GST and income tax returns, so it has both desks, and a GSTR-3B 5 days late.
    const crypto = serverCrypto(), client = randomUUID();
    await query(local.dbUrl, "insert into public.clients (id, firm_id, name, kind) values ($1, $2, $3, 'business')", [client, firm.firmId, name]);
    for (const [kind, services] of [["gstin", ["GSTR1_M", "GSTR3B_M"]], ["pan", ["ITR_BIZ"]]] as const)
      await query(local.dbUrl, "insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, services) values ($1, $2, $3, $4, $5, $6)", [firm.firmId, client, kind, await crypto.encrypt(firm.firmId, `clients/${client}/${kind}`, `INVENTED${kind}`), await crypto.blindIndex(firm.firmId, kind, `INVENTED${kind}${tag}`), services]);
    const [{ id: task }] = await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, kind, code, period_key, due_on) values ($1, $2, 'compliance', 'GSTR3B_M', '2026-09', (now() at time zone 'Asia/Kolkata')::date - 5) returning id", [firm.firmId, client]);
    const [staff, manager, owner] = await Promise.all(contexts.map((context) => context.newPage()));
    await signIn(staff, emails.staff, keys.staff);

    // Ravi takes GST from the Clients list in one click; Undo gives it back, and he takes it again.
    await staff.goto("/app/clients");
    await chipOf(staff).click();
    await staff.getByRole("tab", { name: "GST" }).click();
    await staff.getByRole("button", { name: "Take it" }).click();
    await expect.poll(desk).toEqual([{ user_id: ravi, work: "gst" }]);
    await staff.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(desk).toEqual([]);
    await chipOf(staff).click();
    await staff.getByRole("button", { name: "Take it" }).click();
    await expect.poll(desk).toEqual([{ user_id: ravi, work: "gst" }]);
    await expect(chipOf(staff)).toContainText("Ravi");

    // His name is on the client's header and on his Today, beside the late return.
    await staff.goto(`/app/clients/${client}`);
    await expect(staff.locator(".client-meta .desk-chip").first()).toContainText("Ravi");
    await staff.goto("/app");
    await expect(todayRow(staff).locator(".desk-chip")).toHaveAttribute("title", /Ravi/);

    // The manager gives GST to Anita: the picker finds her by name, and Enter picks her.
    await signIn(manager, emails.manager, keys.manager);
    await manager.goto("/app/clients");
    await chipOf(manager).click();
    await manager.getByRole("tab", { name: "GST" }).click();
    await manager.getByRole("combobox", { name: "Find a person" }).fill("Anita");
    await expect(manager.getByRole("option", { name: /Anita/ })).toBeVisible();
    await manager.getByRole("combobox", { name: "Find a person" }).press("Enter");
    await expect.poll(desk).toEqual([{ user_id: anita, work: "gst" }]);
    await staff.reload();
    await expect(todayRow(staff)).toHaveCount(0);

    // Ravi covers this one return for Anita (leave cover): it is his again on Today.
    await staff.goto(`/app/clients/${client}/returns/${task}`);
    await staff.locator(".rs-people .desk-chip").click();
    await staff.getByRole("tab", { name: "This return only" }).click();
    await staff.getByRole("button", { name: "I'll do this one" }).click();
    await expect.poll(async () => (await query(local.dbUrl, "select doer from public.tasks where id = $1", [task]))[0].doer).toBe(ravi);
    await staff.goto("/app");
    await expect(todayRow(staff).locator(".desk-chip")).toHaveAttribute("title", /Ravi does this return/);

    // Filing it clears the cover; the desk stays Anita's.
    await signIn(owner, emails.owner, keys.owner);
    await owner.goto(`/app/calendar?view=overdue&task=${task}`);
    await owner.getByRole("dialog", { name: "Mark filed" }).getByRole("button", { name: "Mark filed" }).click();
    await expect.poll(async () => (await query(local.dbUrl, "select status, doer from public.tasks where id = $1", [task]))[0]).toEqual({ status: "filed", doer: null });
    expect(await desk()).toEqual([{ user_id: anita, work: "gst" }]);
    for (const page of [staff, owner]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await firm.remove(emails.manager, emails.staff, emails.other);
  }
});
