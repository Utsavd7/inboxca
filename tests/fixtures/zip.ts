import { crc32, deflateRawSync } from "node:zlib";

// A ZIP built by hand, so each test can lie about one thing: a name, a flag, a size or a checksum.
export type Entry = { name: string; bytes?: Uint8Array; stored?: boolean; flags?: number; mode?: number; size?: number; crc?: number; at?: number };
export function craft(entries: Entry[]) {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes ?? new Uint8Array()), data = entry.stored ? bytes : deflateRawSync(bytes), name = Buffer.from(entry.name);
    const local = Buffer.alloc(30), record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(entry.flags ?? 0, 6); local.writeUInt16LE(entry.stored ? 0 : 8, 8);
    local.writeUInt32LE(entry.crc ?? crc32(bytes), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(entry.size ?? bytes.length, 22); local.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(entry.mode === undefined ? 20 : 0x0314, 4); local.copy(record, 6, 4, 30);
    record.writeUInt32LE((entry.mode ?? 0) * 0x10000, 38); record.writeUInt32LE(entry.at ?? offset, 42);
    parts.push(local, name, data); central.push(record, name); offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
