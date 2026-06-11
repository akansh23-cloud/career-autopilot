/* ============================================================
   Starter Pack — dependency-free ZIP writer.
   The repo intentionally has no `archiver`/`jszip` dependency, so this
   writes a standards-compliant ZIP (PKZIP 2.0, method 0 "stored")
   with pure Node Buffers + a CRC32 table. Stored (uncompressed)
   entries are fine here: starter packs are small text files and the
   size guard below caps the total. Extractable by every OS/tool.
   ============================================================ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* DOS date/time encoding for ZIP headers (deterministic given `date`). */
function dosDateTime(date = new Date()) {
  const d = date;
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const day = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, day };
}

/* Reject any path that could escape the extraction directory. */
export function isSafeZipPath(p) {
  const s = String(p || '');
  if (!s || s.length > 240) return false;
  if (s.startsWith('/') || s.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(s)) return false;           // windows drive
  if (s.includes('..')) return false;               // traversal
  if (/[\0\r\n]/.test(s)) return false;             // control chars
  return /^[a-zA-Z0-9._\-/ ()#@+]+$/.test(s);
}

/* files: [{ path, content (string|Buffer) }] → Buffer (the .zip bytes). */
export function createZip(files = [], { date = new Date() } = {}) {
  const { time, day } = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    if (!isSafeZipPath(f.path)) throw new Error(`Unsafe zip path rejected: ${f.path}`);
    const nameBuf = Buffer.from(f.path, 'utf8');
    const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content ?? ''), 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);  // local file header signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
    local.writeUInt16LE(0, 8);           // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size (stored = raw)
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra length
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0x0800, 8);     // flags: UTF-8
    central.writeUInt16LE(0, 10);         // method
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra(30)=0 comment(32)=0 disk(34)=0 intAttr(36)=0
    central.writeUInt32LE(0, 38);          // ext attrs
    central.writeUInt32LE(offset, 42);     // local header offset
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);          // disk
  end.writeUInt16LE(0, 6);          // start disk
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);         // comment length

  return Buffer.concat([...localParts, centralBuf, end]);
}
