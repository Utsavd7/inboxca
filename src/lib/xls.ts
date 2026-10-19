// Read cached cells from the first Excel 97 sheet. Never run formulas or macros.
export function readXls(file: Buffer): string[][] {
  if (file.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1") throw new Error("Not an Excel 97 file");
  const sectorSize = 2 ** file.readUInt16LE(30);
  if (![512, 4096].includes(sectorSize) || file.readUInt16LE(32) !== 6) throw new Error("Invalid Excel sectors");
  const sector = (id: number) => {
    const start = (id + 1) * sectorSize;
    if (id >= 0xfffffffa || start + sectorSize > file.length) throw new Error("Invalid Excel sector");
    return file.subarray(start, start + sectorSize);
  };
  const integers = (data: Buffer) => Array.from({ length: data.length / 4 }, (_, i) => data.readUInt32LE(i * 4));
  const fatIds = integers(file.subarray(76, 512)).filter((id) => id < 0xfffffffa);
  let next = file.readUInt32LE(68);
  const visited = new Set<number>();
  while (next < 0xfffffffa) {
    if (visited.has(next)) throw new Error("Excel sector loop");
    visited.add(next);
    const ids = integers(sector(next));
    next = ids.pop()!;
    fatIds.push(...ids.filter((id) => id < 0xfffffffa));
  }
  const fat = fatIds.flatMap((id) => integers(sector(id)));
  const chain = (start: number, table = fat, source = sector) => {
    const chunks: Buffer[] = [], seen = new Set<number>();
    let size = 0;
    for (let id = start; id < 0xfffffffa; id = table[id]) {
      if (seen.has(id) || table[id] === undefined) throw new Error("Invalid Excel chain");
      seen.add(id);
      const chunk = source(id);
      size += chunk.length;
      if (size > 25_000_000) throw new Error("Excel stream too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const directory = chain(file.readUInt32LE(48));
  const entries = Array.from({ length: directory.length / 128 }, (_, i) => directory.subarray(i * 128, (i + 1) * 128));
  const root = entries.find((entry) => entry[66] === 5);
  const book = entries.find((entry) => entry[66] === 2 && /^(Workbook|Book)$/.test(entry.toString("utf16le", 0, Math.max(0, entry.readUInt16LE(64) - 2))));
  if (!root || !book) throw new Error("No workbook");
  const length = Number(book.readBigUInt64LE(120));
  if (length > 25_000_000) throw new Error("Excel stream too large");
  const mini = length < file.readUInt32LE(56);
  const miniStream = mini ? chain(root.readUInt32LE(116)) : Buffer.alloc(0);
  const data = (mini ? chain(book.readUInt32LE(116), integers(chain(file.readUInt32LE(60))), (id) => {
    if ((id + 1) * 64 > miniStream.length) throw new Error("Invalid Excel small sector");
    return miniStream.subarray(id * 64, (id + 1) * 64);
  }) : chain(book.readUInt32LE(116))).subarray(0, length);
  const records: { type: number; body: Buffer }[] = [];
  for (let at = 0; at + 4 <= data.length;) {
    const type = data.readUInt16LE(at), size = data.readUInt16LE(at + 2);
    if (at + 4 + size > data.length) throw new Error("Truncated Excel record");
    if (type === 0x2f) throw new Error("Password protected Excel file");
    records.push({ type, body: data.subarray(at + 4, at + 4 + size) });
    at += 4 + size;
  }
  const shared: string[] = [];
  const sst = records.findIndex((record) => record.type === 0xfc);
  if (sst >= 0) {
    const segments = [records[sst].body];
    for (let i = sst + 1; records[i]?.type === 0x3c; i++) segments.push(records[i].body);
    let segment = 0, at = 8;
    const byte = () => {
      while (at >= segments[segment]?.length) { segment++; at = 0; }
      if (!segments[segment]) throw new Error("Truncated Excel text");
      return segments[segment][at++];
    };
    const number = (size: number) => { let value = 0; for (let i = 0; i < size; i++) value += byte() * 2 ** (i * 8); return value; };
    const count = Math.min(100_000, segments[0].readUInt32LE(4));
    for (let i = 0; i < count; i++) {
      const size = number(2), flags = byte(), runs = flags & 8 ? number(2) : 0, extra = flags & 4 ? number(4) : 0;
      let wide = flags & 1, text = "";
      for (let c = 0; c < size; c++) {
        if (at === segments[segment].length) { segment++; at = 0; wide = byte() & 1; }
        text += String.fromCharCode(number(wide ? 2 : 1));
      }
      for (let n = 0; n < runs * 4 + extra; n++) byte();
      shared.push(text);
    }
  }
  const rows: string[][] = [];
  const put = (row: number, column: number, text: string) => {
    if (row < 65536 && column < 256) (rows[row] ??= [])[column] = text;
  };
  const rk = (raw: number) => {
    const value = Buffer.alloc(8);
    value.writeUInt32LE((raw & ~3) >>> 0, 4);
    return String((raw & 2 ? raw >> 2 : value.readDoubleLE()) / (raw & 1 ? 100 : 1));
  };
  let inSheet = false;
  for (const { type, body } of records) {
    if (type === 0x809 && body.readUInt16LE(2) === 0x10) inSheet = true;
    if (!inSheet) continue;
    if (type === 0xa) break;
    if ([0xfd, 0x203, 0x27e, 0xbd, 0x205, 0x6, 0x204].includes(type)) {
      const row = body.readUInt16LE(), column = body.readUInt16LE(2);
      if (type === 0xfd) put(row, column, shared[body.readUInt32LE(6)] ?? "");
      if (type === 0x203 || type === 0x6 && body.readUInt16LE(12) !== 0xffff) put(row, column, String(body.readDoubleLE(6)));
      if (type === 0x27e) put(row, column, rk(body.readUInt32LE(6)));
      if (type === 0xbd) for (let at = 4, col = column; at < body.length - 2; at += 6, col++) put(row, col, rk(body.readUInt32LE(at + 2)));
      if (type === 0x205 && !body[7]) put(row, column, body[6] ? "TRUE" : "FALSE");
      if (type === 0x204) put(row, column, body.toString(body[8] & 1 ? "utf16le" : "latin1", 9, 9 + body.readUInt16LE(6) * (body[8] & 1 ? 2 : 1)));
    }
  }
  return Array.from(rows, (row) => Array.from(row ?? [], (cell) => cell ?? ""));
}
