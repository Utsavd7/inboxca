import type { Metadata } from "next";
import { helpGroups } from "@/content/help";
import { Footer } from "@/components/site/footer";
import { HelpFind } from "@/components/site/help-find";
import { Nav } from "@/components/site/nav";
import { MotionRoot } from "@/components/site/reveal";

export const metadata: Metadata = {
  title: "Help | InboxCA",
  description: "Short answers on setting up and using InboxCA: email and drive, client papers, returns, notices, your team and billing.",
};

// Only titles and first lines go to the browser for the find box; each article is its own page.
const list = helpGroups.map(({ id, title, articles }) => ({ id, title, articles: articles.map(({ slug, title: name, lead }) => ({ slug, title: name, lead })) }));

export default function Page() {
  return (
    <MotionRoot>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" className="policy help help-index">
        <div className="wrap">
          <header className="policy-head">
            <h1>Help</h1>
            <p className="lead">Short answers on setting up and using InboxCA, in a few steps each.</p>
          </header>
          <HelpFind groups={list} />
        </div>
      </main>
      <Footer />
    </MotionRoot>
  );
}
