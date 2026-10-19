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
