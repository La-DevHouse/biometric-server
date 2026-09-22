/** Sniff de MIME por magic bytes — usado por los blobs de imagen que se
 * guardan sin tipo (logo de empresa, foto de cédula). */
export function sniffImageMime(buf: Buffer): string {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  const head = buf.toString("utf8", 0, 256).trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "image/svg+xml";
  return "application/octet-stream";
}
