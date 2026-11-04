import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { helpArticles } from "@/content/help";
import { contactEmail } from "@/src/lib/site";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { MotionRoot } from "@/components/site/reveal";

// Every article is built once at build time; any other address is a 404.
export const dynamicParams = false;
export const generateStaticParams = () => helpArticles.map(({ slug }) => ({ slug }));

type Props = { params: Promise<{ slug: string }> };
const find = async (params: Props["params"]) => {
  const { slug } = await params;
  return helpArticles.find((article) => article.slug === slug);
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await find(params);
  return article ? { title: `${article.title} | Help | InboxCA`, description: article.lead } : {};
}

// One article, set like the policy pages: a narrow column, steps numbered, points below, then
// the other articles in its group.
export default async function Page({ params }: Props) {
  const article = await find(params);
  if (!article) notFound();
  const { title, lead, steps, points, group } = article;
  return (
    <MotionRoot>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" className="policy help">
        <div className="wrap">
          <nav aria-label="Breadcrumb" className="help-crumbs">
            <Link href="/help">Help</Link>
            <span aria-hidden>/</span>
            <Link href={`/help#${group.id}`}>{group.title}</Link>
          </nav>
          <header className="policy-head">
            <h1>{title}</h1>
            <p className="lead">{lead}</p>
          </header>
          {steps && (
            <section className="help-part" aria-labelledby="steps">
              <h2 id="steps">Steps</h2>
              <ol className="help-steps">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          )}
          {points && (
            <section className="help-part" aria-labelledby="points">
              <h2 id="points">{steps ? "Good to know" : "In short"}</h2>
              <ul className="help-points">
                {points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="help-part help-more" aria-labelledby="more">
            <h2 id="more">More in {group.title}</h2>
            <ul>
              {group.articles
                .filter((other) => other.slug !== article.slug)
                .map((other) => (
                  <li key={other.slug}>
                    <Link href={`/help/${other.slug}`}>{other.title}</Link>
                  </li>
                ))}
            </ul>
            <p>
              Still stuck? Write to{" "}
              <a className="text-link" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
              . We read every message.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </MotionRoot>
  );
}
