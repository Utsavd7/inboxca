import type { ReactNode } from "react";
import { contactEmail } from "@/src/lib/site";
import { Footer } from "./footer";
import { Nav } from "./nav";
import { MotionRoot } from "./reveal";

export type PolicySection = {
  id: string;
  title: string;
  points: readonly string[];
};

// One layout for every policy page, set like a policy: a narrow reading column in small
// text, the date it was last updated, a numbered contents list, numbered sections, contact.
// art: a small picture under the heading.
export function Policy({
  title,
  lead,
  updated,
  note,
  sections,
  contactTitle,
  contactText,
  art,
}: {
  title: string;
  lead: string;
  updated: string;
  note: string;
  sections: readonly PolicySection[];
  contactTitle: string;
  contactText: string;
  art?: ReactNode;
}) {
  const all = [...sections, { id: "contact", title: contactTitle }];
  return (
    <MotionRoot>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" className="policy">
        <div className="wrap">
          <header className="policy-head">
            <h1>{title}</h1>
            <p className="lead">{lead}</p>
            <p className="policy-meta">
              Last updated <span className="num">{updated}</span>. {note}
            </p>
          </header>
          {art}
          <nav aria-label="Contents" className="policy-toc">
            <p>Contents</p>
            <ol>
              {all.map(({ id, title: name }) => (
                <li key={id}>
                  <a href={`#${id}`}>{name}</a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="policy-body">
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
                  <a className="text-link" href={`mailto:${contactEmail}`}>
                    {contactEmail}
                  </a>
                  . {contactText}
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </MotionRoot>
  );
}
