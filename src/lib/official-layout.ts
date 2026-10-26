import { readSheet, unescape, xlsxEntries } from "./sheet";

// The shape of an official file InboxCA fills, to tell whether a new release changes it: a
// workbook's sheet names with the headings in its first rows, or a JSON schema's field paths.
export type Layout = Record<string, string[]>;

export function workbookLayout(data: Buffer, rows = 6): Layout {
  const files = xlsxEntries(data);
  const book = files.get("xl/workbook.xml")?.().toString() ?? "";
  const rels = [...(files.get("xl/_rels/workbook.xml.rels")?.().toString() ?? "").matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => tag);
  const layout: Layout = {};
  for (const [tag] of book.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(/\bname="([^"]*)"/.exec(tag)?.[1] ?? "");
    const id = /\br:id="([^"]*)"/.exec(tag)?.[1];
    const sheet = Number(/worksheets\/sheet(\d+)\.xml"/.exec(rels.find((rel) => rel.includes(`Id="${id}"`)) ?? "")?.[1]);
    if (!name || !sheet) continue;
    const cells = readSheet(data, "official.xlsx", { rows, columns: 200, sheet }).flat();
    layout[name] = [...new Set(cells.map((cell) => cell.replace(/\s+/g, " ").trim()).filter((cell) => /[A-Za-z]/.test(cell)))];
  }
  if (!Object.keys(layout).length) throw new Error("No sheets in the file");
  return layout;
}

type Node = { $ref?: string; allOf?: Node[]; properties?: Record<string, Node>; items?: Node };
export function schemaLayout(schema: unknown): Layout {
  const resolve = (node: Node, depth = 0): Node => {
    if (node.$ref) {
      let found: unknown = schema;
      if (!node.$ref.startsWith("#/") || depth > 20) throw new Error("Unknown reference in the schema");
      for (const key of node.$ref.slice(2).split("/")) found = (found as Record<string, unknown> | undefined)?.[key.replaceAll("~1", "/").replaceAll("~0", "~")];
      if (!found) throw new Error("Unknown reference in the schema");
      return resolve(found as Node, depth + 1);
    }
    // The parts of an allOf together, their fields too.
    if (!node.allOf) return node;
    const parts = [...node.allOf.map((part) => resolve(part, depth + 1)), { ...node, allOf: undefined }];
    const fields = parts.filter((part) => part.properties).map((part) => part.properties);
    return Object.assign({}, ...parts, fields.length ? { properties: Object.assign({}, ...fields) } : {});
  };
  const paths: string[] = [];
  const walk = (node: Node, path: string[]) => {
    if (path.length > 30 || paths.length > 20_000) throw new Error("The schema is too large");
    node = resolve(node);
    if (node.properties) for (const [key, value] of Object.entries(node.properties)) walk(value, [...path, key]);
    else if (node.items) walk(node.items, [...path, "[]"]);
    else paths.push(path.join("."));
  };
  walk(schema as Node, []);
  return { "": paths };
}

// The differences in plain lines, sheets first: an empty list means the same layout.
export function layoutDifferences(before: Layout, after: Layout) {
  const lines: string[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
    if (!before[key]) lines.push(`Sheet added: ${key}`);
    else if (!after[key]) lines.push(`Sheet removed: ${key}`);
    else {
      const where = key ? `In ${key}, heading` : "Field";
      lines.push(...after[key].filter((item) => !before[key].includes(item)).map((item) => `${where} added: ${item}`));
      lines.push(...before[key].filter((item) => !after[key].includes(item)).map((item) => `${where} removed: ${item}`));
    }
  }
  return lines;
}
