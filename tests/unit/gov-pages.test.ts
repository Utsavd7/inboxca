import { expect, it } from "vitest";
import { cbicUpdates, efilingNews, gstNews, gstOfflineTools, itrDownloads, proteanDownloads, publishedDate } from "@/src/jobs/gov-pages";

// Small invented pages in the shape each official page has (checked live on 26 Oct 2026); the
// words and links are invented, not copied.
it("reads dates as the pages print them, and nothing else", () => {
  expect(publishedDate(" 12-Oct-2026")).toBe("2026-10-12");
  expect(publishedDate("16/10/2026")).toBe("2026-10-16");
  expect(publishedDate("5-Sep-2026")).toBe("2026-09-05");
  expect(publishedDate("2026-10-16")).toBeUndefined();
  expect(publishedDate("31-Foo-2026")).toBeUndefined();
  expect(publishedDate()).toBeUndefined();
});

it("reads the e-filing portal's latest news: date, the text as published without Click here, and its PDF", () => {
  const html = `<nav><div class="views-row">Menu row</div></nav><div class="view view-latest-news-view"><div class="view-content">
    <div class="views-row"><div class="views-field"><span class="field-content"><div id="a1" class="d-flex"><div class="up-date"> 12-Oct-2026</div></div>
    <div class="d-flex gry-ft"> <p>Invented Notification No. 1/2026 &amp; Form 99.&nbsp;<a href="/iec/foportal/sites/default/files/2026-10/invented.pdf">Click here</a></p></div></span></div></div>
    <div class="views-row"><div class="views-field"><span class="field-content"><div id="b2" class="d-flex"><div class="up-date"> 01-Sep-2026</div></div>
    <div class="d-flex gry-ft"> <p>An invented line</p><p>in two paragraphs.</p></div></span></div></div>
  </div></div>`;
  expect(efilingNews(html, "https://www.incometax.gov.in/iec/foportal/latest-news")).toEqual([
    { title: "Invented Notification No. 1/2026 & Form 99.", date: "2026-10-12", link: "https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-10/invented.pdf" },
    { title: "An invented line in two paragraphs.", date: "2026-09-01", link: "https://www.incometax.gov.in/iec/foportal/latest-news#b2" },
  ]);
  // A year with no news yet is an empty list; a page without the list is a changed page.
  expect(efilingNews('<div class="view view-latest-news-view"></div>', "https://www.incometax.gov.in/")).toEqual([]);
  expect(() => efilingNews("<html>Maintenance</html>", "https://www.incometax.gov.in/")).toThrow("Page changed");
});

it("reads the return downloads page: each file under its return, with its latest release date", () => {
  const html = `<div class="view view-income-tax-returns-view"><div class="views-row">
    <div class="views-field views-field-title"><span class="field-content"><a href="#itr 9" id="itr 9">ITR 9 </a></span></div>
    <div class="field--item"><a href="/iec/foportal/sites/default/files/2026-08/ITR9_Invented_V1.2.zip" download>Utility Excel Based</a></div>
    <span class="gry-ft">(Version 1.2)</span><div class="d-flex">Date of release of latest version of utility <span class="gry-ft">31-Jul-2026</span></div>
    <div class="field--item"><a href="/iec/foportal/sites/default/files/2026-06/ITR-9_2026_Main_V1.1.json" download>Schema</a></div>
    <div class="field--item"><a href="/iec/foportal/help/itr-9">Help</a></div>
  </div></div>`;
  expect(itrDownloads(html, "https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns")).toEqual([
    { title: "ITR 9, Utility Excel Based (ITR9_Invented_V1.2.zip)", date: "2026-07-31", link: "https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-08/ITR9_Invented_V1.2.zip" },
    { title: "ITR 9, Schema (ITR-9_2026_Main_V1.1.json)", date: undefined, link: "https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/ITR-9_2026_Main_V1.1.json" },
  ]);
  expect(() => itrDownloads("<p>Moved</p>", "https://www.incometax.gov.in/")).toThrow("Page changed");
});

