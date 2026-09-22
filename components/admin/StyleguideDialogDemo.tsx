"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { Field } from "@/components/ui/Field";
import { FIELD_INPUT } from "@/components/ui/fieldStyles";

/** Ejemplo vivo del patrón estándar de diálogo — form con footer fijo. */
export function StyleguideDialogDemo() {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Abrir diálogo de ejemplo
      </Btn>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ejemplo de diálogo"
        footer={
          <Btn type="submit" form={formId} variant="primary">
            Guardar
          </Btn>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          <Field label="Nombre" required>
            <input className={FIELD_INPUT} autoFocus />
          </Field>
          <p className="m-0 text-xs text-text/60">
            El botón "Guardar" vive en el <code>footer</code> del Dialog, no acá adentro — queda fijo
            aunque el form tenga más campos de los que caben en pantalla.
          </p>
        </form>
      </Dialog>
    </>
  );
}
