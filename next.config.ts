import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Carpeta de build aparte para QA (e2e contra un server propio en otro puerto,
  // sin pisar el .next del `npm run dev` que esté corriendo). Por defecto, .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // pdf-parse (lib/pdfText.ts, parseo de RIF) usa pdf.js por debajo, que
  // resuelve su "worker" con rutas relativas al paquete — si Next lo empaqueta
  // (Turbopack/webpack) esas rutas se rompen ("Setting up fake worker failed").
  // Tratarlo como paquete externo del server evita el empaquetado y lo deja
  // resolver sus propios archivos con require() normal. Fix documentado por
  // la librería para Next.js/Vercel/serverless.
  // Lo mismo para pdfjs-dist, que lib/import/readPdf.ts usa directo (necesita
  // la posición de cada texto, que pdf-parse no expone).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // Default de Next es 1MB — lo comprimido del lado del cliente (ver
  // DocumentCameraCapture.tsx) queda bien debajo, pero un PDF de RIF
  // escaneado (sin tope de tamaño propio) puede pasarlo fácil.
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  async redirects() {
    return [
      { source: "/admin/logs", destination: "/admin/asistencia", permanent: true },
      { source: "/admin/commands", destination: "/admin/diagnostico", permanent: true },
      { source: "/admin/traffic", destination: "/admin/diagnostico", permanent: true },
    ];
  },
};

export default nextConfig;
