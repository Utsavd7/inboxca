import { localDrive } from "../src/lib/drive.ts";
import { frameSize, verifyView, viewLimits, type ViewRequest } from "../src/lib/file-worker.ts";
import { openView } from "./render.ts";
import { readSheet } from "../src/lib/sheet.ts";
import { exactMapping } from "../src/lib/sales-register.ts";
import { createHash } from "node:crypto";
import { gstr2bBills, readPortal, readTaxPdf, readTaxText } from "./portal.ts";
import {verifyForm} from "../src/lib/form-worker.ts";
import {editedForm} from "./edited-form.ts";
import {templateSchema} from "../src/lib/templates.ts";
import {z} from "zod";
import {prepare} from "./prepare.ts";
import {stampedPdf} from "./download.ts";
import {listMail, readThread} from "../src/lib/mailbox.ts";
import * as mailApi from "../src/lib/mail-api.ts";
import {verifyMail} from "../src/lib/mail-view.ts";
import {editedItr} from "./itr.ts";
import {intake} from "./intake.ts";

// Only test runs keep read counts, never file contents or credentials.
const reads = new Map<string, number>();
async function original(view: ViewRequest, signal: AbortSignal) {
  if (view.provider === "local") {
    if (!process.env.DRIVE_LOCAL_DIR) throw new Error("No local drive");
    return localDrive(process.env.DRIVE_LOCAL_DIR, (id) => { if (process.env.FILE_WORKER_TEST === "1") reads.set(id, (reads.get(id) ?? 0) + 1); }, viewLimits.bytes).read(view.file);
  }
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST", signal, headers: { Authorization: `Bearer ${view.token}`, "Dropbox-API-Arg": JSON.stringify({ path: view.file }).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) },
  });
  if (!response.ok || Number(response.headers.get("Content-Length")) > viewLimits.bytes || !response.body) throw new Error("Cannot read file");
  // A fixed bounded buffer avoids joining a second original copy or trusting a size header.
  const length = Number(response.headers.get("Content-Length"));
  const bytes = new Uint8Array(Number.isSafeInteger(length) && length > 0 ? length : viewLimits.bytes);
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return bytes.subarray(0, size);
      if (size + value.length > bytes.length) throw new Error("File too large");
      bytes.set(value, size);
      size += value.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
}

