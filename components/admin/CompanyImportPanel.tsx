"use client";

// Importar trabajadores a una empresa desde el export de Galepso (docs/14):
// subir → vista previa editable (corte de nombres, puesto de cada cargo) → confirmar.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDropzone, type DropzoneState } from "@/components/ui/FileDropzone";
import { Btn } from "@/components/ui/Btn";
import { Tag } from "@/components/ui/Tag";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { FIELD_INPUT } from "@/components/ui/fieldStyles";
import { useToast } from "./Toaster";
import { describeActionError } from "@/lib/actionErrors";
import { previewCompanyImportAction, confirmCompanyImportAction, reopenCompanyImportAction } from "@/app/admin/empresas/[id]/importar/actions";
import type { PreviewPerson, PreviewView } from "@/lib/import/service";
import type { CargoChoice, CargoOp } from "@/lib/import/plan";

const SELECT = `${FIELD_INPUT} h-auto! py-[6px] text-sm`;
const fmtDate = (ymd: string) => ymd.split("-").reverse().join("/");

export function CompanyImportPanel({ companyId, resumeRunId }: { companyId: number; resumeRunId?: number }) {
  const { push } = useToast();
  const router = useRouter();
  const [view, setView] = useState<PreviewView | null>(null);
  const [drop, setDrop] = useState<DropzoneState>({ status: "idle" });
  const [splits, setSplits] = useState<Record<string, number>>({});
  const [cargoChoice, setCargoChoice] = useState<Record<string, CargoChoice>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [applying, startApplying] = useTransition();

  function load(v: PreviewView) {
    setView(v);
    setSplits({});
    setCargoChoice({});
  }

  // "Continuar" desde el historial: reabre la vista previa del archivo guardado.
  useEffect(() => {
    if (!resumeRunId) return;
    startReading(async () => {
      try {
        const res = await reopenCompanyImportAction(companyId, resumeRunId);
        if (!res.ok) {
          push("error", res.error);
          return;
        }
        setDrop({ status: "loaded", name: res.view.fileName, meta: "archivo guardado · sin confirmar" });
        load(res.view);
      } catch (err) {
        push("error", describeActionError(err));
      }
    });
  }, [companyId, resumeRunId, push]);

  function handleFile(file: File) {
    setNotice(null);
    setView(null);
    setDrop({ status: "loaded", name: file.name, meta: `${Math.ceil(file.size / 1024)} KB · leyendo…` });
    startReading(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await previewCompanyImportAction(companyId, fd);
        if (!res.ok) {
          setDrop({ status: "error", message: res.error, hint: "Solo .xlsx, máx 5 MB" });
          return;
        }
        setDrop({ status: "loaded", name: file.name, meta: `${Math.ceil(file.size / 1024)} KB · leído` });
        load(res.view);
      } catch (err) {
        setDrop({ status: "error", message: describeActionError(err), hint: "Solo .xlsx, máx 5 MB" });
      }
    });
  }

  function reset() {
    setView(null);
    setNotice(null);
    setDrop({ status: "idle" });
  }

  function confirm() {
    if (!view) return;
    startApplying(async () => {
      try {
        const res = await confirmCompanyImportAction(view.runId, { splits, cargos: cargoChoice });
        if (res.ok) {
          push("ok", res.message);
          reset();
          router.push(`/admin/empresas/${companyId}/empleados`);
          router.refresh();
          return;
        }
        if (res.view) {
          load(res.view);
          setNotice(res.error);
          return;
        }
        push("error", res.error);
      } catch (err) {
        push("error", describeActionError(err));
      }
    });
  }

  const cargoByKey = useMemo(() => new Map((view?.cargos ?? []).map((c) => [c.key, c])), [view]);
  const cargoLabel = (key: string | null): string => {
    if (!key) return "—";
    const c = cargoByKey.get(key);
    if (!c || !view) return "—";
    const choice = effectiveChoice(c, cargoChoice);
    if (choice.kind === "same") return cargoLabel(choice.key);
    if (choice.kind === "position") return view.positions.find((p) => p.id === choice.id)?.name ?? c.resolution.name;
    return choice.name?.trim() || c.text;
  };
  function chooseCargo(key: string, choice: CargoChoice) {
    setCargoChoice((prev) => {
      const next = { ...prev, [key]: choice };
      // Si este cargo pasa a ser "igual que" otro, los que apuntaban a él apuntan a ese otro (sin cadenas).
      if (choice.kind === "same") {
        for (const [k, v] of Object.entries(next)) if (v.kind === "same" && v.key === key) next[k] = { kind: "same", key: choice.key };
      }
      return next;
    });
  }
  const pendingReview = view ? view.people.filter((p) => p.split?.ambiguous && splits[p.cedula] === undefined).length : 0;
  const nothingToDo = view ? view.counts.newContracts + view.counts.updatedContracts === 0 : true;

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone
        label="Listado de trabajadores activos (Galepso)"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hint="El export de Galepso tal cual · .xlsx, máx 5 MB"
        state={drop}
        onFile={handleFile}
        onRemove={reset}
        disabled={reading || applying}
      />

      {view && (
        <section className="flex flex-col gap-4">
          {notice && <p className="m-0 border border-accent2 bg-accent2-100 p-3 text-sm">{notice}</p>}

          <div className="grid gap-3 sm:grid-cols-3">
            <Box title="Personas">
              {view.counts.newPeople} nueva(s) · {view.counts.existingPeople} ya en el sistema
            </Box>
            <Box title="Contratos en esta empresa">
              {[
                view.counts.newContracts && `${view.counts.newContracts} nuevo(s)`,
                view.counts.updatedContracts && `${view.counts.updatedContracts} cambian de puesto`,
                view.counts.sameContracts && `${view.counts.sameContracts} sin cambios`,
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </Box>
            <Box title="Equipos">
              {view.devices.peopleIn === 0
                ? "Nadie nuevo para los equipos."
                : view.devices.devices > 0
                  ? `${view.devices.peopleIn} persona(s) a ${view.devices.devices} equipo(s), solas al confirmar`
                  : `${view.devices.peopleIn} persona(s); la empresa todavía no tiene equipos`}
            </Box>
          </div>

          {view.warnings.map((w, i) => (
            <p key={i} className="m-0 text-sm text-neutral-800">{w}</p>
          ))}

          {view.rejected.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-sm">
                <b>{view.rejected.length} problema(s): no se va a aplicar nada</b> hasta que estén corregidos en el Excel. Corregilo y volvé a subirlo.
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Fila</Th>
                    <Th>Columna</Th>
                    <Th>Motivo</Th>
                  </tr>
                </thead>
                <tbody>
                  {view.rejected.map((r, i) => (
                    <Tr key={i}>
                      <Td className="font-mono">{r.row ?? "—"}</Td>
                      <Td>{r.column ?? "—"}</Td>
                      <Td className="[overflow-wrap:anywhere]">{r.message}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {view.cargos.length > 0 && (
            <CargoTable view={view} choice={cargoChoice} onChoose={chooseCargo} label={cargoLabel} />
          )}

          {view.people.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="m-0 font-mono text-label uppercase tracking-[0.12em] text-neutral-800">Personas</h3>
              {view.counts.ambiguous > 0 && (
                <p className="m-0 text-sm">
                  <b>{view.counts.ambiguous}</b> nombre(s) resaltado(s): no es seguro dónde terminan los nombres y empiezan los apellidos. Revisá el corte.
                </p>
              )}
              <Table>
                <thead>
                  <tr>
                    <Th>Fila</Th>
                    <Th>Cédula</Th>
                    <Th>Nombres | Apellidos</Th>
                    <Th>Ingreso</Th>
                    <Th>Puesto</Th>
                    <Th>Contrato</Th>
                  </tr>
                </thead>
                <tbody>
                  {view.people.map((p) => (
                    <PersonRow
                      key={p.cedula}
                      p={p}
                      boundary={splits[p.cedula]}
                      onBoundary={(b) => setSplits((s) => ({ ...s, [p.cedula]: b }))}
                      cargo={cargoLabel(p.cargoKey)}
                    />
                  ))}
                </tbody>
              </Table>
              {view.peopleTotal > view.people.length && (
                <p className="m-0 text-xs text-neutral-700">y {view.peopleTotal - view.people.length} persona(s) más, sin nada que revisar.</p>
              )}
            </div>
          )}

          {view.absent.length > 0 && (
            <details className="border border-neutral-400 bg-surface">
              <summary className="cursor-pointer px-[14px] py-[11px] text-sm">
                <b>{view.absent.length}</b> persona(s) con contrato vigente en esta empresa <b>no están en el archivo</b>. No se les da de baja; revisalo en el panel.
              </summary>
              <ul className="m-0 flex flex-col gap-0.5 px-[14px] pb-[11px] pl-8 text-sm">
                {view.absent.map((a) => (
                  <li key={a.cedula}>
                    {a.name} · <span className="font-mono">{a.cedula}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="primary" onClick={confirm} disabled={!view.ok || applying || nothingToDo}>
              {applying ? "Aplicando…" : "Confirmar importación"}
            </Btn>
            <Btn onClick={reset} disabled={applying}>
              Subir otro archivo
            </Btn>
            {view.ok && nothingToDo && <span className="text-sm text-neutral-700">Todos ya tienen su contrato: no hay nada para aplicar.</span>}
            {view.ok && !nothingToDo && pendingReview > 0 && (
              <span className="text-sm text-neutral-700">Quedan {pendingReview} nombre(s) resaltado(s) sin revisar.</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border border-neutral-400 bg-surface p-3">
      <span className="font-mono text-label uppercase tracking-[0.12em] text-neutral-800">{title}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function PersonRow({ p, boundary, onBoundary, cargo }: { p: PreviewPerson; boundary?: number; onBoundary: (b: number) => void; cargo: string }) {
  const split = p.split;
  const b = boundary ?? split?.boundary ?? 0;
  const highlight = split?.ambiguous && boundary === undefined;
  const contract =
    p.contract === "create" ? <Tag variant="accent">Nuevo</Tag> : p.contract === "update" ? <Tag>Cambia puesto</Tag> : <Tag variant="outline">Sin cambios</Tag>;
  return (
    <Tr className={highlight ? "bg-accent2-100" : undefined}>
      <Td className="font-mono">{p.row}</Td>
      <Td className="whitespace-nowrap font-mono">{p.cedula}</Td>
      <Td>
        {split && split.tokens.length > 2 ? (
          <select value={b} onChange={(e) => onBoundary(Number(e.target.value))} className={SELECT} aria-label={`Corte de nombres de ${p.cedula}`}>
            {split.tokens.slice(0, -1).map((_, i) => (
              <option key={i} value={i + 1}>
                {split.tokens.slice(0, i + 1).join(" ")} | {split.tokens.slice(i + 1).join(" ")}
              </option>
            ))}
          </select>
        ) : (
          <span>
            {p.firstName} | {p.lastName}
          </span>
        )}
        {p.employee === "existing" && (
          <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-neutral-700">
            <Tag variant="outline">Ya existe</Tag>
            {p.fileName && <span>en el archivo: “{p.fileName}” (se deja el nombre del sistema)</span>}
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap">{fmtDate(p.startDate)}</Td>
      <Td>{cargo}</Td>
      <Td>{contract}</Td>
    </Tr>
  );
}

/** Lo elegido para un cargo, o lo que el sistema propone si no se tocó. */
function effectiveChoice(c: CargoOp, choices: Record<string, CargoChoice>): CargoChoice {
  const chosen = choices[c.key];
  if (chosen) return chosen;
  const r = c.resolution;
  return r.kind === "position" || r.kind === "alias" || r.kind === "mapped" ? { kind: "position", id: r.positionId } : { kind: "new" };
}

function CargoTable({
  view,
  choice,
  onChoose,
  label,
}: {
  view: PreviewView;
  choice: Record<string, CargoChoice>;
  onChoose: (key: string, v: CargoChoice) => void;
  label: (key: string) => string;
}) {
  const encode = (c: CargoChoice) => (c.kind === "new" ? "new" : c.kind === "same" ? `same:${c.key}` : `pos:${c.id}`);
  const note = (c: CargoOp) =>
    c.resolution.kind === "position" ? "ya existe" : c.resolution.kind === "alias" ? "asignado en una importación anterior" : null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 font-mono text-label uppercase tracking-[0.12em] text-neutral-800">Cargos → Puestos</h3>
      <p className="m-0 text-sm text-text/80">
        Unificá los cargos que son el mismo puesto (<b>Igual que…</b>: un error de tipeo o la versión en femenino), corregí el nombre de los
        que se crean, o asignalos a un puesto que ya existe. Lo que decidas se recuerda para los próximos archivos.
      </p>
      <Table>
        <thead>
          <tr>
            <Th>Cargo en el archivo</Th>
            <Th>Personas</Th>
            <Th>Puesto</Th>
          </tr>
        </thead>
        <tbody>
          {view.cargos.map((c) => {
            const current = effectiveChoice(c, choice);
            // "Igual que": solo cargos que no estén unificados con otro (sin cadenas).
            const targets = view.cargos.filter((o) => o.key !== c.key && effectiveChoice(o, choice).kind !== "same");
            const n = note(c);
            return (
              <Tr key={c.key}>
                <Td>
                  {c.text}
                  {n && <span className="block text-xs text-neutral-700">{n}</span>}
                </Td>
                <Td>{c.count}</Td>
                <Td>
                  <div className="flex flex-col gap-1.5">
                    <select
                      value={encode(current)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "new") onChoose(c.key, { kind: "new" });
                        else if (v.startsWith("same:")) onChoose(c.key, { kind: "same", key: v.slice(5) });
                        else onChoose(c.key, { kind: "position", id: Number(v.slice(4)) });
                      }}
                      className={SELECT}
                      aria-label={`Puesto para el cargo ${c.text}`}
                    >
                      <option value="new">Crear puesto nuevo</option>
                      {targets.length > 0 && (
                        <optgroup label="Igual que otro cargo de este archivo">
                          {targets.map((o) => (
                            <option key={o.key} value={`same:${o.key}`}>
                              Igual que “{o.text}”
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {view.positions.length > 0 && (
                        <optgroup label="Puesto que ya existe">
                          {view.positions.map((p) => (
                            <option key={p.id} value={`pos:${p.id}`}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {current.kind === "new" && (
                      <input
                        value={current.name ?? c.text}
                        onChange={(e) => onChoose(c.key, { kind: "new", name: e.target.value })}
                        className={SELECT}
                        aria-label={`Nombre del puesto nuevo para ${c.text}`}
                        placeholder={c.text}
                      />
                    )}
                    {current.kind === "same" && <span className="text-xs text-neutral-700">Queda como “{label(c.key)}”</span>}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
