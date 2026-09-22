// Punto único de entrada para "extraer datos de una foto de un documento"
// (cédula, RIF). El resto de la app importa DE ACÁ, nunca directamente de
// lib/vision/gemini.ts — así, cambiar de proveedor (a Claude, por ejemplo)
// es reemplazar `activeProvider` por otra implementación de VisionProvider,
// sin tocar los server actions ni los componentes que lo usan.
// Ver docs/09-reunion-3.md §3.10 / §7.1 (decisión 2026-09-21: Gemini Flash,
// tier gratis, mientras se valida el flujo).
import { geminiVisionProvider } from "./vision/gemini";
import type { CedulaExtractedFields, RifPhotoExtractedFields } from "./vision/types";

export type { CedulaExtractedFields, RifPhotoExtractedFields };
export { VisionError } from "./vision/types";

const activeProvider = geminiVisionProvider;

export async function extractCedula(image: Buffer, mimeType: string): Promise<CedulaExtractedFields> {
  return activeProvider.extractCedula(image, mimeType);
}

export async function extractRifPhoto(image: Buffer, mimeType: string): Promise<RifPhotoExtractedFields> {
  return activeProvider.extractRif(image, mimeType);
}