// The same Request/Response handler can be wrapped by Lambda's response streaming adapter.
export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return new Response("Ready");
  const secret = process.env.FILE_WORKER_SECRET ?? "";
  if (request.method === "POST" && url.pathname === "/intake") return intake(request, secret);
  if(request.method==="POST" && url.pathname.startsWith("/prepare/")) {
    let input;
    try {input=await verifyForm(await request.text(),request.headers.get("authorization") ?? "",secret,url.pathname.slice(9));}
    catch {return new Response("Not allowed",{status:403});}
    try {
      request.signal.throwIfAborted();const output=prepare(input);
      return new Response(new Uint8Array(output.bytes),{headers:{"Content-Type":output.type,"Cache-Control":"private, no-store"}});
    } catch {return new Response("The figures do not pass the official form's checks.",{status:422});}
  }
  // The Inbox's live mail reads: the answer goes back to the app and nothing is kept.
  if(request.method==="POST" && url.pathname.startsWith("/mail/")) {
    let mail;
    try {mail=await verifyMail(await request.text(),request.headers.get("authorization") ?? "",secret,url.pathname.slice(6));}
    catch {return new Response("Not allowed",{status:403});}
    // A mailbox connected with sign in is read over its provider's API with the access token.
    const read=mail.provider
      ? (mail.op==="list" ? await mailApi.listMail({provider:mail.provider,token:mail.token,settings:mail.api},mail.ask) : await mailApi.readThread({provider:mail.provider,token:mail.token,settings:mail.api},mail.ask))
      : mail.op==="list" ? await listMail(mail.address,mail.password,mail.server,mail.ask) : await readThread(mail.address,mail.password,mail.server,mail.ask);
    return Response.json(read,{headers:{"Cache-Control":"private, no-store"}});
  }
  if (process.env.FILE_WORKER_TEST === "1" && request.method === "GET" && url.pathname === "/_reads" && secret && request.headers.get("authorization") === `Bearer ${secret}`)
    return Response.json({ reads: reads.get(url.searchParams.get("file") ?? "") ?? 0, peakRssKiB: process.resourceUsage().maxRSS });
  const sheet=url.pathname.startsWith("/sheet/");
  const copy=url.pathname.startsWith("/copy/");
  const edited=url.pathname.startsWith("/edited/");
  const portal=url.pathname.startsWith("/portal/");
  if (request.method !== "POST" || !sheet && !portal && !edited && !copy && !url.pathname.startsWith("/view/")) return new Response("Not found", { status: 404 });
  let view: ViewRequest;
  try { view = await verifyView(await request.text(), request.headers.get("authorization") ?? "", secret, decodeURIComponent(url.pathname.slice(portal || edited ? 8 : sheet ? 7 : 6)), undefined, portal ? "portal" : sheet ? "sheet" : edited ? "edited" : copy ? "copy" : undefined); }
  catch { return new Response("Not allowed", { status: 403 }); }
  try {
    request.signal.throwIfAborted();
    const data = await original(view, request.signal);
    if(edited) {
      if(view.form?.template.form_code.startsWith("ITR")) {
        if(!/\.json$/i.test(view.name)) throw new Error("Choose the official return file");
        const context=z.object({template:templateSchema,period:z.string().regex(/^20\d{2}$/),pan:z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/)}).parse(view.form);
        return Response.json({...editedItr(data,context),sha256:createHash("sha256").update(data).digest("hex")},{headers:{"Cache-Control":"private, no-store"}});
      }
      if(!/\.xlsx$/i.test(view.name)) throw new Error("Choose the official workbook");
      const context=z.object({template:templateSchema,period:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),gstin:z.string().length(15)}).parse(view.form);
      return Response.json({...editedForm(Buffer.from(data.buffer,data.byteOffset,data.byteLength),context),sha256:createHash("sha256").update(data).digest("hex")},{headers:{"Cache-Control":"private, no-store"}});
    }
    if(portal) {
      // A locked PDF opens only with the password a person typed for it.
      const read=/\.json$/i.test(view.name) ? readPortal(data) : /\.txt$/i.test(view.name) ? readTaxText(data) : /\.pdf$/i.test(view.name) ? await readTaxPdf(data,view.password) : null;
      // A GSTR-2B's bills go back too, for the match with the purchase register.
      return Response.json({read,...(/\.json$/i.test(view.name) && {bills:gstr2bBills(data)}),sha256:createHash("sha256").update(data).digest("hex")},{headers:{"Cache-Control":"private, no-store"}});
    }
    if(sheet) {
      if(!/\.(xlsx?|csv)$/i.test(view.name)) throw new Error("Not a sheet");
      // The official GSTR-1 workbook opens with its help sheet: read the first sheet whose
      // headings are a register's and that has rows under them, else the first sheet.
      const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength),read=(sheet?:number)=>readSheet(bytes,view.name,{rows:viewLimits.rows+1,columns:viewLimits.columns,keepEmpty:true,sheet});
      let rows=read();
      if(/\.xlsx$/i.test(view.name)) for(let sheet=1;sheet<=40;sheet++) {
        let candidate:string[][];
        try {candidate=read(sheet);} catch {break;}
        const mapping=exactMapping(candidate);
        if(mapping && candidate.slice(mapping.header+1).some((row)=>row.some((cell)=>cell.trim()))) {rows=candidate;break;}
      }
      if(rows.length>viewLimits.rows || rows.some((row)=>row.length>viewLimits.columns || row.some((cell)=>cell.length>2000)) || JSON.stringify(rows).length>3_000_000) throw new Error("Split this register into smaller files");
      return Response.json({rows,sha256:createHash("sha256").update(data).digest("hex")},{headers:{"Cache-Control":"private, no-store"}});
    }
    const opened = await openView(Buffer.from(data.buffer, data.byteOffset, data.byteLength), view.name, view.label, view.limit, request.signal, view.sheet, view.password);
    let disposed = false;
    const dispose = async () => { if (!disposed) { disposed = true; await opened.dispose(); } };
    async function* frames() {
      try {
        if(copy) {yield* stampedPdf(opened);return;}
        const header = new TextEncoder().encode(JSON.stringify(opened.header));
        yield frameSize(header); yield header;
        for (let number = 1; number <= opened.header.pages.length; number++) {
          request.signal.throwIfAborted();
          const image = await opened.render(number);
          yield frameSize(image); yield image;
        }
      } finally { await dispose(); }
    }
    const iterator = frames();
    return new Response(new ReadableStream({
      async pull(controller) {
        try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
        catch (error) { controller.error(error); await iterator.return(undefined); }
      },
      async cancel() { await iterator.return(undefined); await dispose(); },
    }, { highWaterMark: 0 }), { headers: { "Content-Type": copy ? "application/pdf" : "application/x-inboxca-pages", "Cache-Control": "private, no-store" } });
  } catch (error) {
    // A PDF with a password says whether one is needed or the one saved did not open it.
    if ((error as Error)?.name === "PasswordException") return new Response(view.password ? "wrong" : "password", { status: 423, headers: { "Cache-Control": "private, no-store" } });
    return new Response("This file could not be opened.", { status: 422 });
  }
}
