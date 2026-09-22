"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { Collapsible } from "@/components/ui/Collapsible";
import { FileDropzone, type DropzoneState } from "@/components/ui/FileDropzone";
import { useToast } from "./Toaster";
import { DocumentField } from "./DocumentField";
import { DocumentCameraCapture } from "./DocumentCameraCapture";
import { FileIconButton } from "./FileIconButton";
import { splitDoc } from "@/lib/documento";
import {
  createCompanyAction,
  updateCompanyAction,
  parseRifPdfAction,
  extractRifPhotoAction,
} from "@/app/admin/empresas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import type { RifExtractedFields } from "@/lib/rifParser";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export interface CompanyFormValues {
  id: number;
  name: string;
  tax_id: string | null;
  is_group: boolean;
  shared_employees: boolean;
  address: string | null;
  parent_id: number | null;
  business_model_id: number | null;
  has_logo: boolean;
  legal_rep_name: string | null;
  legal_rep_national_id: string | null;
  legal_rep_phone: string | null;
  late_tolerance_min: number | null;
  early_leave_tolerance_min: number | null;
  absence_rule: "no_check_in" | "no_marks" | "under_hours" | null;
  absence_min_hours: number | null;
}

export function CompanyFormDialog({
  company,
  parentOptions,
  businessModels,
}: {
  company?: CompanyFormValues;
  parentOptions: { id: number; name: string }[];
  businessModels: { id: number; name: string }[];
}) {
  const editing = !!company;
  const [open, setOpen] = useState(false);
  const [isGroup, setIsGroup] = useState(company?.is_group ?? false);
  const [rifParsing, setRifParsing] = useState(false);
  const [rifCaptureOpen, setRifCaptureOpen] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [removeExistingLogo, setRemoveExistingLogo] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateCompanyAction : createCompanyAction,
    ADMIN_ACTION_INITIAL
  );
  const { push } = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") {
      push("error", state.error);
    }
  }, [state, push]);

  // el padre no puede ser una empresa hija ni la empresa misma
  const options = parentOptions.filter((p) => p.id !== company?.id);

  function applyRifFields(fields: RifExtractedFields) {
    const form = formRef.current;
    if (!form) return;
    setIsGroup(false);
    (form.elements.namedItem("is_group") as HTMLInputElement).checked = false;
    (form.elements.namedItem("rif_prefix") as HTMLSelectElement).value = fields.taxIdPrefix;
    (form.elements.namedItem("rif_number") as HTMLInputElement).value = fields.taxIdNumber;
    (form.elements.namedItem("name") as HTMLInputElement).value = fields.businessName;
    if (fields.address) (form.elements.namedItem("address") as HTMLInputElement).value = fields.address;
  }

  // Un solo punto de entrada para "subir archivo" — PDF (comprobante del
  // SENIAT) o foto van al mismo botón, y se enrutan según el MIME type al
  // parser determinístico (PDF) o a Gemini (foto). La cámara siempre da una
  // foto, así que reusa la misma rama.
  async function handleRifFile(file: File) {
    setRifParsing(true);
    const fd = new FormData();
    const isPdf = file.type === "application/pdf";
    fd.set(isPdf ? "rif_pdf" : "photo", file);
    const res = isPdf ? await parseRifPdfAction(fd) : await extractRifPhotoAction(fd);
    setRifParsing(false);

    if (!res.ok) {
      push("error", res.error);
      return;
    }
    applyRifFields(res.fields);
    push("ok", "RIF leído — revisá los datos antes de guardar.");
  }

  const LOGO_ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  const LOGO_MAX_BYTES = 512 * 1024;

  function handleLogoFile(file: File) {
    // Feedback inmediato, sin ida y vuelta al servidor — el server action
    // valida esto mismo igual, esto es solo para no hacer esperar el submit.
    if (file.type && !LOGO_ACCEPT.includes(file.type)) {
      setLogoError("Formato no soportado (PNG, JPG, WEBP o SVG)");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError("El archivo supera los 512 KB");
      return;
    }
    setLogoError(null);
    setRemoveExistingLogo(false);
    setLogoFile(file);
    const dt = new DataTransfer();
    dt.items.add(file);
    if (logoInputRef.current) logoInputRef.current.files = dt.files;
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  function handleRemoveLogo() {
    if (logoFile) {
      setLogoFile(null);
      setLogoError(null);
      if (logoInputRef.current) logoInputRef.current.value = "";
      setLogoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } else if (company?.has_logo) {
      setRemoveExistingLogo(true);
    }
  }

  const hasExistingLogo = !!company?.has_logo && !removeExistingLogo;
  const logoDropzoneState: DropzoneState = logoError
    ? { status: "error", message: logoError, hint: "Probá con otro archivo" }
    : logoFile
      ? { status: "loaded", name: logoFile.name, meta: `${Math.ceil(logoFile.size / 1024)} KB · listo` }
      : hasExistingLogo
        ? { status: "loaded", name: "Logo actual", meta: "Guardado" }
        : { status: "idle" };

  return (
    <>
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar empresa" onClick={() => setOpen(true)} />
      ) : (
        <IconBtn icon={Icon.add} label="Nueva empresa" onClick={() => setOpen(true)} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar empresa" : "Nueva empresa cliente"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear empresa"}
          </Btn>
        }
      >
        <form id={formId} ref={formRef} action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={company.id} />}

          <label className={LABEL}>
            Autocompletar desde RIF{" "}
            <span className="text-text/60">(PDF del comprobante del SENIAT o foto)</span>
            <div className="flex flex-wrap items-center gap-2">
              <FileIconButton
                icon={Icon.upload}
                label="Subir RIF (PDF o foto)"
                accept="application/pdf,image/*"
                disabled={rifParsing}
                onFile={handleRifFile}
              />
              <IconBtn
                type="button"
                icon={Icon.camera}
                label="Escanear RIF con cámara"
                disabled={rifParsing}
                onClick={() => setRifCaptureOpen(true)}
              />
              {rifParsing && <span className="text-text/60">Leyendo…</span>}
            </div>
          </label>

          <label className={LABEL}>
            Razón social *
            <input name="name" required defaultValue={company?.name ?? ""} className={INPUT} autoFocus />
          </label>

          <label className="flex items-center gap-2 text-xs text-text/85">
            <input
              type="checkbox"
              name="is_group"
              defaultChecked={company?.is_group ?? false}
              onChange={(e) => setIsGroup(e.target.checked)}
            />
            Es un grupo de empresas (agrupa empresas hijas; sin RIF)
          </label>

          <DocumentField
            kind="rif"
            label="RIF"
            hint={isGroup ? "(no aplica a grupos)" : undefined}
            required={!isGroup}
            prefixName="rif_prefix"
            numberName="rif_number"
            defaultPrefix={company ? splitDoc(company.tax_id).prefix : "J"}
            defaultNumber={splitDoc(company?.tax_id).number}
          />

          <label className={LABEL}>
            Empresa padre
            <select name="parent_id" defaultValue={company?.parent_id ?? ""} className={INPUT}>
              <option value="">— sin padre (nivel superior) —</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-text/85">
            <input
              type="checkbox"
              name="shared_employees"
              defaultChecked={company?.shared_employees ?? true}
            />
            Compartir empleados con todas las empresas del grupo
          </label>

          <label className={LABEL}>
            Modelo de negocio
            <select
              name="business_model_id"
              defaultValue={company?.business_model_id ?? ""}
              className={INPUT}
            >
              <option value="">— hereda del grupo / sin especificar —</option>
              {businessModels.map((bm) => (
                <option key={bm.id} value={bm.id}>
                  {bm.name}
                </option>
              ))}
            </select>
          </label>

          <label className={LABEL}>
            Dirección
            <input name="address" defaultValue={company?.address ?? ""} className={INPUT} />
          </label>

          <input ref={logoInputRef} type="file" name="logo" className="hidden" />
          {removeExistingLogo && <input type="hidden" name="remove_logo" value="on" />}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <FileDropzone
                label="Logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hint="PNG · JPG · WEBP · SVG · máx 512 KB"
                state={logoDropzoneState}
                onFile={handleLogoFile}
                onRemove={handleRemoveLogo}
              />
            </div>
            {(logoPreview || hasExistingLogo) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview ?? `/admin/empresas/${company?.id}/logo`}
                alt="logo"
                className="mt-6 h-10 w-auto flex-none border border-divider bg-surface object-contain p-0.5"
              />
            )}
          </div>

          <Collapsible title="Representante legal">
            <label className={LABEL}>
              Nombre
              <input
                name="legal_rep_name"
                defaultValue={company?.legal_rep_name ?? ""}
                className={INPUT}
              />
            </label>
            <DocumentField
              kind="cedula"
              label="Cédula"
              prefixName="legal_rep_ced_prefix"
              numberName="legal_rep_ced_number"
              defaultPrefix={company ? splitDoc(company.legal_rep_national_id).prefix : "V"}
              defaultNumber={splitDoc(company?.legal_rep_national_id).number}
            />
            <label className={LABEL}>
              Teléfono
              <input
                name="legal_rep_phone"
                defaultValue={company?.legal_rep_phone ?? ""}
                className={INPUT}
              />
            </label>
          </Collapsible>

          <Collapsible title="Umbrales de asistencia">
            <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
              <label className={LABEL}>
                Tolerancia tardanza (min)
                <input
                  name="late_tolerance_min"
                  type="number"
                  min={0}
                  defaultValue={company?.late_tolerance_min ?? ""}
                  className={INPUT}
                />
              </label>
              <label className={LABEL}>
                Tolerancia salida antic. (min)
                <input
                  name="early_leave_tolerance_min"
                  type="number"
                  min={0}
                  defaultValue={company?.early_leave_tolerance_min ?? ""}
                  className={INPUT}
                />
              </label>
              <label className={LABEL}>
                Regla de ausencia
                <select
                  name="absence_rule"
                  defaultValue={company?.absence_rule ?? ""}
                  className={INPUT}
                >
                  <option value="">— sin definir —</option>
                  <option value="no_check_in">No marcó entrada</option>
                  <option value="no_marks">No marcó nada</option>
                  <option value="under_hours">Trabajó menos de X horas</option>
                </select>
              </label>
              <label className={LABEL}>
                Horas mínimas (si aplica)
                <input
                  name="absence_min_hours"
                  type="number"
                  min={0}
                  defaultValue={company?.absence_min_hours ?? ""}
                  className={INPUT}
                />
              </label>
            </div>
          </Collapsible>
        </form>
      </Dialog>

      <DocumentCameraCapture
        open={rifCaptureOpen}
        onClose={() => setRifCaptureOpen(false)}
        onCapture={handleRifFile}
        guide="document"
        title="Escanear RIF"
        instructions="Alineá la hoja del RIF dentro del recuadro, bien iluminada, y capturá."
      />
    </>
  );
}
