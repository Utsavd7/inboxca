import "./leads.css";
import { Globe, MailSearch, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { activityNames } from "@/src/lib/activity";
import { dueLabel, todayInIndia } from "@/src/lib/calendar";
import { clientKinds, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { emailTemplates } from "@/src/lib/email-templates";
import { convertsLeads, EMBED_SITES, FOLLOW_UPS, leadDetails, lostReasons, openStages, proposeLead, services, stages, urgencies, worksLeads, type LeadDetails } from "@/src/lib/leads";
import { mailLive } from "@/src/lib/mail-live";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { supabaseAdmin } from "@/src/lib/supabase";
import { Pending } from "../pending";
import { Avatar, Badge, Card, Empty, NotForYou, PageHead, Row, SidePanel, Toast } from "../ui";
import { CopyButton } from "../ui-client";
import { addLead, changeLead, confirmEnquiry, dismissEnquiry, sendFollowUp, setEmbedSites, setEnquiryCapture, setEnquiryForm } from "./actions";
import { Board, type LeadCard } from "./board";
import { LeadForm } from "./lead-form";

type Search = { lead?: string; panel?: string; do?: string; write?: string; saved?: string; error?: string };
const uuid = /^[0-9a-f-]{36}$/;
const saved: Record<string, string> = {
  added: "Lead added.", move: "Lead moved.", lost: "Lead marked lost.", follow_up: "Follow up day saved.", followed_up: "Follow up email sent.", notes: "Notes saved.",
  dismissed: "Set aside. The email stays in your mailbox.", form_on: "Your enquiry form is on.", form_off: "Your enquiry form is off.", sites: "Websites saved.",
  capture_on: "InboxCA now looks for enquiries in your email.", capture_off: "InboxCA no longer looks for enquiries in your email.",
};
const errors: Record<string, string> = {
  gone: "That email was already added or set aside.", read: "The email could not be read from your mailbox just now. Try again in a minute.",
  change: "That change could not be made. Someone may have moved the lead already.", mailbox: "The email could not be sent. Check the firm's email in Settings.",
  write: "Write a subject and a message.", reason: "Choose why the lead was lost.",
};
const columns = "id, name, kind, stage, details";
const at = (when: string) => new Date(when).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Leads (PLAN.md 5.12): enquiries from the firm's form and email, on a board from New to Won.
// Everything the page shows is read in one round; the emails offered as leads are read live
// from the mailbox after it, so the board never waits for the mailbox.
export default async function Leads({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  if (!worksLeads(membership.role)) return <NotForYou title="Leads" who="the owner, partners and the front desk" />;
  const sp = await searchParams;
  const firm = membership.firmId;
  const today = todayInIndia();
  const locked = !!membership.viewOnlyUntil;
  const owner = membership.role === "owner";
  const openId = uuid.test(sp.lead ?? "") ? sp.lead! : "";
  const admin = supabaseAdmin();
  const [{ data: active }, { data: lost, count: lostCount }, { data: cold, count: coldCount }, { data: won }, { data: offers }, { data: mailbox }, { data: opened }, { data: history }, { data: people }, head] = await Promise.all([
    supabase.from("clients").select(columns).eq("firm_id", firm).in("stage", [...openStages]).order("name").limit(300),
    supabase.from("clients").select(columns, { count: "exact" }).eq("firm_id", firm).eq("stage", "lost").order("name").limit(30),
    supabase.from("clients").select(columns, { count: "exact" }).eq("firm_id", firm).eq("stage", "cold").order("name").limit(30),
    supabase.rpc("won_leads", { target_firm: firm }),
    supabase.from("email_events").select("id, provider_message_id, received_at").eq("firm_id", firm).eq("reason_code", "enquiry").order("received_at", { ascending: false }).limit(20),
    // The mailbox's settings are not open to members; only its state and the enquiries switch show.
    admin.from("connected_accounts").select("status, settings").eq("firm_id", firm).eq("kind", "mail").maybeSingle(),
    openId ? supabase.from("clients").select("id, name, kind, stage, details, email_enc, notes_enc").eq("firm_id", firm).eq("id", openId).neq("stage", "client").maybeSingle() : Promise.resolve({ data: null }),
    // A lead's history, shown only when the person's own read above finds the lead.
    openId ? admin.from("activity_log").select("at, actor_id, action, details").eq("firm_id", firm).eq("entity_type", "client").eq("entity_id", openId).order("at", { ascending: false }).limit(30) : Promise.resolve({ data: null }),
    openId ? supabase.rpc("firm_people", { target_firm: firm }) : Promise.resolve({ data: null }),
    headers(),
  ]);
  const connected = mailbox?.status === "connected";
  const capturing = connected && !!(mailbox?.settings as { capture_enquiries?: boolean } | null)?.capture_enquiries;
  const { key: formKey, sites = [] } = (membership.settings.enquiry_form ?? {}) as { key?: string; sites?: string[] };
  const formLink = formKey ? `${process.env.APP_BASE_URL ?? `https://${head.get("host")}`}/f/${formKey}` : "";
  const embed = `<iframe src="${formLink}" title="Enquiry form" width="100%" height="760" style="border:0"></iframe>`;

  const card = (row: { id: string; name: string; stage: string; details: unknown }): LeadCard => {
    const details = leadDetails(row.details);
    const day = details.follow_up_on;
    const due = !day ? "" : day < today ? "late" : day === today ? "today" : "";
    return {
      id: row.id,
      name: row.name,
      stage: row.stage,
      service: services[details.service ?? "other"],
      urgent: details.urgency === "now" && row.stage !== "lost" && row.stage !== "cold",
      due,
      follow: !day || row.stage === "lost" ? "" : due === "late" ? "Follow up late" : due === "today" ? "Follow up today" : `Follow up ${dueLabel(day).slice(0, -5)}`,
    };
  };
  const cards = [...(active ?? []), ...(lost ?? []), ...(cold ?? [])].map(card);
  const boardColumns = (Object.keys(stages) as (keyof typeof stages)[]).map((stage) => ({
    stage,
    title: stages[stage],
    more: stage === "lost" ? Math.max(0, (lostCount ?? 0) - (lost?.length ?? 0)) : stage === "cold" ? Math.max(0, (coldCount ?? 0) - (cold?.length ?? 0)) : 0,
  }));

  return (
    <div className="leads">
      <PageHead
        title="Leads"
        sub="Enquiries from your form and your email, from first contact to new client. Drag a lead to move it, or use its menu."
        actions={
          <>
            <Link className="b b-secondary" href="/app/leads?panel=setup" scroll={false}>
              <Settings2 size={16} aria-hidden />
              Ways in
            </Link>
            {!locked && (
              <Link className="b b-primary" href="/app/leads?panel=add" scroll={false}>
                <Plus size={16} aria-hidden />
                Add a lead
              </Link>
            )}
          </>
        }
      />
      {!opened && errors[sp.error ?? ""] && (
        <p className="alert" role="alert">
          {errors[sp.error!]}
        </p>
      )}
      {!!offers?.length && (
        <Suspense fallback={<OffersCard count={offers.length}><p className="app-card-none">Reading them from your mailbox</p></OffersCard>}>
          <Offers firm={firm} offers={offers} locked={locked} />
        </Suspense>
      )}
      {cards.length || won?.length ? (
        <Board columns={boardColumns} cards={cards} won={won ?? []} open={openId} locked={locked} />
      ) : (
        <Empty Icon={Globe} kind="reply" title="No leads yet">
          <span>Share your enquiry form, or let InboxCA look for enquiries in your email. New ones show here.</span>
          <Link className="b b-secondary" href="/app/leads?panel=setup" scroll={false}>
            Set up ways in
          </Link>
        </Empty>
      )}

      {opened && (
        <LeadPanel
          lead={opened}
          history={history ?? []}
          people={people ?? []}
          today={today}
          sp={sp}
          locked={locked}
          converts={convertsLeads(membership.role)}
          connected={connected}
          firm={firm}
          firmName={membership.firmName}
        />
      )}

      {sp.panel === "add" && !locked && (
        <SidePanel id="add-lead" title="Add a lead" close="/app/leads">
          <p className="hint">For an enquiry that came by phone or a visit. Only the name is needed.</p>
          <LeadForm action={addLead} hidden={{}} submit="Add lead" busy="Adding" today={today} />
        </SidePanel>
      )}

      {sp.panel === "setup" && (
        <SidePanel id="ways-in" title="Ways in" close="/app/leads">
          <section className="lead-way" aria-labelledby="way-form">
            <h3 id="way-form">Enquiry form</h3>
            <p className="hint">A page anyone can open to send you an enquiry. Put the link on your website, in your email signature or on WhatsApp. Each enquiry arrives here as a new lead.</p>
            {formLink ? (
              <>
                <p className="lead-link">
                  <span className="num">{formLink}</span>
                  <CopyButton text={formLink} label="Form link" />
                </p>
                <p className="lead-way-acts">
                  <a className="b b-secondary" href={formLink} target="_blank" rel="noreferrer">
                    Open the form
                  </a>
                  {owner && !locked && (
                    <form action={setEnquiryForm}>
                      <Pending className="b b-ghost" busy="Turning off">
                        Turn off
                      </Pending>
                    </form>
                  )}
                </p>
                {owner && <p className="hint">Turning it off stops this link. Turning it on again makes a new one.</p>}
              </>
            ) : owner && !locked ? (
              <form action={setEnquiryForm}>
                <input type="hidden" name="on" value="on" />
                <Pending className="b b-primary" busy="Turning on">
                  Turn on the form
                </Pending>
              </form>
            ) : (
              <p className="hint">The owner turns the enquiry form on.</p>
            )}
          </section>
          {formLink && (
            <section className="lead-way" aria-labelledby="way-embed">
              <h3 id="way-embed">On your website</h3>
              <p className="hint">To show the form inside a page of your website, paste this code into it. Only the websites listed below can show it.</p>
              <p className="lead-link">
                <span className="num">{embed}</span>
                <CopyButton text={embed} label="Embed code" />
              </p>
              {sp.error === "sites" && (
                <p className="alert" role="alert">
                  Type each website as its address, like https://yourfirm.in, one a line, up to {EMBED_SITES}.
                </p>
              )}
              {owner && !locked ? (
                <form action={setEmbedSites} className="lead-write">
                  <label htmlFor="embed-sites">Websites that may show the form</label>
                  <textarea id="embed-sites" name="sites" rows={3} defaultValue={sites.join("\n")} maxLength={2000} placeholder="https://yourfirm.in" />
                  <span className="lead-acts">
                    <Pending className="b b-secondary" busy="Saving">
                      Save websites
                    </Pending>
                  </span>
                </form>
              ) : (
                <p className="hint">{sites.length ? `Shown on ${sites.join(", ")}.` : "No website shows it yet. The owner lists them here."}</p>
              )}
            </section>
          )}
          <section className="lead-way" aria-labelledby="way-email">
            <h3 id="way-email">Enquiries by email</h3>
            <p className="hint">Email from someone who is not a client yet, that asks about your services, shows on this page for you to add as a lead in one click. Nothing of it is kept until you add it.</p>
            {!connected ? (
              <p className="hint">{owner ? <Link href="/app/settings#mailbox">Connect the firm&apos;s email in Settings first.</Link> : "The owner connects the firm's email first."}</p>
            ) : owner && !locked ? (
              <form action={setEnquiryCapture}>
                {!capturing && <input type="hidden" name="on" value="on" />}
                <Pending className={`b ${capturing ? "b-ghost" : "b-primary"}`} busy="Saving">
                  {capturing ? "Stop looking for enquiries" : "Look for enquiries in our email"}
                </Pending>
              </form>
            ) : (
              <p className="hint">{capturing ? "On. The owner can turn it off." : "Off. The owner can turn it on."}</p>
            )}
            {capturing && owner && <p className="ok">On. InboxCA reads email from new senders only to spot enquiries.</p>}
          </section>
        </SidePanel>
      )}

      {saved[sp.saved ?? ""] && <Toast>{saved[sp.saved!]}</Toast>}
    </div>
  );
}

function OffersCard({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <Card id="lead-offers" title="Emails that look like enquiries" Icon={MailSearch} kind="reply" count={count} countTone="warn" className="lead-offers">
      {children}
    </Card>
  );
}

// The emails offered as leads, with their sender, subject and first line read live from the
// mailbox (nothing of them is kept), and what InboxCA proposes. One click adds the lead.
async function Offers({ firm, offers, locked }: { firm: string; offers: { id: string; provider_message_id: string; received_at: string }[]; locked: boolean }) {
  const read = await mailLive(firm, "list", { inbox: offers.map((offer) => offer.provider_message_id), sent: null });
  const mails = new Map(("inbox" in read ? read.inbox : []).map((mail) => [mail.messageId, mail]));
  return (
    <OffersCard count={offers.length}>
      {"error" in read && <p className="app-card-none">Your mailbox could not be reached just now, so the emails cannot be shown. Try again in a minute.</p>}
      <ul className="app-rows">
        {offers.map((offer) => {
          const mail = mails.get(offer.provider_message_id);
          const proposal = mail && proposeLead(mail.from, mail.fromName ?? "", mail);
          return (
            <Row
              key={offer.id}
              lead={<Avatar name={proposal?.name ?? "?"} />}
              title={mail ? `${proposal!.name}, ${mail.from}` : "An email"}
              meta={mail ? `${mail.subject || "No subject"}. ${mail.snippet}` : `Received ${at(offer.received_at)}`}
              action={
                !locked && (
                  <span className="lead-offer-acts">
                    {proposal && (
                      <form action={confirmEnquiry} className="lead-offer-form">
                        <input type="hidden" name="enquiry" value={offer.id} />
                        <input name="name" defaultValue={proposal.name} aria-label="Name for the lead" maxLength={200} />
                        <select name="service" defaultValue={proposal.service} aria-label="Help needed">
                          {Object.entries(services).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <Pending className="b b-primary" busy="Adding">
                          Add as lead
                        </Pending>
                      </form>
                    )}
                    <form action={dismissEnquiry}>
                      <input type="hidden" name="enquiry" value={offer.id} />
                      <Pending className="b b-ghost" busy="Setting aside">
                        Not a lead
                      </Pending>
                    </form>
                  </span>
                )
              }
            />
          );
        })}
      </ul>
    </OffersCard>
  );
}

// One lead: its details, the follow up, notes, where it can move, and its history.
async function LeadPanel({ lead, history, people, today, sp, locked, converts, connected, firm, firmName }: {
  lead: { id: string; name: string; kind: string; stage: string; details: unknown; email_enc: string | null; notes_enc: string | null };
  history: { at: string; actor_id: string | null; action: string; details: unknown }[];
  people: { user_id: string; email: string }[];
  today: string;
  sp: Search;
  locked: boolean;
  converts: boolean;
  connected: boolean;
  firm: string;
  firmName: string;
}) {
  const crypto = serverCrypto();
  const details: LeadDetails = leadDetails(lead.details);
  const [email, phone, notes] = await Promise.all([
    lead.email_enc ? crypto.decrypt(firm, `clients/${lead.id}/email`, lead.email_enc) : "",
    details.phone_enc ? crypto.decrypt(firm, `clients/${lead.id}/phone`, details.phone_enc) : "",
    lead.notes_enc ? crypto.decrypt(firm, `clients/${lead.id}/notes`, lead.notes_enc) : "",
  ]);
  const close = "/app/leads";
  const here = (more = "") => `/app/leads?lead=${lead.id}${more}`;
  const sent = history.filter((line) => line.action === "lead.followed_up").length;
  const day = details.follow_up_on;
  const who = (actor: string | null) => (actor ? ` by ${personName(people.find((person) => person.user_id === actor)?.email)}` : "");
  const line = (entry: (typeof history)[number]) => {
    const said = (entry.details ?? {}) as { source?: string; stage?: keyof typeof stages; reason?: keyof typeof lostReasons; on?: string; next?: string };
    if (entry.action === "lead.added") return said.source === "form" ? "Came in through the enquiry form" : said.source === "email" ? `Added from an email${who(entry.actor_id)}` : `Added${who(entry.actor_id)}`;
    if (entry.action === "lead.moved") return `Moved to ${stages[said.stage!] ?? "another stage"}${who(entry.actor_id)}`;
    if (entry.action === "lead.lost") return `Marked lost${who(entry.actor_id)}: ${lostReasons[said.reason!] ?? "another reason"}`;
    if (entry.action === "lead.follow_up_set") return said.on ? `Follow up set for ${dueLabel(said.on)}${who(entry.actor_id)}` : `Follow up day cleared${who(entry.actor_id)}`;
    if (entry.action === "lead.followed_up") return `Follow up email sent${who(entry.actor_id)}`;
    return `${activityNames[entry.action] ?? "Changed"}${who(entry.actor_id)}`;
  };
  const service = services[details.service ?? "other"];
  const message = emailTemplates.followUp(lead.name, firmName, details.service && details.service !== "other" ? service : "");
  const other = (Object.keys(stages) as (keyof typeof stages)[]).filter((stage) => stage !== lead.stage && stage !== "client" && stage !== "lost");
  const tone = lead.stage === "lost" || lead.stage === "cold" ? "" : "blue";

  return (
    <SidePanel id="lead-panel" title={lead.name} close={close}>
      <div className="lead-panel-head">
        <Avatar name={lead.name} big />
        <span className="grow">
          <strong>{lead.name}</strong>
          <span className="sub">{service}</span>
        </span>
        <Badge tone={tone}>{stages[lead.stage as keyof typeof stages]}</Badge>
      </div>
      {sp.error && errors[sp.error] && (
        <p className="alert" role="alert">
          {errors[sp.error]}
        </p>
      )}

      {sp.do === "won" && !locked && (
        <section className="lead-ask" aria-labelledby="lead-won">
          <h3 id="lead-won">Turn {lead.name} into a client?</h3>
          {converts ? (
            <>
              <p className="hint">They move to Clients with their name, kind and email, and their history comes along. Add their PAN and GSTIN there.</p>
              <form action={changeLead} className="lead-acts">
                <input type="hidden" name="lead" value={lead.id} />
                <input type="hidden" name="change" value="won" />
                <Pending className="b b-primary" busy="Turning into a client">
                  Turn into a client
                </Pending>
                <Link className="b b-ghost" href={here()} scroll={false}>
                  Not yet
                </Link>
              </form>
            </>
          ) : (
            <p className="hint">The owner or a partner turns a lead into a client.</p>
          )}
        </section>
      )}
      {sp.do === "lost" && !locked && (
        <section className="lead-ask" aria-labelledby="lead-lost">
          <h3 id="lead-lost">Why was it lost?</h3>
          <form action={changeLead} className="lead-acts">
            <input type="hidden" name="lead" value={lead.id} />
            <input type="hidden" name="change" value="lost" />
            <select name="value" aria-label="Reason" defaultValue="">
              <option value="" disabled>
                Choose a reason
              </option>
              {Object.entries(lostReasons).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Pending className="b b-primary" busy="Saving">
              Mark lost
            </Pending>
          </form>
        </section>
      )}

      <dl className="props lead-props">
        <div>
          <dt>Email</dt>
          <dd>{email || "None"}</dd>
        </div>
        {phone && (
          <div>
            <dt>Phone</dt>
            <dd>{phone}</dd>
          </div>
        )}
        <div>
          <dt>Kind</dt>
          <dd>{clientKinds[lead.kind as ClientKind] ?? lead.kind}</dd>
        </div>
        <div>
          <dt>Needed</dt>
          <dd>{urgencies[details.urgency ?? "month"]}</dd>
        </div>
        {lead.stage === "lost" && details.lost_reason && (
          <div>
            <dt>Lost</dt>
            <dd>{lostReasons[details.lost_reason as keyof typeof lostReasons] ?? "Another reason"}</dd>
          </div>
        )}
      </dl>

      {lead.stage !== "lost" && (
        <section className="lead-part" aria-labelledby="lead-follow">
          <h3 id="lead-follow">Follow up</h3>
          <p className="hint">
            {day ? (day < today ? `Was due ${dueLabel(day)}. ` : `Due ${day === today ? "today" : dueLabel(day)}. `) : "No follow up day set. "}
            {sent} of {FOLLOW_UPS} follow up emails sent{sent >= FOLLOW_UPS ? ". If there is no reply, move the lead to Cold." : "."}
          </p>
          {!locked && (
            <form key={day ?? "none"} action={changeLead} className="lead-acts">
              <input type="hidden" name="lead" value={lead.id} />
              <input type="hidden" name="change" value="follow_up" />
              <input name="value" type="date" defaultValue={day} aria-label="Follow up on" />
              <Pending className="b b-secondary" busy="Saving">
                Save day
              </Pending>
            </form>
          )}
          {!locked &&
            (sp.write ? (
              email && connected ? (
                <form action={sendFollowUp} className="lead-write">
                  <input type="hidden" name="lead" value={lead.id} />
                  <label htmlFor="follow-subject">Subject</label>
                  <input id="follow-subject" name="subject" defaultValue={message.subject} maxLength={300} required />
                  <label htmlFor="follow-text">Email to {email}</label>
                  <textarea id="follow-text" name="text" rows={8} defaultValue={message.text} maxLength={20_000} required />
                  <span className="lead-acts">
                    <Pending className="b b-primary" busy="Sending">
                      Send follow up
                    </Pending>
                    <Link className="b b-ghost" href={here()} scroll={false}>
                      Cancel
                    </Link>
                  </span>
                </form>
              ) : (
                <p className="hint">{email ? "Connect the firm's email in Settings to send follow ups." : "This lead has no email address."}</p>
              )
            ) : (
              <Link className="b b-secondary" href={here("&write=1")} scroll={false}>
                Write a follow up email
              </Link>
            ))}
        </section>
      )}

      <section className="lead-part" aria-labelledby="lead-notes">
        <h3 id="lead-notes">Notes</h3>
        {locked ? (
          <p className="hint">{notes || "No notes yet."}</p>
        ) : (
          <form action={changeLead} className="lead-write">
            <input type="hidden" name="lead" value={lead.id} />
            <input type="hidden" name="change" value="notes" />
            <textarea name="value" rows={4} defaultValue={notes} maxLength={5000} aria-label="Notes about this lead" placeholder="What they need, what was said, the fee you quoted." />
            <span className="lead-acts">
              <Pending className="b b-secondary" busy="Saving">
                Save notes
              </Pending>
            </span>
          </form>
        )}
      </section>

      {!locked && (
        <section className="lead-part" aria-labelledby="lead-move">
          <h3 id="lead-move">Move it on</h3>
          <div className="lead-acts">
            {other.map((stage) => (
              <form key={stage} action={changeLead}>
                <input type="hidden" name="lead" value={lead.id} />
                <input type="hidden" name="change" value="move" />
                <input type="hidden" name="value" value={stage} />
                <Pending className="b b-secondary" busy="Moving">
                  {`Move to ${stages[stage]}`}
                </Pending>
              </form>
            ))}
            {lead.stage !== "lost" && (
              <Link className="b b-secondary" href={here("&do=lost")} scroll={false}>
                Mark lost
              </Link>
            )}
            {converts && (
              <Link className="b b-primary" href={here("&do=won")} scroll={false}>
                Turn into a client
              </Link>
            )}
          </div>
        </section>
      )}

      <section className="lead-part" aria-labelledby="lead-history">
        <h3 id="lead-history">History</h3>
        <ol className="lead-history">
          {history.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              {line(entry)}
              <span className="sub">{at(entry.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </SidePanel>
  );
}
