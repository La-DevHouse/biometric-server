// Genera los íconos de la PWA a partir de public/logo-alco.jpg: lo mete en
// un lienzo cuadrado (fondo blanco — el logo ya tiene esquinas blancas, no
// se nota la costura) y exporta los tamaños que pide manifest.json +
// apple-touch-icon. Volver a correr esto cada vez que se actualice el logo.
//
//   npx tsx scripts/generate-pwa-icons.ts

import sharp from "sharp";
import { mkdirSync } from "fs";
import path from "path";

const SRC = path.join(__dirname, "..", "public", "logo-alco.jpg");
const OUT_DIR = path.join(__dirname, "..", "public", "icons");

const SIZES: { file: string; size: number; padPct: number }[] = [
  { file: "icon-192.png", size: 192, padPct: 0.06 },
  { file: "icon-512.png", size: 512, padPct: 0.06 },
  { file: "icon-maskable-512.png", size: 512, padPct: 0.18 }, // safe zone para Android adaptive icons
  { file: "apple-touch-icon.png", size: 180, padPct: 0.06 }, // iOS no respeta transparencia/máscara, pero sí el padding
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const { file, size, padPct } of SIZES) {
    const inner = Math.round(size * (1 - padPct * 2));
    const resized = await sharp(SRC)
      .resize(inner, inner, { fit: "contain", background: "#ffffff" })
      .toBuffer();

    await sharp({
      create: { width: size, height: size, channels: 3, background: "#ffffff" },
    })
      .composite([{ input: resized, gravity: "center" }])
      .png()
      .toFile(path.join(OUT_DIR, file));

    console.log(`✓ ${file} (${size}x${size})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