it("reads Protean's e-TDS downloads from the main column only, skipping links that go nowhere", () => {
  const html = `<nav><a href="/downloads/menu.pdf">Menu file</a></nav><div class="main-content-area">
    <p><span class="blink">New </span><a href="https://tinpan.proteantech.in/downloads/e-tds/download/TDS_RPU_9.9.zip" target="_blank">RPU version 9.9 for invented statements</a></p>
    <li><a href="#">File Format Version 2.0 (Expected to be released soon.)</a></li>
    <li><a href="/downloads/e-tds/Invented Format.xlsx">File Format for Form Number 999</a></li>
    <li><a href="/faq.html">FAQs</a></li>
  </div></section>`;
  expect(proteanDownloads(html, "https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html")).toEqual([
    { title: "RPU version 9.9 for invented statements", link: "https://tinpan.proteantech.in/downloads/e-tds/download/TDS_RPU_9.9.zip" },
    { title: "File Format for Form Number 999", link: "https://tinpan.proteantech.in/downloads/e-tds/Invented%20Format.xlsx" },
  ]);
  expect(() => proteanDownloads("<p>Moved</p>", "https://tinpan.proteantech.in/")).toThrow("Page changed");
});

it("reads the GST portal's news as its page loads it, linking each to its own page", () => {
  const json = JSON.stringify({ data: [
    { id: 901, title: "Invented advisory on  GSTR-1", order: "1", date: "16/10/2026", IsExternal: "N", linkURl: "", content: "<p>Long text</p>" },
    { id: 900, title: "Invented outside link", date: "13/10/2026", IsExternal: "Y", linkURl: "https://tutorial.gst.gov.in/invented.pdf" },
  ] });
  expect(gstNews(json)).toEqual([
    { title: "Invented advisory on GSTR-1", date: "2026-10-16", link: "https://www.gst.gov.in/newsandupdates/read/901" },
    { title: "Invented outside link", date: "2026-10-13", link: "https://tutorial.gst.gov.in/invented.pdf" },
  ]);
  expect(() => gstNews('{"error":"busy"}')).toThrow("Page changed");
});

it("reads the GST portal's Offline Tools menu, naming each link's server", () => {
  const html = `<a>Returns</a><ul><li><a data-ng-href="{{servers.GST_CONTENT_R1_URL}}/returns">Not a tool</a></li></ul>
    <li class="has-sub"><a>Offline Tools</a><ul class="isubmenu down">
      <li><a data-ng-href="{{servers.GST_CONTENT_R1_URL}}/download/invented">Invented Offline
          Tool</a></li>
      <li><a data-ng-href="{{servers.GST_TUTORIAL_R1_URL}}/offlineutilities/Invented.zip">GSTR 99 Offline Tool</a></li>
      <li><a data-ng-href="{{servers.UNKNOWN_URL}}/x">Somewhere else</a></li>
    </ul></li>`;
  expect(gstOfflineTools(html)).toEqual([
    { title: "Invented Offline Tool", link: "https://www.gst.gov.in/download/invented" },
    { title: "GSTR 99 Offline Tool", link: "https://tutorial.gst.gov.in/offlineutilities/Invented.zip" },
  ]);
  expect(() => gstOfflineTools("<ul></ul>")).toThrow("Page changed");
});

it("reads CBIC's latest GST notifications and circulars, number first", () => {
  const json = JSON.stringify([
    { id: 1001, notificationNo: "99/2026-Central Tax", notificationName: "Seeks to invent a rule.", updatedDate: "07-May-2026", updateType: "Notification" },
    { id: 1002, notificationNo: "", notificationName: "An invented clarification", updatedDate: "25-Jul-2026", updateType: "Circular" },
    { id: 1003, notificationNo: "1/2026", notificationName: "An invented order", updatedDate: "25-Jul-2026", updateType: "Order" },
  ]);
  expect(cbicUpdates(json)).toEqual([
    { title: "99/2026-Central Tax: Seeks to invent a rule.", date: "2026-05-07", link: "https://taxinformation.cbic.gov.in/view-pdf/1001/ENG/Notifications" },
    { title: "An invented clarification", date: "2026-07-25", link: "https://taxinformation.cbic.gov.in/view-pdf/1002/ENG/Circulars" },
  ]);
  expect(() => cbicUpdates('{"status":500}')).toThrow("Page changed");
});
