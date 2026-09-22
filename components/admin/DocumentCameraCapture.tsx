"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";

type GuideShape = "id-card" | "document";

// Proporción ancho/alto del recuadro guía. Cédula = tarjeta de crédito
// (85.6mm × 54mm); RIF = una hoja tipo carta/A4 en vertical.
const GUIDE_ASPECT: Record<GuideShape, number> = {
  "id-card": 1.586,
  document: 0.72,
};

// La cámara de un iPhone da video/fotos en resoluciones enormes (fácil pasa
// 3000px de lado) — sin tope, el JPEG resultante supera el límite de 1MB de
// los Server Actions (ver lib/actionErrors.ts, next.config.ts). 1600px de
// lado largo sobra para leer texto de un documento.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

/** Reescala (nunca agranda) una imagen ya elegida — la ruta de fallback del
 * input de archivo no pasa por el <canvas> del recorte en vivo, así que
 * necesita su propio paso de compresión antes de mandarse. */
async function downscaleImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) return file;
  return new File([blob], "captura.jpg", { type: "image/jpeg" });
}

/**
 * Captura por cámara con un recuadro guía semitransparente (estilo "blueprint"
 * del resto del panel — ver globals.css) que induce a poner el documento
 * alineado antes de sacar la foto. Si no hay cámara disponible/permitida, cae
 * a un input de archivo normal (en mobile, `capture="environment"` abre la
 * cámara nativa igual, aunque sin el guía). Ver docs/09-reunion-3.md §3.10.
 */
export function DocumentCameraCapture({
  open,
  onClose,
  onCapture,
  guide,
  title,
  instructions,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  guide: GuideShape;
  title: string;
  instructions: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReady(false);

    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no da acceso a la cámara. Subí una foto en su lugar.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => setError("No se pudo acceder a la cámara. Subí una foto en su lugar."));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Recorta al ~86% central con la proporción del guía, para que lo que se
    // manda a extraer sea (más o menos) lo que el usuario alineó adentro.
    const aspect = GUIDE_ASPECT[guide];
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let cropW = vw * 0.86;
    let cropH = cropW / aspect;
    if (cropH > vh * 0.86) {
      cropH = vh * 0.86;
      cropW = cropH * aspect;
    }
    const sx = (vw - cropW) / 2;
    const sy = (vh - cropH) / 2;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(cropW, cropH));
    const outW = Math.round(cropW * scale);
    const outH = Math.round(cropH * scale);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    canvas.getContext("2d")?.drawImage(video, sx, sy, cropW, cropH, 0, 0, outW, outH);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], "captura.jpg", { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  }

  async function handleFallbackFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // La foto nativa del iPhone (esta ruta no pasa por el <canvas> de arriba)
    // puede venir en varios MB — si el reescalado falla por lo que sea, se
    // manda igual el original en vez de bloquear a la persona acá.
    const resized = await downscaleImage(file).catch(() => file);
    onCapture(resized);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-xs text-text/70">{instructions}</p>

        {error ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-text/70">{error}</p>
            <input
              type="file"
              accept="image/*"
              // En mobile abre directo la cámara nativa (sin el guía).
              // eslint-disable-next-line react/no-unknown-property
              capture="environment"
              onChange={handleFallbackFile}
              className="text-xs"
            />
          </div>
        ) : (
          <div className="relative w-full overflow-hidden bg-text/90" style={{ aspectRatio: "4 / 3" }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setReady(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ width: "86%", aspectRatio: String(GUIDE_ASPECT[guide]) }}
            >
              <div className="absolute inset-0 border border-bg/60" />
              <GuideCorners />
            </div>
          </div>
        )}

        {!error && (
          <Btn type="button" variant="primary" disabled={!ready} onClick={capture}>
            {ready ? "Capturar" : "Preparando cámara…"}
          </Btn>
        )}
      </div>
    </Dialog>
  );
}

/** Marcas de esquina tipo "blueprint" (mismo lenguaje visual que Card.tsx),
 * escaladas para el recuadro guía en vez del tamaño fijo de globals.css. */
function GuideCorners() {
  const base = "absolute w-6 h-6 border-accent2";
  return (
    <>
      <span className={`${base} top-0 left-0 border-t-2 border-l-2`} aria-hidden />
      <span className={`${base} top-0 right-0 border-t-2 border-r-2`} aria-hidden />
      <span className={`${base} bottom-0 left-0 border-b-2 border-l-2`} aria-hidden />
      <span className={`${base} bottom-0 right-0 border-b-2 border-r-2`} aria-hidden />
    </>
  );
}
