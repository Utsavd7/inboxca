import { CalendarRange } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayInIndia } from "@/src/lib/calendar";
import { draftSchema, hundredths, openFigures } from "@/src/lib/datasets";
import { periodChoices, periodName } from "@/src/lib/documents";
import { grouped } from "@/src/lib/form-layout";
import { registerColumns, salesSections, type SalesSection } from "@/src/lib/gstr1-fields";
import { currentMember } from "@/src/lib/member";
import { type Work } from "@/src/lib/return-work";
import { personName } from "@/src/lib/roles";
import { gstMatchWorkItems } from "@/src/lib/work/gst-match";
import { Presence } from "../../motion";
import { returnStages } from "../../return-work";
import { Avatar, Badge, Empty, PageHead, SidePanel, type Tone } from "../../ui";
import "../../work.css";

type Params = { period?: string; who?: string; tag?: string; page?: string; rates?: string };
type Db = Awaited<ReturnType<typeof currentMember>>["supabase"];
const PAGE = 50;
const codes = ["GSTR1_M", "GSTR1_Q", "GSTR3B_M", "GSTR3B_Q"];
const uuid = /^[0-9a-f-]{36}$/;
type State = { words: string; tone: Tone; action?: string; href?: string };

// Where a GSTR-1 or GSTR-3B stands, as public.return_stages says, in a few words with the one
// thing to do next, on the return's own page. Green only when it is done.
function returnState(work: Work | undefined, filed: boolean, page: string): State {
  if (filed || work?.stage === "filed") return { words: "Filed", tone: "done" };
  switch (work?.stage) {
    case "approved": return { words: "Approved", tone: "blue", action: "Download and file", href: `${page}?tab=outputs` };
    case "draft": return { words: "Waiting for approval", tone: "blue", action: "Review", href: `${page}?tab=outputs` };
    case "filled": return { words: `Filled, ${work.open ?? 0} to check`, tone: "warn", action: "Check figures", href: work.form ? `/app/files/${work.form}/view` : `${page}?tab=outputs` };
    case "rejected": return { words: "Sent back", tone: "late", action: "Correct figures", href: `${page}?tab=extraction` };
    case "checked": return { words: "Checked, not prepared", tone: "warn", action: "Prepare", href: `${page}?tab=returns` };
    case "figures": return work.missing ? { words: work.missing === "credit" ? "Waiting for GSTR-2B" : "Waiting for the sales register", tone: "" } : { words: `Not prepared${work.open ? `, ${work.open} to check` : ""}`, tone: "warn", action: "See the return", href: `${page}?tab=returns` };
    default: return { words: "Not started", tone: "" };
  }
}

