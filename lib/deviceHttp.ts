// Rescate de un HTTP que Node no acepta.
//
// Verificado 2026-10-12 en los faciales WS545CW_FP3FC5_BSCS_V2.0.33: cuando un
// comando falla el equipo contesta
//
//     POST // HTTP/1.0
//     Content-Length: -1
//     request_code:send_cmd_result
//     cmd_return_code:Error
//     ...
//     blk_len: -1
//
// sin cuerpo. El parser HTTP de Node lo rechaza ("Invalid character in
// Content-Length") ANTES de llegar a la app: el error se perdía y la operación
// quedaba "sin respuesta" hasta vencer.
//
// El tráfico normal no se toca (sigue por el servidor http de siempre). Solo
// en `clientError`, si lo rechazado es un pedido con Content-Length negativo,
// se corrige a 0 y se reenvía a este mismo servidor por loopback; la respuesta
// vuelve tal cual al equipo.
import http from "http";
import type { Server } from "http";
import type { Duplex } from "stream";

/** Content-Length negativo → 0, solo dentro del bloque de headers. Si no hay nada que cambiar devuelve el mismo buffer. */
export function patchNegativeContentLength(head: Buffer): Buffer {
  const end = head.indexOf("\r\n\r\n");
  const headerEnd = end === -1 ? head.length : end;
  const text = head.subarray(0, headerEnd).toString("latin1");
  const fixed = text.replace(/^(content-length)[ \t]*:[ \t]*-\d+[ \t]*$/gim, "$1: 0");
  if (fixed === text) return head;
  return Buffer.concat([Buffer.from(fixed, "latin1"), head.subarray(headerEnd)]);
}

/** Request line + headers de un pedido crudo (sin cuerpo). null si no se puede leer. */
function parseHead(raw: Buffer): { method: string; path: string; headers: Record<string, string> } | null {
  const end = raw.indexOf("\r\n\r\n");
  if (end === -1) return null;
  const [requestLine, ...lines] = raw.subarray(0, end).toString("latin1").split("\r\n");
  const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(requestLine);
  if (!m) return null;
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { method: m[1], path: m[2].replace(/\/{2,}/g, "/"), headers };
}

/**
 * Engancha el rescate al servidor. `port` es donde escucha (para el reenvío
 * por loopback). Lo demás que rechace el parser recibe el 400 de siempre.
 */
export function rescueNegativeContentLength(server: Server, port: number): void {
  server.on("clientError", (err: Error & { rawPacket?: Buffer }, socket: Duplex) => {
    const raw = err.rawPacket;
    const patched = raw ? patchNegativeContentLength(raw) : null;
    const head = raw && patched !== raw ? parseHead(patched!) : null;
    // Solo pedidos sin cuerpo: con Content-Length negativo el equipo no manda nada después.
    if (!head || !socket.writable) {
      if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      else socket.destroy();
      return;
    }
    const headers = { ...head.headers, "content-length": "0" };
    const req = http.request({ host: "127.0.0.1", port, method: head.method, path: head.path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const lines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage ?? ""}`];
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined || k === "transfer-encoding" || k === "connection" || k === "content-length") continue;
          for (const one of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${one}`);
        }
        lines.push(`Content-Length: ${body.length}`, "Connection: close", "", "");
        socket.end(Buffer.concat([Buffer.from(lines.join("\r\n"), "latin1"), body]));
      });
    });
    req.on("error", () => socket.destroy());
    req.end();
  });
}
