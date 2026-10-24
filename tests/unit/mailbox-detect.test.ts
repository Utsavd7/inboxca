import { promises as dns } from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectSettings, providerFor } from "@/src/lib/mailbox";

// Finding a mailbox's servers from its address, with DNS and the web mocked.
vi.mock("node:dns", () => ({ promises: { resolveMx: vi.fn(), lookup: vi.fn() } }));
const resolveMx = vi.mocked(dns.resolveMx);
const lookup = vi.mocked(dns.lookup) as unknown as ReturnType<typeof vi.fn>;
const fetch = vi.fn();
const mx = (...hosts: string[]) => resolveMx.mockResolvedValue(hosts.map((exchange) => ({ exchange, priority: 10 })));
const ispdb = `<clientConfig><emailProvider id="rediff.test"><displayShortName>Rediff</displayShortName>
  <incomingServer type="imap"><hostname>imap.rediff.test</hostname><port>993</port></incomingServer>
  <outgoingServer type="smtp"><hostname>smtp.%EMAILDOMAIN%</hostname><port>587</port></outgoingServer></emailProvider></clientConfig>`;

beforeEach(() => {
  vi.stubGlobal("fetch", fetch);
  fetch.mockResolvedValue(new Response("", { status: 404 }));
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mx();
});
afterEach(() => vi.resetAllMocks());

describe("finding a mailbox's servers", () => {
  it("knows the common providers by the address alone, asking nothing", async () => {
    expect(await detectSettings("office@gmail.com")).toMatchObject({ name: "Gmail", imap: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465 } });
    expect(await detectSettings("ca@yahoo.co.in")).toMatchObject({ name: "Yahoo Mail", imap: { host: "imap.mail.yahoo.com" } });
    expect(await detectSettings("ca@zohomail.in")).toMatchObject({ name: "Zoho Mail", imap: { host: "imap.zoho.in" } });
    expect(await detectSettings("ca@outlook.com")).toBe("microsoft");
    expect(fetch).not.toHaveBeenCalled();
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it("maps a firm's own domain to the provider that receives its mail", async () => {
    for (const [host, imap] of [
      ["aspmx.l.google.com", "imap.gmail.com"],
      ["mx.zoho.in", "imap.zoho.in"],
      ["mx.zoho.com", "imap.zoho.com"],
      ["mailstore1.secureserver.net", "imap.secureserver.net"],
      ["mx1.hostinger.com", "imap.hostinger.com"],
    ]) {
      mx(host);
      expect(await detectSettings("office@shahandco.in")).toMatchObject({ imap: { host: imap, port: 993 } });
    }
    mx("shahandco-in.mail.protection.outlook.com");
    expect(await detectSettings("office@shahandco.in")).toBe("microsoft");
  });

  it("uses Thunderbird's public list or the domain's own settings before the mail records", async () => {
    mx("aspmx.l.google.com");
    fetch.mockImplementation(async (url: string) => new Response(url.startsWith("https://autoconfig.thunderbird.net/v1.1/rediff.test") ? ispdb : "", { status: 200 }));
    expect(await detectSettings("ca@rediff.test")).toEqual({ name: "Rediff", imap: { host: "imap.rediff.test", port: 993 }, smtp: { host: "smtp.rediff.test", port: 587 } });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://autoconfig.thunderbird.net/v1.1/rediff.test",
      "https://autoconfig.rediff.test/mail/config-v1.1.xml?emailaddress=ca%40rediff.test",
      "https://rediff.test/.well-known/autoconfig/mail/config-v1.1.xml",
    ]);
  });

  it("never asks a domain on a private network, and falls back to the usual names", async () => {
    lookup.mockImplementation(async (host: string) => [{ address: host === "autoconfig.thunderbird.net" ? "93.184.216.34" : "10.0.0.5", family: 4 }]);
    expect(await detectSettings("office@inside.test")).toEqual({ imap: { host: "imap.inside.test", port: 993 }, smtp: { host: "smtp.inside.test", port: 465 } });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://autoconfig.thunderbird.net/v1.1/inside.test"]);
  });

  it("gives plain help for a provider's password", () => {
    expect(providerFor("imap.gmail.com")?.help).toBe("Gmail needs an app password: Google Account, Security, App passwords.");
    expect(providerFor("imap.zoho.in")?.help).toContain("App passwords");
    expect(providerFor("127.0.0.1")).toBeUndefined();
  });
});
