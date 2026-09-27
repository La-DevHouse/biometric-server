"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { useFormSubmit } from "@/components/ui/useFormSubmit";
import { createGroupAction, updateGroupAction } from "@/app/admin/empresas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";
import { ImpactPreview } from "./ImpactPreview";

export interface GroupFormValues {
  id: number;
  name: string;
  shared_employees: boolean;
}

/**
 * Alta/edición de un grupo de empresas (docs/10 R1). Solo nombre + "Compartir
 * empleados": un grupo no tiene RIF, sedes, equipos ni contratos — las
 * empresas se asignan al grupo desde su propio formulario.
 */
export function GroupFormDialog({ group }: { group?: GroupFormValues }) {
  const editing = !!group;
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(group?.shared_employees ?? true);
  const [state, formAction, pending] = useActionState(
    editing ? updateGroupAction : createGroupAction,
    ADMIN_ACTION_INITIAL
  );
  const onSubmit = useFormSubmit(formAction, state);
  const { push } = useToast();
  const formId = useId();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") {
      push("error", state.error);
    }
  }, [state, push]);

  return (
    <>
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar grupo" onClick={() => setOpen(true)} />
      ) : (
        <Btn variant="secondary" onClick={() => setOpen(true)}>
          + Nuevo grupo
        </Btn>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar grupo" : "Nuevo grupo de empresas"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear grupo"}
          </Btn>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={group.id} />}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={group?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className="flex items-start gap-2 text-xs text-text/85">
            <input
              type="checkbox"
              name="shared_employees"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Compartir empleados
              <span className="block text-text/60">
                Quien tenga contrato con cualquier empresa del grupo puede marcar en las sedes de
                todas las empresas del grupo.
              </span>
            </span>
          </label>
          {editing && open && shared !== group.shared_employees && (
            <ImpactPreview change={{ kind: "group_shared", groupId: group.id, shared }} />
          )}
        </form>
      </Dialog>
    </>
  );
}
