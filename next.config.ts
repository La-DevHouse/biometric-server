import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (lib/pdfText.ts, parseo de RIF) usa pdf.js por debajo, que
  // resuelve su "worker" con rutas relativas al paquete — si Next lo empaqueta
  // (Turbopack/webpack) esas rutas se rompen ("Setting up fake worker failed").
  // Tratarlo como paquete externo del server evita el empaquetado y lo deja
  // resolver sus propios archivos con require() normal. Fix documentado por
  // la librería para Next.js/Vercel/serverless.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  async redirects() {
    return [
      { source: "/admin/logs", destination: "/admin/asistencia", permanent: true },
      { source: "/admin/commands", destination: "/admin/diagnostico", permanent: true },
      { source: "/admin/traffic", destination: "/admin/diagnostico", permanent: true },
    ];
  },
};

export default nextConfig;
