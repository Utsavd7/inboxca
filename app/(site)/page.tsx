import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, BellRing, CalendarClock, Check, FileText, History, KeyRound, LockKeyhole, MailX, Plus, ScanText, Trash2 } from "lucide-react";
import { beforeAfter, forms, guarantee, importsInto, questions, worksWith } from "@/content/site";
import { planIncludes, plans, rupees, SHOW_PLANS } from "@/content/plans";
import { contactEmail, SITE_PUBLIC, siteDescription } from "@/src/lib/site";
import { Control } from "@/components/site/control";
import { Cost } from "@/components/site/cost";
import { DrawnMark } from "@/components/site/drawn-mark";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { Plans } from "@/components/site/plans";
import { MotionRoot } from "@/components/site/reveal";
import { Stage } from "@/components/site/stage";
import { StickyStart } from "@/components/site/sticky-start";

export const metadata: Metadata = {
  title: "InboxCA | Every client email, read, filed and answered",
  description: `${siteDescription} It prepares GST returns, ITRs and TDS and TCS statements. Files stay in the firm's own drive, and the team approves every form.`,
};

// Five facts a CA asks about first, each leading to its section of the security policy.
const trust = [
  [MailX, "No email text kept", "never"],
  [KeyRound, "Your firm's own key", "encryption"],
  [LockKeyhole, "2 step sign in", "access"],
  [History, "A record nobody can edit", "access"],
  [Trash2, "Deleted files wait 30 days", "access"],
] as const;

// Search engines read these only when the site is public (robots.ts): the questions as they
// are on the page, and the plans from content/plans.ts (no GST: Orelu is not GST registered).
const structured = SITE_PUBLIC && [
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  },
  SHOW_PLANS && {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "InboxCA",
    description: siteDescription,
    brand: { "@type": "Brand", name: "Orelu" },
    offers: plans.map((plan) => ({
      "@type": "Offer",
      name: `${plan.name} plan`,
      price: plan.monthly,
      priceCurrency: "INR",
      description: `${plan.returns} returns a year, ${plan.storage} InboxCA storage a year, team ${plan.team.toLowerCase()}, no GST charged. ${planIncludes.join(", ")}.`,
      availability: "https://schema.org/InStock",
    })),
  },
].filter(Boolean);

// The forms strip: what InboxCA does with each, by icon; the dated ones move the other way below.
const formIcons = { Prepared: FileText, Matched: ArrowLeftRight, Read: ScanText, Tracked: BellRing, "Due date kept": CalendarClock };
const late = new Set<string>(["Tracked", "Due date kept"]);

// Get started on the page takes the visitor to the plans, where each plan has its own start.
function StartLink({ className = "btn btn-big" }: { className?: string }) {
  return (
    <Link className={className} href="#plans">
      Get started
      <ArrowRight size={18} aria-hidden />
    </Link>
  );
}

// A band's heading, on one line on a laptop.
function Head({ title }: { title: string }) {
  return (
    <div className="band-head reveal">
      <h2>{title}</h2>
    </div>
  );
}

