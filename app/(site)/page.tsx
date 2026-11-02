import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Eye,
  History,
  KeyRound,
  LockKeyhole,
  MailX,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { coverage, guarantee, makers, oldWay, questions, startSteps, worksWith } from "@/content/site";
import { planIncludes, plans, SHOW_PLANS } from "@/content/plans";
import { contactEmail, SITE_PUBLIC, siteDescription } from "@/src/lib/site";
import { Control } from "@/components/site/control";
import { Cost } from "@/components/site/cost";
import { Demo } from "@/components/site/demo";
import { DrawnMark } from "@/components/site/drawn-mark";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { Plans } from "@/components/site/plans";
import { MotionRoot, Reveal } from "@/components/site/reveal";
import { StickyStart } from "@/components/site/sticky-start";
import { Week } from "@/components/site/week";

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

function StartLink({ className = "btn" }: { className?: string }) {
  return (
    <Link className={className} href="/sign-up">
      Get started
      <ArrowRight size={18} aria-hidden />
    </Link>
  );
}

export default function Home() {
  return (
    <MotionRoot>
      <noscript>
        <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <section className="hero" id="top">
          <div className="hero-bg" aria-hidden />
          <div className="wrap">
            <p className="status">
              <span className="status-dot" aria-hidden />
              Nothing to install. Set it up yourself.
            </p>
            <h1>
              <span className="line">
                <span>Every client email,</span>
              </span>{" "}
              <span className="line">
                <span>read, filed and answered.</span>
              </span>
            </h1>
            <p className="lead">
              InboxCA is an AI back office for Indian CA firms. It works from
              your firm&apos;s own email and your own drive, and your team
              approves every form before it is filed.
            </p>
            <div className="hero-actions">
              <StartLink />
              <a className="link" href="#how-it-works">
                See how it works
              </a>
            </div>
            <p className="hero-trust">
              <span>
                <BadgeCheck size={18} aria-hidden />
                {guarantee}
              </span>
              <span>
                <ShieldCheck size={18} aria-hidden />
                Your emails and files stay with you
              </span>
            </p>
            <div className="demo-anchor" id="how-it-works">
              <h2 className="sr-only">How it works</h2>
              <Demo />
              <Week />
              <p className="coverage">{coverage}</p>
            </div>
          </div>
        </section>

        <section className="works" aria-label="Built to work with">
          <p>Built to work with what your firm already uses</p>
          <div className="marquee">
            {[false, true].map((copy) => (
              <ul key={String(copy)} aria-hidden={copy || undefined}>
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
            ))}
          </div>
        </section>

        <section className="band band-grey" id="today">
          <div className="wrap">
            <Reveal className="band-head">
              <h2>What does the chasing cost you today?</h2>
              <p className="band-lead">
                Put in your own numbers. This is your firm&apos;s time, worked
                out from what you enter.
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <Cost />
            </Reveal>
            <Reveal delay={0.1}>
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
                        <Check size={16} strokeWidth={3} aria-hidden />
                        {after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Reveal>
          </div>
        </section>

        <section className="band control" id="control">
          <div className="wrap">
            <Reveal className="band-head band-head-split">
              <div>
                <h2>Private and secure. You stay in control.</h2>
                <p className="band-lead">
                  It works inside what your firm already owns. You decide what
                  it may do.
                </p>
              </div>
              <Link className="btn btn-ghost" href="/security">
                Read the security policy
                <ArrowRight size={18} aria-hidden />
              </Link>
            </Reveal>
            <Reveal>
              <ul className="trust">
                {trust.map(([Icon, title, text, section]) => (
                  <li key={title}>
                    <Link href={`/security#${section}`}>
                      <Icon size={22} aria-hidden />
                      <strong>{title}</strong>
                      <span>{text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.1}>
              <Control />
            </Reveal>
          </div>
        </section>

        {SHOW_PLANS && (
          <section className="band" id="plans">
            <div className="wrap">
              <Reveal className="band-head">
                <h2>Choose your plan and start.</h2>
                <p className="band-lead">
                  Every plan has every feature and unlimited clients. Prices
                  are estimates, before GST.
                </p>
              </Reveal>
              <Reveal delay={0.1}>
                <Plans />
              </Reveal>
              <div className="start-steps">
                <h3>How to start</h3>
                <ol>
                  {startSteps.map(([title, text], step) => (
                    <li key={title}>
                      <Reveal delay={0.12 * step}>
                        <span className="start-step num" aria-hidden>
                          {step + 1}
                        </span>
                        <strong>{title}</strong>
                        <span>{text}</span>
                      </Reveal>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        )}

        <section className="band band-grey" id="questions">
          <div className="wrap faq">
            <Reveal className="band-head">
              <h2>Questions</h2>
              <p className="band-lead">
                Not answered here? Write to{" "}
                <a className="link" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              </p>
            </Reveal>
            <Reveal delay={0.1} className="faq-list">
              {questions.map(([question, answer]) => (
                <details key={question} name="faq">
                  <summary>
                    {question}
                    <Plus size={20} aria-hidden />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="closing-band" id="start">
          <div className="wrap">
            <Reveal className="closing">
              <DrawnMark />
              <h2>Nothing pending.</h2>
              <p>
                That is the goal for your firm&apos;s inbox. Less chasing. More
                doing.
              </p>
              <StartLink className="btn btn-light" />
              <p className="guarantee closing-guarantee">{guarantee}</p>
              <p className="closing-mail">
                Or write to{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </p>
            </Reveal>
            <Reveal className="makers">
              <p>InboxCA is a product of Orelu, a partnership firm.</p>
              <ul>
                {makers.map(([name, role]) => (
                  <li key={name}>
                    <span className="avatar" aria-hidden>
                      {name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </span>
                    <span>
                      <strong>{name}</strong>
                      <small>{role}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
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
