import { contactEmail } from "@/src/lib/site";
import { Footer } from "./footer";
import { Nav } from "./nav";
import { MotionRoot } from "./reveal";
import { SiteDialogs } from "./site-dialogs";

export type PolicySection = {
  id: string;
  title: string;
  points: readonly string[];
};

// One layout for every policy page: title, status note, jump links, sections, contact.
export function Policy({
  title,
  lead,
  updated,
  note,
  sections,
  contactTitle,
  contactText,
}: {
  title: string;
  lead: string;
  updated: string;
  note: string;
  sections: readonly PolicySection[];
  contactTitle: string;
  contactText: string;
}) {
  return (
    <MotionRoot>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" className="policy">
        <div className="hero-bg" aria-hidden />
        <div className="wrap">
          <header className="policy-head">
            <h1>{title}</h1>
            <p className="lead">{lead}</p>
            <p className="policy-meta">
              Updated <span className="num">{updated}</span>. {note}
            </p>
          </header>
          <nav aria-label="On this page" className="policy-toc">
            {sections.map(({ id, title: name }) => (
              <a key={id} href={`#${id}`}>
                {name}
              </a>
            ))}
          </nav>
          {sections.map(({ id, title: name, points }) => (
            <section key={id} id={id} className="policy-section">
              <h2>{name}</h2>
              <ul>
                {points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
          ))}
          <section className="policy-section" id="contact">
            <h2>{contactTitle}</h2>
            <ul>
              <li>
                Write to{" "}
                <a className="link" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
                . {contactText}
              </li>
            </ul>
          </section>
        </div>
      </main>
      <Footer />
      <SiteDialogs />
    </MotionRoot>
  );
}
