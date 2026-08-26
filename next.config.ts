import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/admin/logs", destination: "/admin/asistencia", permanent: true },
      { source: "/admin/commands", destination: "/admin/diagnostico", permanent: true },
      { source: "/admin/traffic", destination: "/admin/diagnostico", permanent: true },
    ];
  },
};

export default nextConfig;
