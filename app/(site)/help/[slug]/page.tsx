import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { helpArticles } from "@/content/help";
import { helpScenes } from "@/content/help-scenes";
import { contactEmail } from "@/src/lib/site";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { HelpShow } from "@/components/site/help-show";
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

// One article, set like the policy pages: steps numbered beside a small screen that plays them
// (above it on a phone), points below, then the other articles in its group. An article with
// no steps plays its points. Every article has a scene in help-scenes.tsx.
export default async function Page({ params }: Props) {
  const article = await find(params);
  if (!article) notFound();
  const { title, lead, steps, points, group } = article;
  const scene = helpScenes[article.slug];
  return (
    <MotionRoot>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" className="policy help help-article">
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
          <HelpShow frames={scene.frames} still={scene.still ?? scene.frames.length - 1} items={steps ?? points ?? []} kind={steps ? "steps" : "points"}>
            {steps && points && (
              <section className="help-part" aria-labelledby="points">
                <h2 id="points">Good to know</h2>
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
          </HelpShow>
        </div>
      </main>
      <Footer />
    </MotionRoot>
  );
}
