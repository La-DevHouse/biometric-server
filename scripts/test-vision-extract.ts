// Script chico para probar la extracción por foto contra la API de Gemini de
// verdad, sin pasar por el panel. Uso:
//
//   npm run test-vision -- cedula /ruta/a/foto.jpg
//   npm run test-vision -- rif /ruta/a/foto.jpg
//
// Necesita GEMINI_API_KEY en .env (ver docs/09-reunion-3.md §3.10).
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { extractCedula, extractRifPhoto } from "../lib/documentVision";

const [, , kind, path] = process.argv;

if (!kind || !path || !["cedula", "rif"].includes(kind)) {
  console.error("Uso: npm run test-vision -- <cedula|rif> <ruta-imagen>");
  process.exit(1);
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const mimeType = MIME_BY_EXT[extname(path).toLowerCase()] ?? "image/jpeg";

async function main() {
  const buf = readFileSync(path);
  console.log(`Enviando ${path} (${buf.length} bytes, ${mimeType}) a Gemini...`);
  const start = Date.now();
  const result = kind === "cedula" ? await extractCedula(buf, mimeType) : await extractRifPhoto(buf, mimeType);
  console.log(`OK en ${Date.now() - start}ms:\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error("FALLÓ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
