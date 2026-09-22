import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Vendorizadas (fonts/*.woff2) en vez de next/font/google: el contenedor de
// build de Coolify (BuildKit efímero, sin caché entre corridas) no siempre
// tiene salida a fonts.gstatic.com, y next/font/google necesita bajar el
// archivo en build time, no solo en runtime — un fallo de red ahí tumba el
// deploy entero. Archivos variables (un solo .woff2 cubre todo el rango de
// peso), subset latin únicamente — igual que el `subsets: ["latin"]` que
// tenían antes. Regenerar: ver comentario en cada archivo de fuente si se
// necesita otro subset o familia.
const archivo = localFont({
  src: "./fonts/Archivo-Variable.woff2",
  variable: "--font-archivo",
  weight: "400 700",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-jetbrains-mono",
  weight: "400 600",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marcaje — Control de asistencia",
  description: "Panel de administración del servidor biométrico",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iOS no lee el manifest para el modo "standalone" — necesita estos
  // meta tags propios para que "Agregar a inicio" abra sin la barra de
  // Safari, con el título correcto.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Marcaje",
  },
};

export const viewport = {
  themeColor: "#3b6fa8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
