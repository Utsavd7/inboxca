import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readCsv, readSheet } from "@/src/lib/sheet";

it("reads an Excel sheet's shared, inline and number cells in their columns", () => {
  expect(readSheet(readFileSync("tests/fixtures/clients.xlsx"), "clients.xlsx")).toEqual([
    ["Client name", "Type", "PAN", "GSTIN"],
    ["Shah & Sons", "Partnership firm", "", "27AAPFU0939F1ZV"],
    ["Meena Iyer", "", "ABCPI1234K", "", "42"],
  ]);
});

it("reads CSV with quotes, commas and line breaks inside cells, and skips blank lines", () => {
  expect(readCsv('Name,PAN\r\n"Shah, Sons","said ""hi"""\n"two\nlines",x')).toEqual([
    ["Name", "PAN"],
    ["Shah, Sons", 'said "hi"'],
    ["two\nlines", "x"],
  ]);
  expect(readSheet(Buffer.from("﻿Name\n\n,\nA\n"), "list.csv")).toEqual([["Name"], ["A"]]);
});

it("reads cached text and numbers from an Excel 97 sheet and refuses broken files", () => {
  expect(readSheet(readFileSync("tests/fixtures/statement.xls"), "statement.xls")).toEqual([["Name"], ["Invented Client", "1200"]]);
  expect(() => readSheet(Buffer.from("not a workbook"), "statement.xls")).toThrow();
});

// Add a highly compressed entry to an otherwise ordinary workbook.
function extraEntry(name: string) {
  const data = readFileSync("tests/fixtures/clients.xlsx");
  const end = data.length - 22, directory = data.readUInt32LE(end + 16);
  const text = Buffer.alloc(20_000_001, 120), body = deflateRawSync(text), fileName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(text.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(text.length, 24);
  entry.writeUInt16LE(fileName.length, 28);
  entry.writeUInt32LE(directory, 42);
  const tail = Buffer.from(data.subarray(end));
  tail.writeUInt16LE(data.readUInt16LE(end + 8) + 1, 8);
  tail.writeUInt16LE(data.readUInt16LE(end + 10) + 1, 10);
  tail.writeUInt32LE(data.readUInt32LE(end + 12) + entry.length + fileName.length, 12);
  tail.writeUInt32LE(directory + local.length + fileName.length + body.length, 16);
  return Buffer.concat([data.subarray(0, directory), local, fileName, body, data.subarray(directory, end), entry, fileName, tail]);
}

it("never inflates unused workbook entries, and caps the entries it needs", () => {
  expect(readSheet(extraEntry("xl/unused.xml"), "test.xlsx")).toEqual(readSheet(readFileSync("tests/fixtures/clients.xlsx"), "test.xlsx"));
  expect(() => readSheet(extraEntry("xl/sharedStrings.xml"), "test.xlsx")).toThrow();
  expect(readSheet(readFileSync("tests/fixtures/clients.xlsx"), "test.xlsx", { rows: 1, columns: 2 })).toHaveLength(1);
});
