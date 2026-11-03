import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Eye,
  History,
  IndianRupee,
  KeyRound,
  LockKeyhole,
  MailX,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { coverage, forms, guarantee, oldWay, questions, startSteps, worksWith } from "@/content/site";
import { planIncludes, plans, rupees, SHOW_PLANS } from "@/content/plans";
import { contactEmail, SITE_PUBLIC, siteDescription } from "@/src/lib/site";
import { Control } from "@/components/site/control";
import { Cost } from "@/components/site/cost";
import { DrawnMark } from "@/components/site/drawn-mark";
import { Faq } from "@/components/site/faq";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { Plans } from "@/components/site/plans";
import { MotionRoot } from "@/components/site/reveal";
import { Stage } from "@/components/site/stage";
import { StickyStart } from "@/components/site/sticky-start";

export const metadata: Metadata = {
  title: "InboxCA | Every client email, read, filed and answered",
  description: `${siteDescription} Files stay in the firm's own drive, and the team approves every form.`,
};

// Six facts a CA asks about first, each leading to its section of the security policy.
const trust = [
  [MailX, "No email text kept", "Your emails stay in your mailbox.", "never"],
  [KeyRound, "Your firm's own key", "Your records are encrypted with it.", "encryption"],
  [LockKeyhole, "2 step sign in", "An email code, plus a phone code or an approved office PC.", "access"],
  [History, "Every action recorded", "Nobody can edit the record, the owner included.", "access"],
  [Trash2, "Deleted files wait 30 days", "So they can be brought back.", "access"],
  [Eye, "Your drive checked daily", "You are told if its folder is shared or has a link.", "access"],
] as const;

// Search engines read these only when the site is public (robots.ts): the questions as they
// are on the page, and the plans from content/plans.ts, before GST.
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
      description: `${plan.returns} returns a year, ${plan.storage} InboxCA storage a year, team ${plan.team.toLowerCase()}, before GST. ${planIncludes.join(", ")}.`,
      availability: "https://schema.org/InStock",
    })),
  },
].filter(Boolean);

function StartLink({ className = "btn btn-big" }: { className?: string }) {
  return (
    <Link className={className} href="/sign-up">
      Get started
      <ArrowRight size={18} aria-hidden />
    </Link>
  );
}

// A section's small label and heading, the same on every band.
function Head({ label, title, lead, children }: { label?: string; title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="band-head reveal">
      <div>
        {label && <p className="eyebrow">{label}</p>}
        <h2>{title}</h2>
      </div>
      <div className="band-side">
        {lead && <p className="band-lead">{lead}</p>}
        {children}
      </div>
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
              <div>
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
              </div>
              <div className="hero-side">
                <p className="lead">
                  InboxCA is an AI back office that works from your firm&apos;s
                  own email and your own drive. Your team approves every form
                  before it is filed.
                </p>
                <div className="hero-actions">
                  <StartLink />
                  <a className="btn btn-big btn-outline" href="#how-it-works">
                    See it work
                  </a>
                </div>
                <ul className="hero-trust">
                  <li>
                    <BadgeCheck size={17} aria-hidden />
                    {guarantee}
                  </li>
                  <li>
                    <ShieldCheck size={17} aria-hidden />
                    Your emails and files stay with you
                  </li>
                  {SHOW_PLANS && (
                    <li>
                      <IndianRupee size={17} aria-hidden />
                      From {rupees(plans[0].monthly)} a month, before GST
                    </li>
                  )}
                </ul>
              </div>
            </div>
            <div className="demo-anchor" id="how-it-works">
              <h2 className="sr-only">How it works</h2>
              <Stage />
            </div>
          </div>
        </section>

        <section className="covered" id="forms" aria-labelledby="forms-title">
          <div className="wrap covered-head">
            <h2 id="forms-title">Covered today</h2>
            <p>{coverage}</p>
          </div>
          <div className="ticker">
            {[false, true].map((copy) => (
              <ul key={String(copy)} aria-hidden={copy || undefined}>
                {forms.map(([form, what]) => (
                  <li key={form}>
                    <span className="num">{form}</span>
                    <small>{what}</small>
                  </li>
                ))}
              </ul>
            ))}
          </div>
          <div className="wrap works">
            <p>Works with what your firm already uses</p>
            <ul>
              {worksWith.map(([name, file, width, height, text]) => (
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
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="band band-grey" id="today">
          <div className="wrap">
            <Head
              label="Your firm today"
              title="What does the chasing cost you today?"
              lead="Put in your own numbers. This is your firm's time, worked out from what you enter."
            />
            <div className="reveal">
              <Cost />
            </div>
            <div className="reveal">
              <table className="old-way">
                <caption className="sr-only">The old way against InboxCA</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">What</span>
                    </th>
                    <th scope="col">The old way</th>
                    <th scope="col" className="old-way-new">
                      With InboxCA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {oldWay.map(([what, before, after]) => (
                    <tr key={what}>
                      <th scope="row">{what}</th>
                      <td>{before}</td>
                      <td className="old-way-new">
                        <span>
                          <Check size={16} strokeWidth={3} aria-hidden />
                          {after}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="band control" id="control">
          <div className="wrap">
            <Head
              label="Privacy and control"
              title="Private and secure. You stay in control."
              lead="It works inside what your firm already owns. You decide what it may do."
            >
              <Link className="btn btn-ghost" href="/security">
                Read the security policy
                <ArrowRight size={18} aria-hidden />
              </Link>
            </Head>
            <div className="reveal">
              <Control />
            </div>
            <ul className="trust reveal">
              {trust.map(([Icon, title, text, section]) => (
                <li key={title}>
                  <Link href={`/security#${section}`}>
                    <Icon size={20} aria-hidden />
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {SHOW_PLANS && (
          <section className="band" id="plans">
            <div className="wrap">
              <Head
                label="Plans"
                title="Choose your plan and start."
                lead="Every plan has every feature and unlimited clients. Prices are estimates, before GST."
              />
              <div className="reveal">
                <Plans />
              </div>
              <div className="start-steps reveal">
                <h3>How to start</h3>
                <ol>
                  {startSteps.map(([title, text], step) => (
                    <li key={title}>
                      <span className="start-step num" aria-hidden>
                        {step + 1}
                      </span>
                      <strong>{title}</strong>
                      <span>{text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        )}

        <section className="band band-grey" id="questions">
          <div className="wrap faq">
            <div className="band-head">
              <p className="eyebrow">Questions</p>
              <h2>Before you start</h2>
              <p className="band-lead">
                Not answered here? Write to{" "}
                <a className="link" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              </p>
            </div>
            <Faq />
          </div>
          <div className="wrap" id="start">
            <div className="closing reveal">
              <DrawnMark />
              <h2>Nothing pending.</h2>
              <p>
                That is the goal for your firm&apos;s inbox. Less chasing. More
                doing.
              </p>
              <StartLink className="btn btn-big btn-light" />
              <p className="guarantee closing-guarantee">{guarantee}</p>
              <p className="closing-mail">
                Or write to{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
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
