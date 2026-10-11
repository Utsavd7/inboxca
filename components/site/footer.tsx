import Image from "next/image";
import Link from "next/link";
import { contactEmail, oreluUrl } from "@/src/lib/site";
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
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </nav>
        </div>
        <p className="footnote">
          * Screens show sample data.{" "}
          <Link href="/security#website">About this website</Link>
        </p>
      </div>
    </footer>
  );
}
