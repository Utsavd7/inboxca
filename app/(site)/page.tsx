import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  History,
  KeyRound,
  LockKeyhole,
  MailX,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { makers, questions, worksWith } from "@/content/site";
import { planNotes, SHOW_PLANS } from "@/content/plans";
import { contactEmail } from "@/src/lib/site";
import { Control } from "@/components/site/control";
import { Demo } from "@/components/site/demo";
import { DrawnMark } from "@/components/site/drawn-mark";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { Plans } from "@/components/site/plans";
import { MotionRoot, Reveal } from "@/components/site/reveal";
import { SiteDialogs } from "@/components/site/site-dialogs";

// The four promises a CA asks about first. Details are on the security policy page.
const trust = [
  [MailX, "No email text kept", "Your emails stay in your mailbox."],
  [KeyRound, "Your firm's own key", "Your records are encrypted with it."],
  [LockKeyhole, "2 step sign in", "For every person in your firm."],
  [History, "Every action recorded", "Nobody can edit the record."],
] as const;

function InviteLink({ className = "btn" }: { className?: string }) {
  return (
    <a
      className={className}
      href="#invite"
      data-open-dialog="invite"
      aria-haspopup="dialog"
    >
      Ask for an invite
      <ArrowRight size={18} aria-hidden />
    </a>
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
              In development. First firms by invitation.
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
              <InviteLink />
              <a className="link" href="#how-it-works">
                See how it works
              </a>
            </div>
            <p className="hero-trust">
              <ShieldCheck size={18} aria-hidden />
              Your emails stay in your mailbox. Your files stay in your own
              drive.
            </p>
            <div className="demo-anchor" id="how-it-works">
              <h2 className="sr-only">How it works</h2>
              <Demo />
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
                {trust.map(([Icon, title, text]) => (
                  <li key={title}>
                    <Icon size={22} aria-hidden />
                    <strong>{title}</strong>
                    <span>{text}</span>
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
                <h2>Plans that follow your work.</h2>
                <p className="band-lead">
                  Every plan has every feature and unlimited clients. Prices
                  are estimates, before GST.
                </p>
              </Reveal>
              <Reveal delay={0.1}>
                <Plans />
                <ul className="plan-notes">
                  {planNotes.map(([title, text]) => (
                    <li key={title}>
                      <strong>{title}</strong>
                      {text}
                    </li>
                  ))}
                </ul>
              </Reveal>
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

        <section className="closing-band" id="invite">
          <div className="wrap">
            <Reveal className="closing">
              <DrawnMark />
              <h2>Nothing pending.</h2>
              <p>
                That is the goal for your firm&apos;s inbox. Less chasing. More
                doing.
              </p>
              <InviteLink className="btn btn-light" />
              <p className="closing-mail">
                Or write to{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </p>
            </Reveal>
            <Reveal className="makers">
              <p>InboxCA is built by Orelu.</p>
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
      <SiteDialogs />
    </MotionRoot>
  );
}