// The GST returns of one period across every client this person may see: for each, papers,
// GSTR-2B, differences from the books, GSTR-1, GSTR-3B and filing, each in a few words with
// one next step. Reads the same return_stages and gst_match_items as Today, a page of 50
// clients at a time; the row rules decide which clients a person sees.
export default async function GstMonth({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const firm = membership.firmId;
  const today = todayInIndia();
  const months = periodChoices(today).filter((key) => key.length === 7).slice(0, 12);
  // Returns for a month are filed the month after, so last month is the one being worked.
  const period = months.includes(params.period ?? "") ? params.period! : months[1];
  const who = uuid.test(params.who ?? "") ? params.who! : "";
  const tag = params.tag?.trim().slice(0, 40) ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE;
  const href = (next: { page?: number; rates?: string } = {}) => {
    const search = new URLSearchParams({ period });
    if (who) search.set("who", who);
    if (tag) search.set("tag", tag);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    if (next.rates) search.set("rates", next.rates);
    return `/app/work/gst?${search}`;
  };

  // Clients with a GST return for the period, by name; the same filter counts them.
  const clientsIn = (select: string, head = false) => {
    let query = supabase.from("clients").select(`${select}, returns:tasks!inner(id, code, status)${who ? ", looked:client_assignments!inner(user_id, team_id)" : ""}` as "id, name, tags, returns:tasks!inner(id, code, status)", { count: "exact", head }).eq("firm_id", firm).is("archived_at", null).eq("returns.kind", "compliance").eq("returns.period_key", period).in("returns.code", codes);
    if (tag) query = query.contains("tags", [tag]);
    if (who) query = query.or(`user_id.eq.${who},team_id.eq.${who}`, { referencedTable: "looked" });
    return query;
  };
  const [{ data: clients, count }, { data: people }, { data: teams }, { data: firmTags }, differences] = await Promise.all([
    clientsIn("id, name, tags").order("name").order("id").range(from, from + PAGE - 1),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabase.from("groups").select("id, name").eq("firm_id", firm).eq("kind", "team").order("name"),
    supabase.rpc("firm_tags", { target_firm: firm }),
    gstMatchWorkItems({ supabase, membership }).catch(() => []),
  ]);
  const total = count ?? 0;
  if (total && from >= total) redirect(href({ page: Math.ceil(total / PAGE) }));
  const rows = clients ?? [];
  const stages = await returnStages(supabase, firm, rows.flatMap((client) => client.returns.filter((task) => task.status !== "filed").map((task) => task.id)));
  const differing = new Map(differences.filter((item) => item.why.startsWith(`${periodName(period)}:`)).map((item) => [item.client?.id, item]));
  const active = people?.filter((person) => person.status === "active") ?? [];
  const rates = uuid.test(params.rates ?? "") && rows.some((client) => client.id === params.rates) ? await rateSummary(supabase, firm, params.rates!, period) : null;
  const ratesName = rows.find((client) => client.id === params.rates)?.name ?? "";

  return (
    <>
      <PageHead title="GST month end" crumbs={[["/app/work", "Your list"]]} sub="Every GST client for one month: what is in, what differs, and what is still to prepare or file." />
      <Form action="/app/work/gst" className="work-bar" role="search" aria-label="Choose the month and clients">
        <select name="period" defaultValue={period} aria-label="Month">
          {months.map((key) => <option key={key} value={key}>{periodName(key)}</option>)}
        </select>
        <select name="who" defaultValue={who} aria-label="Looked after by">
          <option value="">Everyone</option>
          {active.map((person) => <option key={person.user_id} value={person.user_id}>{personName(person.email)}</option>)}
          {teams?.map((team) => <option key={team.id} value={team.id}>{team.name} (team)</option>)}
        </select>
        {!!firmTags?.length && (
          <select name="tag" defaultValue={tag} aria-label="Tag">
            <option value="">Any tag</option>
            {firmTags.map((word) => <option key={word} value={word}>{word}</option>)}
          </select>
        )}
        <button className="b b-secondary" type="submit">Show</button>
      </Form>
      {rows.length ? (
        <div className="pane">
          <table className="t gst-month">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Papers</th>
                <th scope="col">GSTR-2B</th>
                <th scope="col">Differences</th>
                <th scope="col">GSTR-1</th>
                <th scope="col">GSTR-3B</th>
                <th scope="col">Filed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((client) => {
                const at = `/app/clients/${client.id}`;
                const one = client.returns.find((task) => task.code?.startsWith("GSTR1_"));
                const three = client.returns.find((task) => task.code?.startsWith("GSTR3B_"));
                const oneWork = one && stages.get(one.id), threeWork = three && stages.get(three.id);
                const lead = oneWork ?? threeWork;
                const started = !!lead && !["none", "asked", "in"].includes(lead.stage);
                // return_stages says 'sales' is missing for any GST return with no figures yet, so the
                // stage comes first: nothing asked, asked, in but not read, then what is read.
                const papers: State = one?.status === "filed" || three?.status === "filed" || (started && lead?.missing !== "sales") ? { words: "In", tone: "done" }
                  : !lead || lead.stage === "none" ? { words: "Not asked for", tone: "", action: "Ask for papers", href: `${at}?tab=documents&ask=1` }
                  : lead.stage === "asked" ? { words: "Asked for", tone: "" } : lead.stage === "in" ? { words: "In, not read yet", tone: "warn", action: "See papers", href: `${at}?tab=documents` }
                  : { words: "Sales register missing", tone: "warn", action: "Ask for papers", href: `${at}?tab=documents&ask=1` };
                const credit: State = !three ? { words: "No GSTR-3B", tone: "" } : three.status === "filed" || (threeWork && !["none", "asked", "in"].includes(threeWork.stage) && threeWork.missing !== "credit") ? { words: "In", tone: "done" }
                  : { words: "Missing", tone: "warn", action: "Add GSTR-2B", href: `${at}?tab=returns` };
                const differ = differing.get(client.id);
                const filedCount = [one, three].filter((task) => task?.status === "filed").length;
                return (
                  <tr key={client.id}>
                    <td>
                      <span className="who"><Avatar name={client.name} /><Link className="row-link" href={at}>{client.name}</Link></span>
                      {!!client.tags.length && <span className="sub">{client.tags.join(", ")}</span>}
                    </td>
                    <Cell state={papers} />
                    <Cell state={credit} />
                    <Cell state={differ ? { words: differ.why.slice(periodName(period).length + 2), tone: "warn", action: "See differences", href: differ.action.href } : { words: credit.words === "In" ? "None open" : "Waiting for GSTR-2B", tone: "" }} />
                    <Cell state={one ? returnState(oneWork, one.status === "filed", `/app/clients/${client.id}/returns/${one.id}`) : { words: "No GSTR-1 this month", tone: "" }} more={one && <Link className="b b-ghost" href={href({ page, rates: client.id })} scroll={false}>Rates</Link>} />
                    <Cell state={three ? returnState(threeWork, three.status === "filed", `/app/clients/${client.id}/returns/${three.id}`) : { words: "No GSTR-3B this month", tone: "" }} />
                    <Cell state={filedCount === client.returns.length ? { words: "Both", tone: "done" } : { words: filedCount ? `${filedCount} of ${client.returns.length}` : "Not yet", tone: "", action: "Mark filed", href: `${at}?tab=returns` }} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty Icon={CalendarRange} kind="done" title={`No GST returns for ${periodName(period)}`}>
          <span>{who || tag ? "Nobody matching has a GST return for this month." : "Clients get GST returns here once their services are set."}</span>
        </Empty>
      )}
      <nav className="pager" aria-label="List pages">
        <p>{total ? `Showing ${(from + 1).toLocaleString("en-IN")} to ${Math.min(from + PAGE, total).toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} clients` : ""}</p>
        <span>
          {page > 1 && <Link className="b b-secondary" href={href({ page: page - 1 })}>Previous</Link>}
          {from + PAGE < total && <Link className="b b-secondary" href={href({ page: page + 1 })}>Next</Link>}
        </span>
      </nav>
      <Presence>
        {rates && (
          <SidePanel key="rates" id="rates-title" title={`GSTR-1 by rate, ${ratesName}`} close={href({ page })}>
            <p className="hint">{periodName(period)}. Checked figures from the sales register only, added up by the Rate column of each sheet.{rates.pending ? ` ${rates.pending} ${rates.pending === 1 ? "figure" : "figures"} not checked yet ${rates.pending === 1 ? "is" : "are"} left out.` : ""} GSTR-3B has no rate wise table.</p>
            {rates.tables.length ? rates.tables.map((table) => (
              <table key={table.name} className="t">
                <caption className="sub">{table.name}</caption>
                <thead><tr><th scope="col">Rate</th><th scope="col" className="num">Taxable value</th><th scope="col" className="num">Cess</th><th scope="col" className="num">Rows</th></tr></thead>
                <tbody>{table.rows.map((row) => <tr key={row.rate}><td>{row.rate}%</td><td className="num">{row.taxable}</td><td className="num">{row.cess}</td><td className="num">{row.rows}</td></tr>)}</tbody>
              </table>
            )) : <p className="hint">No checked sales figures for this month yet.</p>}
          </SidePanel>
        )}
      </Presence>
    </>
  );
}

function Cell({ state, more }: { state: State; more?: React.ReactNode }) {
  return (
    <td>
      <Badge tone={state.tone} plain={!state.tone}>{state.words}</Badge>
      {(state.href || more) && <span className="sub">{state.href && <Link href={state.href}>{state.action}</Link>}{more}</span>}
    </td>
  );
}

// The checked GSTR-1 figures of a client's month, added up by rate for each sheet that has a
// Rate and a Taxable Value column (gstr1-fields.ts). Only this client's drafts are read, as the
// person; nothing is stored.
async function rateSummary(supabase: Db, firm: string, client: string, period: string) {
  const { data: drafts } = await supabase.from("datasets").select("id, data").eq("firm_id", firm).eq("client_id", client).eq("form_code", "GSTR1").eq("period_key", period).limit(25);
  const cell = /^([a-z0-9_]+)\.r(\d+)\.c(\d+)$/;
  const sums = new Map<SalesSection, Map<string, { taxable: bigint; cess: bigint; rows: number }>>();
  let pending = 0;
  for (const row of drafts ?? []) {
    const draft = draftSchema.parse(row.data), figures = await openFigures(firm, row.id, draft);
    const byRow = new Map<string, Map<number, string>>();
    for (const line of draft.lines) {
      const hit = cell.exec(line.field);
      if (!hit || !Object.hasOwn(salesSections, hit[1])) continue;
      if (line.state !== "confirmed") { pending++; continue; }
      const key = `${hit[1]}.${hit[2]}`;
      if (!byRow.has(key)) byRow.set(key, new Map());
      byRow.get(key)!.set(Number(hit[3]), figures.get(line.id)!.value);
    }
    for (const [key, cells] of byRow) {
      const section = key.split(".")[0] as SalesSection, columns = registerColumns(section);
      const rate = cells.get(columns.indexOf("Rate")), taxable = cells.get(columns.indexOf("Taxable Value")), cess = cells.get(columns.indexOf("Cess Amount"));
      if (rate === undefined || taxable === undefined) continue;
      const label = String(Number(rate));
      if (!sums.has(section)) sums.set(section, new Map());
      const at = sums.get(section)!.get(label) ?? { taxable: BigInt(0), cess: BigInt(0), rows: 0 };
      try { sums.get(section)!.set(label, { taxable: at.taxable + hundredths(taxable), cess: at.cess + hundredths(cess ?? "0"), rows: at.rows + 1 }); } catch { /* a value that is not an amount is left out */ }
    }
  }
  const rupees = (amount: bigint) => { const size = amount < BigInt(0) ? -amount : amount; return grouped(`${amount < BigInt(0) ? "-" : ""}${size / BigInt(100)}.${String(size % BigInt(100)).padStart(2, "0")}`); };
  return { pending, tables: [...sums].map(([section, rates]) => ({ name: salesSections[section].name, rows: [...rates].sort(([a], [b]) => Number(a) - Number(b)).map(([rate, sum]) => ({ rate, taxable: rupees(sum.taxable), cess: rupees(sum.cess), rows: sum.rows })) })) };
}
