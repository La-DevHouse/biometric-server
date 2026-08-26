import sqlite3 from "sqlite3";
import crypto from "crypto";
import { parseBody } from "@/lib/protocol";

const db = new sqlite3.Database(
  "c:/Users/ejhea/LaDevHouse/biometric-server/data/biometric.db",
  sqlite3.OPEN_READONLY,
);
const all = <T = any>(sql: string, params: any[] = []): Promise<T[]> =>
  new Promise((res, rej) =>
    db.all(sql, params, (e, r) => (e ? rej(e) : res((r || []) as T[]))),
  );

const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

async function main() {
for (const transId of [52, 69]) {
  const rows = await all<{ id: number; body_preview: string; body_size: number }>(
    `SELECT id, body_preview, body_size FROM raw_traffic
     WHERE direction='in' AND request_code='send_cmd_result' AND headers_json LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`%"trans_id":"${transId}"%`],
  );
  const row = rows[0];
  let raw: Buffer;
  if (row.body_preview.startsWith("hex: ")) {
    raw = Buffer.from(row.body_preview.slice(5), "hex");
  } else {
    raw = Buffer.from(row.body_preview, "utf-8");
  }
  console.log(
    `trans ${transId}: raw_traffic id=${row.id} body_size(col)=${row.body_size} bytes_reales=${raw.length}`,
  );

  const parsed = parseBody(raw);
  console.log("  json:", parsed.json);
  console.log("  binaries:", parsed.binaries.map((b) => `${b.length}B sha256=${sha256(b)}`));
}

db.close();
}

main();
