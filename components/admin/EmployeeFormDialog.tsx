"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { DocumentField } from "./DocumentField";
import { DocumentCameraCapture } from "./DocumentCameraCapture";
import { FileIconButton } from "./FileIconButton";
import { splitDoc } from "@/lib/documento";
import { createEmployeeAction, updateEmployeeAction, extractCedulaAction } from "@/app/admin/empleados/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export interface EmployeeValues {
  id: number;
  national_id: string;
  tax_id: string | null;
  first_name: string;
  last_name: string;
  birth_date: string | null; // YYYY-MM-DD
  has_cedula_photo?: boolean;
}

export function EmployeeFormDialog({ employee }: { employee?: EmployeeValues }) {
  const editing = !!employee;
  const [open, setOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [cedulaParsing, setCedulaParsing] = useState(false);
  const [cedulaPreview, setCedulaPreview] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    editing ? updateEmployeeAction : createEmployeeAction,
    ADMIN_ACTION_INITIAL
  );
  const { push } = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const cedulaFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  useEffect(() => {
    return () => {
      if (cedulaPreview) URL.revokeObjectURL(cedulaPreview);
    };
  }, [cedulaPreview]);

  const ced = splitDoc(employee?.national_id);
  const rif = splitDoc(employee?.tax_id);

  async function handleCedulaCapture(file: File) {
    // Se guarda como parte del form (input file oculto) para persistirla al
    // enviar — la extracción es aparte y solo precarga los campos de texto.
    const dt = new DataTransfer();
    dt.items.add(file);
    if (cedulaFileInputRef.current) cedulaFileInputRef.current.files = dt.files;
    setCedulaPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });

    const form = formRef.current;
    if (!form) return;

    setCedulaParsing(true);
    const fd = new FormData();
    fd.set("photo", file);
    const res = await extractCedulaAction(fd);
    setCedulaParsing(false);

    if (!res.ok) {
      push("error", res.error);
      return; // la foto queda igual guardada para el envío, aunque no se haya podido leer
    }
    const { prefix, number, firstName, lastName, birthDate } = res.fields;
    (form.elements.namedItem("doc_prefix") as HTMLSelectElement).value = prefix;
    (form.elements.namedItem("doc_number") as HTMLInputElement).value = number;
    (form.elements.namedItem("first_name") as HTMLInputElement).value = firstName;
    (form.elements.namedItem("last_name") as HTMLInputElement).value = lastName;
    if (birthDate) (form.elements.namedItem("birth_date") as HTMLInputElement).value = birthDate;
    push("ok", "Cédula leída — revisá los datos antes de guardar.");
  }

  return (
    <>
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar datos" onClick={() => setOpen(true)} />
      ) : (
        <IconBtn icon={Icon.add} label="Registrar persona" onClick={() => setOpen(true)} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar persona" : "Registrar persona"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Registrar"}
          </Btn>
        }
      >
        <form id={formId} ref={formRef} action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={employee.id} />}
          <input ref={cedulaFileInputRef} type="file" name="cedula_photo" className="hidden" />

          <div className={LABEL}>
            <span>
              Escanear cédula{" "}
              <span className="text-text/60">(precarga los datos, la foto se guarda)</span>
            </span>
            <div className="flex items-center gap-3">
              <IconBtn
                type="button"
                icon={Icon.camera}
                label="Escanear cédula con cámara"
                disabled={cedulaParsing}
                onClick={() => setCaptureOpen(true)}
              />
              <FileIconButton
                icon={Icon.upload}
                label="Subir foto de la cédula"
                accept="image/*"
                disabled={cedulaParsing}
                onFile={handleCedulaCapture}
              />
              {cedulaParsing && <span className="text-text/60 text-xs">Leyendo…</span>}
              {(cedulaPreview || employee?.has_cedula_photo) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cedulaPreview ?? `/admin/empleados/${employee?.id}/cedula`}
                  alt="cédula escaneada"
                  className="h-10 w-auto border border-divider bg-surface object-contain p-0.5"
                />
              )}
            </div>
          </div>

          <DocumentField
            kind="cedula"
            label="Cédula"
            required
            prefixName="doc_prefix"
            numberName="doc_number"
            defaultPrefix={ced.prefix}
            defaultNumber={ced.number}
          />
          <DocumentField
            kind="rif"
            label="RIF"
            hint="(vacío = igual a la cédula)"
            prefixName="rif_prefix"
            numberName="rif_number"
            defaultPrefix={rif.prefix}
            defaultNumber={rif.number}
          />

          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
            <label className={LABEL}>
              Nombre *
              <input name="first_name" required defaultValue={employee?.first_name ?? ""} className={INPUT} />
            </label>
            <label className={LABEL}>
              Apellido *
              <input name="last_name" required defaultValue={employee?.last_name ?? ""} className={INPUT} />
            </label>
            <label className={LABEL}>
              Fecha de nacimiento
              <input name="birth_date" type="date" defaultValue={employee?.birth_date ?? ""} className={INPUT} />
            </label>
          </div>
        </form>
      </Dialog>

      <DocumentCameraCapture
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onCapture={handleCedulaCapture}
        guide="id-card"
        title="Escanear cédula"
        instructions="Alineá la cédula dentro del recuadro, bien iluminada, y capturá."
      />
    </>
  );
}
