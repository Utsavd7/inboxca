import Image from "next/image";
import Link from "next/link";
import { analyticsToken, contactEmail, oreluUrl } from "@/src/lib/site";
import { Logo } from "./logo";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-inner">
          <Link href="/" aria-label="InboxCA home">
            <Logo />
          </Link>
          <p className="maker">
            A product by
            <a
              href={oreluUrl}
              target="_blank"
              rel="noopener"
              aria-label="Orelu, opens the Orelu website in a new tab"
            >
              <Image src="/brand/orelu.png" alt="" width={77} height={22} />
            </a>
          </p>
          <nav aria-label="Footer" className="footer-links">
            <Link href="/security">Security policy</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/refunds">Refunds</Link>
            <Link href="/dpa">Data processing</Link>
            <Link href="/privacy#grievance">Complaints</Link>
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </nav>
        </div>
        <p className="footnote">
          {/* True of the site's pages: the home test checks no cookie is set (security.ts, website). */}
          {analyticsToken ? "No cookies on this site. Visits are counted without knowing who you are. " : "No cookies, no tracking on this site. "}
          * Screens show sample data.{" "}
          <Link href="/security#website">About this website</Link>. InboxCA is a
          product of Orelu, a partnership firm. Other names and logos belong to
          their owners and imply no partnership.
        </p>
      </div>
    </footer>
  );
}
