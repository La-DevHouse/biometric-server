"use client";

import { useState } from "react";
import { FileDropzone, type DropzoneState } from "@/components/ui/FileDropzone";

/**
 * Los 3 estados de FileDropzone para la página de referencia — uno
 * interactivo (arrastrá un archivo real) y dos estáticos (cargado/error).
 * Todo en un solo client component: una página server no puede pasarle
 * funciones (`onFile`, `onRemove`) a un client component como prop, ni
 * siquiera un no-op — cruzar ese límite con una función es justamente lo
 * que separa "server" de "client" en RSC.
 */
export function StyleguideDropzoneDemo() {
  const [state, setState] = useState<DropzoneState>({ status: "idle" });

  return (
    <>
      <FileDropzone
        label="Foto de referencia (interactivo)"
        accept="image/*"
        hint="JPG · PNG · máx 2 MB"
        state={state}
        onFile={(file) => {
          if (file.size > 2 * 1024 * 1024) {
            setState({ status: "error", message: "El archivo supera los 2 MB", hint: "Probá con otro archivo" });
            return;
          }
          setState({ status: "loaded", name: file.name, meta: `${Math.ceil(file.size / 1024)} KB · listo` });
        }}
        onRemove={() => setState({ status: "idle" })}
      />
      <FileDropzone
        label="Cargado (ejemplo estático)"
        accept="image/*"
        hint="JPG · PNG · máx 2 MB"
        state={{ status: "loaded", name: "huella-ref-0412.png", meta: "840 KB · listo" }}
        onFile={() => {}}
        onRemove={() => {}}
      />
      <FileDropzone
        label="Error (ejemplo estático)"
        accept="image/*"
        hint="JPG · PNG · máx 2 MB"
        state={{ status: "error", message: "El archivo supera los 2 MB", hint: "Probá con otro archivo" }}
        onFile={() => {}}
      />
    </>
  );
}
