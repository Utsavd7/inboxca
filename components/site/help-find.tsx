"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { contactEmail } from "@/src/lib/site";

export type HelpList = readonly { id: string; title: string; articles: readonly { slug: string; title: string; lead: string; icon: ReactNode }[] }[];

// The help index: every article by group, and a box that narrows the list by title and first
// line as you type. Without scripts the whole list shows.
export function HelpFind({ groups }: { groups: HelpList }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({ ...group, articles: group.articles.filter(({ title, lead }) => `${title} ${lead}`.toLowerCase().includes(words)) }))
    .filter((group) => group.articles.length);
  const count = shown.reduce((sum, group) => sum + group.articles.length, 0);
  return (
    <>
      <div className="help-find" role="search">
        <Search size={18} aria-hidden />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an article, such as drive or reminders" aria-label="Find a help article" />
      </div>
      <p className="sr-only" role="status">
        {words ? `${count} ${count === 1 ? "article" : "articles"} found` : ""}
      </p>
      {shown.map(({ id, title, articles }) => (
        <section key={id} id={id} className="help-group" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`}>{title}</h2>
          <ul className="help-cards">
            {articles.map(({ slug, title: name, lead, icon }) => (
              <li key={slug}>
                <Link href={`/help/${slug}`}>
                  <span className="help-icon">{icon}</span>
                  <strong>{name}</strong>
                  <span>{lead}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!count && (
        <p className="help-none">
          No article matches that. Write to{" "}
          <a className="text-link" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          . We read every message.
        </p>
      )}
    </>
  );
}
