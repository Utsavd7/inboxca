import Image from "next/image";
import Link from "next/link";
import { makers } from "@/content/site";
import { SHOW_PLANS } from "@/content/plans";
import { analyticsToken, contactEmail, oreluUrl } from "@/src/lib/site";
import { Logo } from "./logo";

// The home page's parts, then the policies. Names stay short: the policy tests find them exactly.
const product = [
  ["/#how-it-works", "Product tour"],
  ["/#week", "A busy week"],
  ["/#forms", "Forms covered"],
  ["/#control", "Privacy and control"],
  ...(SHOW_PLANS ? [["/#plans", "Plans"]] : []),
  ["/#questions", "Questions"],
  ["/help", "Help"],
];
const policyLinks = [
  ["/security", "Security policy"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
  ["/refunds", "Refunds"],
  ["/dpa", "Data processing"],
  ["/privacy#grievance", "Complaints"],
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" aria-label="InboxCA home">
              <Logo />
            </Link>
            <p>An AI back office for Indian CA firms, working from your firm&apos;s own email and drive.</p>
            <p className="maker">
              A product by
              <a href={oreluUrl} target="_blank" rel="noopener" aria-label="Orelu, opens the Orelu website in a new tab">
                <Image src="/brand/orelu.png" alt="" width={83} height={22} />
              </a>
            </p>
          </div>
          <nav aria-label="Footer" className="footer-links">
            <div>
              <p>Product</p>
              <ul>
                {product.map(([href, label]) => (
                  <li key={href}>
                    <a href={href}>{label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p>Policies</p>
              <ul>
                {policyLinks.map(([href, label]) => (
                  <li key={href}>
                    <Link href={href}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p>Contact</p>
              <ul>
                <li>
                  <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                </li>
                {makers.map(([name, role]) => (
                  <li key={name} className="footer-maker">
                    {name}
                    <small>{role}</small>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>
        {/* Who makes InboxCA on the left; the short notes about this site on the right. The no cookie
            line is true of the site's pages: the home test checks no cookie is set (security.ts, website). */}
        <div className="footnote">
          <p>
            © {new Date().getFullYear()} Orelu, a software company from Mumbai. InboxCA is its product for chartered
            accountant firms.
          </p>
          <ul>
            <li>{analyticsToken ? "No cookies. Visits are counted without knowing who you are." : "No cookies or tracking."}</li>
            <li>
              Screens show sample data. <Link href="/security#website">About this website</Link>
            </li>
            <li>
              <a href="/terms#names">Trade marks</a>
            </li>
            <li>
              <a href="/licences.txt">Open source licences</a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
