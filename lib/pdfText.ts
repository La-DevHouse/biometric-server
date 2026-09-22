// Debe importarse ANTES que "pdf-parse" — si no, pdf.js falla con "Setting up
// fake worker failed" al correr empaquetado dentro del server de Next.js.
// Fix documentado por la librería (troubleshooting.md, sección "Next.js &
// Vercel, ... Serverless Functions"). Ver también next.config.ts
// (`serverExternalPackages`), necesario junto con esto.
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

/**
 * Extrae el texto de un PDF (usa pdf.js por debajo, vía `pdf-parse`).
 * Solo sirve para PDFs con capa de texto real — uno escaneado sin OCR
 * devuelve texto vacío o basura; eso se trata como error en el llamador.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
