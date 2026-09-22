// Tipos compartidos por cualquier proveedor de visión (Gemini hoy, swappable
// a otro después — ver docs/09-reunion-3.md §3.10 y la nota de arquitectura
// en lib/documentVision.ts).

export interface CedulaExtractedFields {
  prefix: "V" | "E";
  number: string; // solo dígitos
  firstName: string;
  lastName: string;
  birthDate: string | null; // ISO YYYY-MM-DD, o null si no se pudo leer
}

export interface RifPhotoExtractedFields {
  taxIdPrefix: string; // V | E | J | G | P
  taxIdNumber: string; // solo dígitos
  businessName: string;
  address: string | null;
}

export class VisionError extends Error {}

export interface VisionProvider {
  extractCedula(image: Buffer, mimeType: string): Promise<CedulaExtractedFields>;
  extractRif(image: Buffer, mimeType: string): Promise<RifPhotoExtractedFields>;
}
