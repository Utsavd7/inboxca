import { readXls } from "./xls.ts";
import { inflateRawSync } from "node:zlib";

// The rows of a CSV file, or of an Excel file's first sheet, as text, for imports. Excel
// files are zip files of XML, so Node's own zlib reads them; no spreadsheet package.
export function readSheet(data: Buffer, fileName: string, limit?: { rows: number; columns: number; keepEmpty?:boolean; sheet?:number }): string[][] {
  const rows = /\.xlsx$/i.test(fileName) ? readXlsx(data, limit) : /\.xls$/i.test(fileName) ? readXls(data) : readCsv(data.toString("utf8").replace(/^﻿/, ""));
  return limit?.keepEmpty ? rows : rows.filter((row) => row.some((cell) => cell.trim()));
}

export function readCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quoted && char === '"' && text[at + 1] === '"') {
      cell += '"';
      at++;
    } else if (char === '"') quoted = !quoted;
    else if (quoted || (char !== "," && char !== "\n" && char !== "\r")) cell += char;
    else if (char === ",") endCell();
    else {
      if (char === "\r" && text[at + 1] === "\n") at++;
      endCell();
      rows.push(row);
      row = [];
    }
  }
  if (cell || row.length) {
    endCell();
    rows.push(row);
  }
  return rows;
}

// Index the zip; inflate only the two XML files we read, at most 20 MB each.
export function xlsxEntries(data: Buffer) {
  const files = new Map<string, () => Buffer>();
  let end = data.length - 22;
  while (end >= 0 && data.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not an Excel file");
  let at = data.readUInt32LE(end + 16);
  for (let count = data.readUInt16LE(end + 10); count > 0; count--) {
    const nameLength = data.readUInt16LE(at + 28);
    const name = data.toString("utf8", at + 46, at + 46 + nameLength);
    const local = data.readUInt32LE(at + 42);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const body = data.subarray(start, start + data.readUInt32LE(at + 20));
    const method = data.readUInt16LE(at + 10);
    files.set(name, () => {
      if (method !== 0 && method !== 8 || method === 0 && body.length > 20e6) throw new Error("Excel entry too large or unsupported");
      return method === 8 ? inflateRawSync(body, { maxOutputLength: 20e6 }) : body;
    });
    at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
  }
  return files;
}

const unescape = (text: string) =>
  text.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-f]+);/gi, (_, code: string) =>
    code[0] === "#"
      ? String.fromCodePoint(parseInt(code.slice(code[1] === "x" ? 2 : 1), code[1] === "x" ? 16 : 10))
      : ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[code],
  );
const texts = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => unescape(text)).join("");

function readXlsx(data: Buffer, limit?: { rows: number; columns: number; keepEmpty?:boolean; sheet?:number }) {
  const files = xlsxEntries(data);
  const shared = [...(files.get("xl/sharedStrings.xml")?.().toString() ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item]) => texts(item));
  const number=limit?.sheet ?? 1;
  if(!Number.isInteger(number) || number<1 || number>100) throw new Error("No sheet in the file");
  const sheet = files.get(`xl/worksheets/sheet${number}.xml`) ?? (!limit?.sheet ? [...files].find(([path])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(path))?.[1] : undefined);
  if (!sheet) throw new Error("No sheet in the file");
  const result:string[][]=[];
  for(const [,attributes,cells] of sheet().toString().matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
    const at=limit?.keepEmpty ? Number(/r="(\d+)"/.exec(attributes)?.[1] ?? result.length+1)-1 : result.length;
    if(!Number.isSafeInteger(at) || at<0) throw new Error("Invalid Excel row");
    if(limit && at>=limit.rows) break;
    const row: string[] = [];
    for (const [, attributes, body = ""] of cells.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = [.../r="([A-Z]+)/.exec(attributes)?.[1] ?? ""].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const type = /t="(\w+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      const at = Math.max(column, row.length);
      if (!Number.isSafeInteger(at) || at >= 16384) throw new Error("Invalid Excel column");
      row[Math.min(at, limit ? limit.columns : at)] = type === "s" ? shared[Number(value)] : type === "inlineStr" ? texts(body) : unescape(value);
    }
    while(result.length<at) result.push([]);
    result[at]=Array.from(row, (cell) => cell ?? "");
  }
  return result;
}
