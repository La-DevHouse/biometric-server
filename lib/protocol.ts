// Protocol parser for biometric device HTTP push communication
// Devices use custom HTTP headers for protocol fields, with optional binary data after JSON body

export interface ParsedBody {
  json: Record<string, any> | null;
  binaries: Buffer[];
}

/**
 * Parse request body into JSON and binary parts.
 * Device protocol: JSON payload followed by optional binary data concatenated.
 * Respects string boundaries and escape sequences when locating JSON end.
 *
 * AMBIGUO: When multiple binary blocks are referenced (BIN_1, BIN_2, etc) but not
 * delimited in the body, returns entire binary data as binaries[0]. Parsing multiple
 * distinct binaries requires explicit size hints in JSON or known command structure.
 */
export function parseBody(buf: Buffer): ParsedBody {
  if (buf.length === 0) {
    return { json: null, binaries: [] };
  }

  // Block-prefixed framing is tried first, unconditionally. It used to be
  // gated behind `buf[0] !== 0x7b` (treating a leading `{` as proof of the
  // flat shape), but the first byte of a real length prefix is just as
  // likely to BE 0x7b — any block-0 length whose low byte is 123 (0x7b),
  // e.g. a 123-byte JSON block, produces that exact leading byte. That
  // collision silently broke a real device response (a user renamed to a
  // 5-character name landed on a 123-byte JSON block) with a false "this
  // must be the flat shape" match. readLengthPrefixedBlocks rejects
  // anything that isn't validly framed (implausible lengths, bad trailing
  // padding) long before it would ever misread genuine flat JSON — a
  // plausible small length only falls out of interpreting real JSON text as
  // a little-endian uint32 if its 4th byte happens to be 0x00, which never
  // occurs in printable JSON.
  const blocks = readLengthPrefixedBlocks(buf);
  if (blocks && blocks.length > 0) {
    try {
      const json = JSON.parse(stripTrailingNul(blocks[0]).toString("utf-8"));
      return { json, binaries: blocks.slice(1) };
    } catch {
      // Framed like blocks, but block 0 isn't JSON — fall through to flat.
    }
  }

  return parseFlatBody(buf);
}

/**
 * Real devices frame the body as a sequence of length-prefixed blocks, each
 * prefix a little-endian uint32. Block 0 is the NUL-terminated JSON; the blocks
 * after it are the `BIN_1`, `BIN_2`… the JSON refers to. Verified against
 * firmware WS535BW1_BSCS_v1.5.31:
 *
 *   41 00 00 00                                            (65)
 *   {"user_id_count":3,"one_user_id_size":8,
 *    "user_id_array":"BIN_1"} 00                            64 bytes + NUL
 *   18 00 00 00                                            (24)
 *   01 00 00 00 01 01 08 00  …                              3 users x 8 bytes
 *
 * Returns null when the framing does not hold, so callers can fall back.
 */
function readLengthPrefixedBlocks(buf: Buffer): Buffer[] | null {
  const blocks: Buffer[] = [];
  let offset = 0;

  while (offset + 4 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    offset += 4;

    if (len === 0 || offset + len > buf.length) return null;
    blocks.push(buf.subarray(offset, offset + len));
    offset += len;

    // Trailing padding after the last block is fine; anything longer than a
    // stray byte or two means we misread the framing.
    const left = buf.length - offset;
    if (left > 0 && left < 4) {
      if (!isPadding(buf.subarray(offset))) return null;
      break;
    }
  }

  return blocks.length > 0 ? blocks : null;
}

/** JSON at byte 0, optional binary appended directly after the closing brace. */
function parseFlatBody(buf: Buffer): ParsedBody {
  const jsonEnd = findJsonEnd(buf);
  if (jsonEnd === -1) {
    return { json: null, binaries: [] };
  }

  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(buf.subarray(0, jsonEnd).toString("utf-8"));
  } catch {
    return { json: null, binaries: [] };
  }

  const binaries: Buffer[] = [];
  const trailing = buf.subarray(jsonEnd);
  if (trailing.length > 0 && !isPadding(trailing)) {
    binaries.push(trailing);
  }

  return { json, binaries };
}

function stripTrailingNul(buf: Buffer): Buffer {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0x00) end--;
  return buf.subarray(0, end);
}

/**
 * Trailing NUL / CR / LF / space the firmware pads bodies with. Treating it as
 * a binary block would store a couple of junk bytes as a fingerprint or photo.
 */
function isPadding(buf: Buffer): boolean {
  for (const b of buf) {
    if (b !== 0x00 && b !== 0x0a && b !== 0x0d && b !== 0x20) return false;
  }
  return true;
}

/**
 * Find the end position of valid JSON in a buffer.
 * Handles escaped characters and strings correctly.
 * Returns the position immediately after the closing brace, or -1 if not found.
 */
function findJsonEnd(buf: Buffer): number {
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < buf.length; i++) {
    const char = String.fromCharCode(buf[i]);

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      braceDepth++;
    } else if (char === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        return i + 1;
      }
    } else if (char === "[") {
      bracketDepth++;
    } else if (char === "]") {
      bracketDepth--;
    }
  }

  return -1;
}

