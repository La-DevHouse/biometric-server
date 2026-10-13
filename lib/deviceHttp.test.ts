import { test } from "node:test";
import { strict as assert } from "node:assert";
import http from "http";
import net from "net";
import { patchNegativeContentLength, rescueNegativeContentLength } from "./deviceHttp";

// Lo que mandó el facial 2401058627 al fallar un GET_USER_INFO (2026-10-12).
const FACIAL_ERROR =
  "POST // HTTP/1.0\r\nContent-Type: application/octet-stream\r\nContent-Length: -1\r\nConnection: close\r\n" +
  "request_code:send_cmd_result\r\ncmd_return_code:Error\r\ndev_id: 000000000001\r\ntrans_id: 137\r\n" +
  "blk_no: 0\r\nblk_len: -1\r\nHOST: 192.168.9.110\r\n\r\n";

test("patchNegativeContentLength: -1 → 0, el resto intacto", () => {
  const out = patchNegativeContentLength(Buffer.from(FACIAL_ERROR, "latin1")).toString("latin1");
  assert.match(out, /\r\nContent-Length: 0\r\n/);
  assert.match(out, /\r\nblk_len: -1\r\n/); // no es un header que Node valide
  assert.equal(out.replace("Content-Length: 0", "Content-Length: -1"), FACIAL_ERROR);
  const ok = Buffer.from("POST / HTTP/1.0\r\nContent-Length: 12\r\n\r\nhello", "latin1");
  assert.equal(patchNegativeContentLength(ok), ok);
  // Un "Content-Length: -1" dentro del cuerpo no se toca.
  const inBody = Buffer.from("POST / HTTP/1.0\r\nContent-Length: 20\r\n\r\nContent-Length: -1\r\n", "latin1");
  assert.equal(patchNegativeContentLength(inBody), inBody);
});

function rawRequest(port: number, chunks: Buffer[], gapMs = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1", async () => {
      for (const c of chunks) {
        s.write(c);
        await new Promise((r) => setTimeout(r, gapMs));
      }
    });
    let out = "";
    s.on("data", (d) => (out += d.toString("latin1")));
    s.on("end", () => resolve(out));
    s.on("error", reject);
  });
}

test("el pedido con Content-Length: -1 del facial llega a la app; el resto sigue igual", async () => {
  const seen: { code: string | undefined; rc: string | undefined; bytes: number }[] = [];
  const server = http.createServer((req, res) => {
    let n = 0;
    req.on("data", (c) => (n += c.length));
    req.on("end", () => {
      seen.push({ code: req.headers["request_code"] as string, rc: req.headers["cmd_return_code"] as string, bytes: n });
      res.writeHead(200, { "Content-Length": "2", Connection: "close" });
      res.end("OK");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  rescueNegativeContentLength(server, port);
  try {
    const r1 = await rawRequest(port, [Buffer.from(FACIAL_ERROR, "latin1")]);
    assert.match(r1, /^HTTP\/1\.1 200/);

    // Headers partidos en dos lecturas y un cuerpo de 200 KB en varios trozos.
    const body = Buffer.alloc(200 * 1024, 0xab);
    const head = Buffer.from(`POST // HTTP/1.0\r\nContent-Length: ${body.length}\r\nrequest_code:send_cmd_result\r\n\r\n`, "latin1");
    const r2 = await rawRequest(port, [
      head.subarray(0, 20),
      head.subarray(20),
      body.subarray(0, 70000),
      body.subarray(70000, 150000),
      body.subarray(150000),
    ]);
    assert.match(r2, /^HTTP\/1\.1 200/);

    assert.deepEqual(seen, [
      { code: "send_cmd_result", rc: "Error", bytes: 0 },
      { code: "send_cmd_result", rc: undefined, bytes: body.length },
    ]);
  } finally {
    server.close();
  }
});