// A looping row of other companies' logos, with the files each imports when given.
// Three copies, so the row still fills a wide screen.
function Logos({ list, back }: { list: readonly (readonly [string, string, number, number, string, string?])[]; back?: boolean }) {
  return (
    <div className={`marquee${back ? " marquee-back" : ""}`}>
      {[0, 1, 2].map((copy) => (
        <ul key={copy} aria-hidden={copy > 0 || undefined}>
          {list.map(([name, file, width, height, text, files]) => (
            <li key={name}>
              <Image
                src={`/brand/tools/${file}`}
                alt={text.includes(name) ? "" : name}
                width={width}
                height={height}
                style={{ width, height }}
                unoptimized
              />
              {text}
              {files && <small>{files}</small>}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <MotionRoot>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <section className="hero" id="top">
          <div className="hero-bg" aria-hidden />
          <div className="wrap">
            <div className="hero-head">
              <p className="status">
                <span className="status-dot" aria-hidden />
                For Indian CA firms. Nothing to install.
              </p>
              <h1>
                <span className="line">
                  <span>Every client email,</span>
                </span>{" "}
                <span className="line">
                  <span>read, filed and answered.</span>
                </span>
              </h1>
              <div className="hero-side">
                <p className="lead">
                  An AI back office that works from your firm&apos;s own email
                  and drive. Your team approves every form before it is filed.
                </p>
                <div className="hero-actions">
                  <StartLink />
                  <a className="btn btn-big btn-outline" href="#how-it-works">
                    See it work
                  </a>
                </div>
                <p className="hero-trust">
                  {guarantee}
                  {SHOW_PLANS && <> · From {rupees(plans[0].monthly)} a month</>}
                </p>
              </div>
            </div>
            <div className="demo-anchor" id="how-it-works">
              <h2 className="sr-only">How it works</h2>
              <Stage />
            </div>
          </div>
        </section>

        <section className="works" aria-label="Built to work with">
          <p>Built to work with what your firm already uses</p>
          <Logos list={worksWith} />
          <p>InboxCA writes the official files this filing software imports</p>
          <Logos list={importsInto} back />
        </section>

        <section className="covered" id="forms" aria-labelledby="forms-title">
          <h2 id="forms-title">Prepared, read and tracked today</h2>
          {[forms.filter(([, what]) => !late.has(what)), forms.filter(([, what]) => late.has(what))].map((row, at) => (
            <div key={at} className={`ticker${at ? " ticker-back" : ""}`}>
              {[false, true].map((copy) => (
                <ul key={String(copy)} aria-hidden={copy || undefined}>
                  {row.map(([form, what]) => {
                    const Icon = formIcons[what];
                    return (
                      <li key={form}>
                        <span className="ticker-icon"><Icon size={15} aria-hidden /></span>
                        <strong>{form}</strong>
                        <small>{what}</small>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
          ))}
        </section>

        <section className="band" id="today">
          <div className="wrap">
            <Head title="What does the chasing cost you today?" />
            <div className="site-split reveal">
              <Cost />
              <div className="site-tile shift">
                <h3>The old way, and with InboxCA</h3>
                <ul>
                  {beforeAfter.map(([before, after]) => (
                    <li key={before}>
                      <s>{before}</s>
                      <span>
                        <Check size={16} strokeWidth={3} aria-hidden />
                        {after}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="band control" id="control">
          <div className="wrap">
            <Head title="Private and secure. You stay in control." />
            <div className="reveal">
              <Control />
            </div>
            <ul className="trust" aria-label="More in the security policy">
              {trust.map(([Icon, title, section]) => (
                <li key={title}>
                  <Link href={`/security#${section}`}>
                    <Icon size={16} aria-hidden />
                    {title}
                  </Link>
                </li>
              ))}
              <li className="trust-more">
                <Link href="/security">
                  Read the security policy
                  <ArrowRight size={16} aria-hidden />
                </Link>
              </li>
            </ul>
          </div>
        </section>

        {SHOW_PLANS && (
          <section className="band" id="plans">
            <div className="wrap">
              <Head title="Priced by the work. Never by clients." />
              <div className="reveal">
                <Plans />
              </div>
            </div>
          </section>
        )}

        <section className="band band-grey" id="questions">
          <div className="wrap faq">
            <div className="faq-head">
              <h2>Questions</h2>
              <p className="band-lead">
                More answers in{" "}
                <Link className="link" href="/help">
                  Help
                </Link>
                . Anything else? Write to{" "}
                <a className="link" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              </p>
            </div>
            <div className="faq-list">
              {questions.map(([question, answer]) => (
                <details key={question} name="faq">
                  <summary>
                    {question}
                    <Plus size={18} aria-hidden />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
          <div className="wrap" id="start">
            <div className="closing reveal">
              <DrawnMark />
              <h2>Nothing pending.</h2>
              <p>That is the goal for your firm&apos;s inbox. Less chasing. More doing.</p>
              <StartLink className="btn btn-big btn-light" />
              <p className="closing-mail">
                {guarantee}. Or write to <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <StickyStart />
      {structured &&
        structured.map((data, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }}
          />
        ))}
    </MotionRoot>
  );
}
