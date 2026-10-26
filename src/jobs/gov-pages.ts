import { unescape } from "@/src/lib/sheet";

// What each official listing page publishes, read for its entries: the title as published, the
// date as published when the page shows one (YYYY-MM-DD), and the link. Each reader is small and
// tolerant of extra markup, and throws when the page's shape has changed, so the daily check
// raises its alert instead of guessing. Titles are never reworded.
export type Entry = { title: string; date?: string; link: string };

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const text = (html: string) => unescape(html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")).replace(/\s+/g, " ").trim().slice(0, 1000);
const files = /\.(?:json|zip|xlsx?|xlsm|pdf)$/i;
// "12-Oct-2026" or "16/10/2026" (day first), as the pages print them.
export function publishedDate(value = "") {
  const [, day, month, year] = /(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})/.exec(value) ?? [];
  const number = /\d/.test(month ?? "") ? Number(month) : months.indexOf(month?.toLowerCase() ?? "") + 1;
  return year && number >= 1 && number <= 12 && Number(day) <= 31 ? `${year}-${String(number).padStart(2, "0")}-${day.padStart(2, "0")}` : undefined;
}
const rowsOf = (html: string, marker: string) => {
  const at = html.indexOf(marker);
  if (at < 0) throw new Error("Page changed");
  return html.slice(at).split(/<div class="views-row">/).slice(1);
};

// The e-filing portal's latest news: each row has its date, its text and usually a PDF.
export function efilingNews(html: string, url: string): Entry[] {
  return rowsOf(html, "view-latest-news-view").flatMap((row) => {
    const body = /class="d-flex gry-ft">([\s\S]*?)<\/div>/.exec(row)?.[1] ?? "";
    const title = text(body.replace(/<a\b[^>]*>\s*Click here\s*<\/a>/gi, ""));
    const link = /href="([^"]+)"/.exec(body)?.[1];
    const anchor = /<div id="([^"]+)"/.exec(row)?.[1];
    return title ? [{ title, date: publishedDate(/class="up-date">([^<]*)</.exec(row)?.[1]), link: link ? new URL(link, url).href : `${url}#${anchor ?? ""}` }] : [];
  });
}

// The return downloads page: each return's files under its heading, with the release date
// printed after a file when there is one.
export function itrDownloads(html: string, url: string): Entry[] {
  return rowsOf(html, "view-income-tax-returns-view").flatMap((row) => {
    const heading = text(/views-field-title[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/.exec(row)?.[1] ?? "");
    const parts = row.split(/(?=<a\b)/);
    return parts.flatMap((part) => {
      const [, href, name] = /^<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(part) ?? [];
      if (!href || !files.test(href) || !heading) return [];
      const file = decodeURIComponent(href.split("/").pop()!);
      return [{ title: `${heading}, ${text(name)} (${file})`, date: publishedDate(/latest[^<]*<span class="gry-ft">([^<]*)</i.exec(part)?.[1]), link: new URL(href, url).href }];
    });
  });
}

// Protean's e-TDS downloads: the utilities, file formats and forms in the page's main column.
export function proteanDownloads(html: string, url: string): Entry[] {
  const main = /class="main-content-area">([\s\S]*?)<\/section>/.exec(html)?.[1];
  if (!main) throw new Error("Page changed");
  return [...main.matchAll(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].flatMap(([, href, name]) =>
    files.test(href.trim()) && text(name) ? [{ title: text(name), link: new URL(href.trim(), url).href }] : [],
  );
}

// The GST portal's news and updates, as the page loads them: {"data": [{id, title, date, linkURl}]}.
export function gstNews(json: string): Entry[] {
  const list = (JSON.parse(json) as { data?: { id: string | number; title?: string; date?: string; linkURl?: string }[] }).data;
  if (!Array.isArray(list)) throw new Error("Page changed");
  return list.flatMap((item) => (item.title ? [{ title: text(item.title), date: publishedDate(item.date), link: item.linkURl?.startsWith("https://") ? item.linkURl : `https://www.gst.gov.in/newsandupdates/read/${Number(item.id)}` }] : []));
}

// The GST portal's Downloads > Offline Tools menu, whose links name the portal's servers.
const servers: Record<string, string> = { GST_CONTENT_R1_URL: "https://www.gst.gov.in", GST_TUTORIAL_R1_URL: "https://tutorial.gst.gov.in", GST_SERVICES_R1_URL: "https://services.gst.gov.in" };
export function gstOfflineTools(html: string): Entry[] {
  const menu = /<a>\s*Offline Tools\s*<\/a>\s*<ul\b[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1];
  if (!menu) throw new Error("Page changed");
  return [...menu.matchAll(/<a\b[^>]*href="\{\{servers\.(\w+)\}\}([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].flatMap(([, server, path, name]) =>
    servers[server] && text(name) ? [{ title: text(name), link: `${servers[server]}${path}` }] : [],
  );
}

// CBIC's latest GST notifications and circulars, as its tax information portal loads them.
export function cbicUpdates(json: string): Entry[] {
  const list = JSON.parse(json) as { id: number; notificationNo?: string; notificationName?: string; updatedDate?: string; updateType?: string }[];
  if (!Array.isArray(list)) throw new Error("Page changed");
  return list.flatMap((item) => {
    const kind = item.updateType === "Circular" ? "Circulars" : item.updateType === "Notification" ? "Notifications" : null;
    return item.notificationName && kind ? [{ title: text(item.notificationNo ? `${item.notificationNo}: ${item.notificationName}` : item.notificationName), date: publishedDate(item.updatedDate), link: `https://taxinformation.cbic.gov.in/view-pdf/${Number(item.id)}/ENG/${kind}` }] : [];
  });
}