export interface ResponseOptions {
  responseCode: "OK" | "ERROR" | "RESET_FK";
  transId?: string | number;
  cmdCode?: string;
  bodyJson?: Record<string, any> | null;
  binary?: Buffer | null;
}

/**
 * Build HTTP response with protocol headers and body.
 * Returns headers object and concatenated body (JSON + binary).
 */
export function buildResponse(opts: ResponseOptions) {
  const headers: Record<string, string> = {
    "response_code": opts.responseCode,
    "Content-Type": "application/octet-stream",
  };

  let body = Buffer.alloc(0);

  if (opts.responseCode === "RESET_FK") {
    // Special case: RESET_FK is purely header-based
    return { headers, body };
  }

  if (opts.transId !== undefined) {
    headers["trans_id"] = String(opts.transId);
  }

  if (opts.cmdCode) {
    headers["cmd_code"] = opts.cmdCode;
  }

  // Frame the body the same way the device frames its own: a length-prefixed
  // NUL-terminated JSON block, then one length-prefixed block per binary.
  //
  // Commands that take no parameters worked with raw JSON because the firmware
  // never reads their body. SET_TIME does read it, and rejected unframed JSON
  // with cmd_return_code=Error until the framing matched.
  const blocks: Buffer[] = [];

  if (opts.bodyJson) {
    blocks.push(
      Buffer.concat([
        Buffer.from(JSON.stringify(opts.bodyJson), "utf-8"),
        Buffer.from([0x00]),
      ]),
    );
  }

  if (opts.binary && opts.binary.length > 0) {
    blocks.push(opts.binary);
  }

  if (blocks.length > 0) {
    body = Buffer.concat(blocks.map(withLengthPrefix));
  }

  // The device sends blk_no/blk_len on its own requests; mirror them back.
  headers["blk_no"] = "0";
  headers["blk_len"] = String(body.length);
  headers["Content-Length"] = String(body.length);

  return { headers, body };
}

/** Prepend a block's length as a little-endian uint32. */
function withLengthPrefix(block: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(block.length, 0);
  return Buffer.concat([prefix, block]);
}

/**
 * Decode the GET_USER_ID_LIST binary payload into actual user IDs.
 *
 * The JSON only carries `{"user_id_count":3,"one_user_id_size":8,"user_id_array":"BIN_1"}`
 * — "BIN_1" is a placeholder pointing at the binary block, not the data itself.
 * Each user occupies `one_user_id_size` bytes; the ID is the first 4 as a
 * little-endian uint32. Verified against firmware WS535BW1_BSCS_v1.5.31 by
 * cross-referencing with the numeric user_id strings ("1", "2") the same
 * device sends in realtime_glog and GET_LOG_DATA:
 *
 *   01 00 00 00 01 01 08 00   -> user 1
 *   02 00 00 00 02 01 08 00   -> user 2
 *   03 00 00 00 01 01 08 00   -> user 3
 *
 * The remaining 4 bytes per record vary in ways that don't match privilege or
 * enrollment counts from GET_DEVICE_STATUS, so their meaning is unconfirmed —
 * only the ID itself is decoded here. Returns null when the shape doesn't
 * match, so callers can fall back to the raw JSON.
 */
export function decodeUserIdList(
  json: Record<string, any> | null,
  binaries: Buffer[],
): string[] | null {
  const size = json?.one_user_id_size;
  const binary = binaries[0];

  if (typeof size !== "number" || size < 4 || !binary || binary.length === 0) {
    return null;
  }
  if (binary.length % size !== 0) {
    return null;
  }

  const userIds: string[] = [];
  for (let offset = 0; offset < binary.length; offset += size) {
    userIds.push(String(binary.readUInt32LE(offset)));
  }
  return userIds;
}

export interface DecodedLogEntry {
  user_id: string;
  verify_mode: string;
  io_mode: number;
  io_time: string;
}

/**
 * Decode the GET_LOG_DATA binary payload into attendance records.
 *
 * Same placeholder pattern as GET_USER_ID_LIST — `log_array: "BIN_1"` points at
 * the attached binary, `one_log_size` gives the per-record stride. Each record
 * is 12 bytes:
 *
 *   bytes 0-3   user_id, uint32 LE (same encoding as GET_USER_ID_LIST)
 *   byte  4     reserved (always 1 in every capture so far)
 *   byte  5     io_mode
 *   byte  6     verify_mode
 *   byte  7     seconds (0-59, raw byte)
 *   bytes 8-11  date+time, uint32 LE bitfield (year/month/day/hour/minute):
 *                 bits 0-1   reserved (always 0b01 so far)
 *                 bits 2-7   year - 1964
 *                 bits 8-11  reserved (always 0b0001 so far)
 *                 bits 12-15 month
 *                 bits 16-20 day
 *                 bits 21-25 hour (split: bits 21-23 low, bits 24-25 high)
 *                 bits 26-31 minute
 *
 * Verified byte-for-byte against 64 real records from device 2023081133 by
 * cross-referencing against the same attendance already captured via
 * realtime_glog (which reports user_id/io_time as plain JSON): all 64 decoded
 * records — user_id, io_mode, verify_mode, and full io_time down to the
 * second — matched exactly. The "reserved" bits never varied across four
 * different years (2000, 2015, 2025, 2026) in that sample, but with only one
 * device's data to check, they could still carry meaning (e.g. a value this
 * device just never happened to hit) — flagged as reserved rather than
 * assumed inert.
 *
 * Returns null when the shape doesn't match, so callers can fall back to the
 * raw JSON.
 */
export function decodeLogData(
  json: Record<string, any> | null,
  binaries: Buffer[],
): DecodedLogEntry[] | null {
  // Unlike one_user_id_size (a JSON number), the device sends one_log_size as
  // a quoted string: {"log_count":"64","one_log_size":"12",...}.
  const size = Number(json?.one_log_size);
  const binary = binaries[0];

  if (!Number.isInteger(size) || size < 12 || !binary || binary.length === 0) {
    return null;
  }
  if (binary.length % size !== 0) {
    return null;
  }

  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const logs: DecodedLogEntry[] = [];

  for (let offset = 0; offset < binary.length; offset += size) {
    const userId = binary.readUInt32LE(offset);
    const ioMode = binary[offset + 5];
    const verifyMode = binary[offset + 6];
    const seconds = binary[offset + 7];
    const packed = binary.readUInt32LE(offset + 8);

    const year = ((packed >>> 2) & 0x3f) + 1964;
    const month = (packed >>> 12) & 0x0f;
    const day = (packed >>> 16) & 0x1f;
    const hour = ((packed >>> 21) & 0x07) | (((packed >>> 24) & 0x03) << 3);
    const minute = (packed >>> 26) & 0x3f;

    logs.push({
      user_id: String(userId),
      verify_mode: String(verifyMode),
      io_mode: ioMode,
      io_time: `${year}${pad(month)}${pad(day)}${pad(hour)}${pad(minute)}${pad(seconds)}`,
    });
  }

  return logs;
}

/**
 * Resolve a "BIN_N" placeholder to the binary block it points at.
 *
 * Devices reference attached binaries this way instead of inlining them —
 * e.g. GET_USER_INFO's `{"user_photo":"BIN_1"}` or an enroll_data_array entry's
 * `{"enroll_data":"BIN_1"}`. "BIN_1" means `binaries[0]`, "BIN_2" means
 * `binaries[1]`, and so on. Returns null for anything that isn't a matching
 * reference, or when the referenced index has no binary.
 */
export function resolveBinaryRef(
  ref: unknown,
  binaries: Buffer[],
): Buffer | null {
  if (typeof ref !== "string") return null;
  const m = ref.match(/^BIN_(\d+)$/);
  if (!m) return null;
  return binaries[Number(m[1]) - 1] ?? null;
}

/**
 * Walk a result JSON and, next to every "BIN_N" reference, add `<field>_size`
 * (the resolved binary's length) and `<field>_text` when those bytes are
 * printable text.
 *
 * A fingerprint or face template is a proprietary binary blob — there's no
 * "decoded" form of it to show, unlike GET_USER_ID_LIST's numeric IDs. Size is
 * the one thing that's always true and useful. `_text` isn't a guess based on
 * `backup_number`: it's only added when the bytes actually round-trip as
 * printable UTF-8, which is the shape a stored password or ID card number
 * would take — so it surfaces real content when there is any, without
 * asserting what a field "must" be.
 *
 * Returns a new object; `json` is not mutated.
 */
export function annotateBinaryRefs(
  json: Record<string, any> | null,
  binaries: Buffer[],
): Record<string, any> | null {
  if (!json) return json;

  function annotate(value: any): any {
    if (Array.isArray(value)) return value.map(annotate);
    if (value && typeof value === "object") {
      const out: Record<string, any> = {};
      for (const [key, v] of Object.entries(value)) {
        out[key] = annotate(v);
        const buf = resolveBinaryRef(v, binaries);
        if (buf) {
          out[`${key}_size`] = buf.length;
          const text = asPrintableText(buf);
          if (text !== null) out[`${key}_text`] = text;
        }
      }
      return out;
    }
    return value;
  }

  return annotate(json);
}

/** The bytes as UTF-8 text, or null if they aren't printable text. */
function asPrintableText(buf: Buffer): string | null {
  if (buf.length === 0) return null;

  const text = buf.toString("utf-8");
  if (!Buffer.from(text, "utf-8").equals(buf)) return null;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return null;
    }
  }
  return text;
}

// El formato de hora del equipo ("YYYYMMDDhhmmss") es hora de PARED de la zona
// de la sede — no la del servidor (que corre en UTC). La conversión vive en
// lib/time.ts; acá solo se re-exporta con nombres estables.
export {
  formatDeviceTime as toDeviceTime,
  parseDeviceTime,
  DEFAULT_TZ,
} from "@/lib/time";
