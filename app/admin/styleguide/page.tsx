import { requireUser } from "@/lib/auth";
import { cx } from "@/lib/cx";
import { Btn, LinkBtn, DisabledBtn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon, FunnelIcon } from "@/components/ui/icons";
import { Tag } from "@/components/ui/Tag";
import { Card, CardKicker, CardTitle, CardBody, CardMeta } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { StatusDot } from "@/components/ui/StatusDot";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Collapsible } from "@/components/ui/Collapsible";
import { EmptyState } from "@/components/ui/EmptyState";
import { FIELD_INPUT, FIELD_LABEL } from "@/components/ui/fieldStyles";
import { Field } from "@/components/ui/Field";
import { StyleguideDialogDemo } from "@/components/admin/StyleguideDialogDemo";
import { StyleguideFiltersDemo } from "@/components/admin/StyleguideFiltersDemo";
import { StyleguideDropzoneDemo } from "@/components/admin/StyleguideDropzoneDemo";

export const dynamic = "force-dynamic";

const COLORS: { token: string; className: string; label: string }[] = [
  { token: "--color-bg", className: "bg-bg border border-divider", label: "bg" },
  { token: "--color-surface", className: "bg-surface border border-divider", label: "surface" },
  { token: "--color-text", className: "bg-text", label: "text / ink" },
  { token: "--color-accent", className: "bg-accent", label: "accent" },
  { token: "--color-accent2", className: "bg-accent2-500", label: "accent2 / warn" },
  { token: "--color-neutral-700", className: "bg-neutral-700", label: "neutral-700 / mute" },
  { token: "--color-danger-600", className: "bg-danger-600", label: "danger" },
  { token: "--color-chrome", className: "bg-chrome border border-divider", label: "chrome" },
];

// El mismo layout que "Escala tipográfica" de la maqueta: spec en mono a la
// izquierda ("26 / 600 / -2%"), muestra real a la derecha, fila con
// divisor. `spec` incluye el +2px de compromiso sobre el tamaño de la
// maqueta en los 4 escalones de lectura — no es el número que dice la
// maqueta, es el que quedó adoptado.
const TYPE_SCALE: { spec: string; cls: string; weight?: "font-semibold"; label: string }[] = [
  { spec: "26 / 600 / -2%", cls: "text-2xl", weight: "font-semibold", label: "Título de página" },
  { spec: "20 / 600 / -1%", cls: "text-xl", weight: "font-semibold", label: "Título de sección y diálogo" },
  { spec: "17 / 600", cls: "text-lg", weight: "font-semibold", label: "Nombre de fila, card title" },
  { spec: "15 / 400", cls: "text-sm", label: "Cuerpo — el 95% del panel, celdas, inputs" },
  { spec: "12 / 400", cls: "text-xs", label: "Texto secundario, hints, ayuda" },
  {
    spec: "mono 10 / +.10–18em",
    cls: "font-mono text-2xs uppercase tracking-[0.14em]",
    label: "Label de campo, header de tabla, kicker, nav, tag",
  },
  { spec: "mono 32 / 600 / -2%", cls: "font-mono text-[32px] font-semibold tracking-tight", label: "1.284" },
];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-divider pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="m-0 font-heading text-xl font-semibold tracking-tight">{title}</h2>
        {note && <p className="m-0 mt-1 text-xs text-text/60 max-w-2xl">{note}</p>}
      </div>
      <div className="flex flex-col items-start gap-3">{children}</div>
    </section>
  );
}

export default async function StyleguidePage() {
  await requireUser();

  return (
    <div className="flex max-w-3xl flex-col gap-8 pb-16">
      <div>
        <h1 className="font-heading m-0 text-2xl font-semibold tracking-tight">Design system</h1>
        <p className="m-0 mt-1 text-sm text-text/70">
          Referencia viva — cada pieza de acá es el componente real, no una foto. Si algo se ve
          distinto en una pantalla del panel, esa pantalla está desviada del sistema, no al revés.
          Fuente: <code className="text-xs">app/globals.css</code> (tokens),{" "}
          <code className="text-xs">components/ui/</code> (primitivas).
        </p>
      </div>

      <Section title="Color" note="Definidos como @theme en app/globals.css. Cada uno tiene una rampa 100–900 salvo bg/surface/text.">
        <div className="flex flex-wrap gap-4">
          {COLORS.map((c) => (
            <div key={c.token} className="flex flex-col gap-1.5">
              <div className={`h-14 w-14 ${c.className}`} />
              <span className="text-xs text-text/70">{c.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Escala tipográfica"
        note='Vuelta a los tamaños de la maqueta (2026-09-23) — la escala grande de antes (Reunión 3, "todos tenemos +40") no era cohesiva con la densidad del sistema nuevo. Compromiso: +2px en los 4 escalones de lectura (título de página → cuerpo); mute/label/kicker se quedan tal cual la maqueta. Archivo (texto y headings) + JetBrains Mono (todo el "chrome": labels, kickers, headers de tabla, números).'
      >
        <div className="w-full flex flex-col">
          {TYPE_SCALE.map((t) => (
            <div
              key={t.spec}
              className="grid grid-cols-[110px_1fr] gap-2.5 items-baseline py-1.5 border-b border-neutral-200 last:border-b-0"
            >
              <span className="font-mono text-2xs text-neutral-700">{t.spec}</span>
              <span className={cx(t.cls, t.weight, "tracking-tight")}>{t.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Botones" note="components/ui/Btn.tsx — 4 variantes + Link/Disabled. Ícono-solo siempre con IconBtn (fuerza title + aria-label).">
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary">Primary</Btn>
          <Btn variant="secondary">Secondary</Btn>
          <Btn variant="ghost">Ghost</Btn>
          <LinkBtn href="/admin/styleguide" variant="ghost">
            Link →
          </LinkBtn>
          <DisabledBtn variant="secondary" title="Ejemplo de acción no disponible">
            Disabled
          </DisabledBtn>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <IconBtn icon={Icon.add} label="Agregar" />
          <IconBtn icon={Icon.camera} label="Escanear" />
          <IconBtn icon={Icon.upload} label="Subir archivo" />
          <IconBtn icon={Icon.sync} label="Sincronizar" />
          <IconBtn icon={Icon.trash} label="Eliminar" tone="danger" />
          <IconBtn icon={<FunnelIcon />} label="Filtros" />
        </div>
        <p className="m-0 text-xs text-text/60">
          Patrón: <code>{"<IconBtn icon={Icon.add} label=\"Nueva empresa\" onClick={...} />"}</code> —
          nunca <code>{"<Btn variant=\"icon\">"}</code> suelto, para no repetir title/aria-label a mano.
        </p>
      </Section>

      <Section title="Tags" note="components/ui/Tag.tsx — estado (accent = activo/positivo, neutral = inactivo/default, accent2 = atención, outline = secundario).">
        <div className="flex flex-wrap gap-2">
          <Tag variant="accent">Activo</Tag>
          <Tag variant="neutral">Inactivo</Tag>
          <Tag variant="accent2">Atención</Tag>
          <Tag variant="outline">Secundario</Tag>
        </div>
      </Section>

      <Section
        title="Campos de formulario"
        note="components/ui/Field.tsx + fieldStyles.ts (FIELD_INPUT / FIELD_LABEL) — el único origen de este estilo; antes estaba copiado a mano en 24 archivos."
      >
        <div className="flex flex-col sm:grid sm:grid-cols-2 gap-3 max-w-md">
          <Field label="Nombre" required>
            <input className={FIELD_INPUT} placeholder="ej. Farmalido C.A." />
          </Field>
          <Field label="Código" hint="(opcional)">
            <input className={FIELD_INPUT} placeholder="FARM-01" />
          </Field>
          <Field label="Estado">
            <select className={FIELD_INPUT}>
              <option>Activo</option>
              <option>Inactivo</option>
            </select>
          </Field>
        </div>
        <p className="m-0 text-xs text-text/60">
          Uso directo sin <code>{"<Field>"}</code>: <code>{"className={FIELD_LABEL}"}</code> /{" "}
          <code>{"className={FIELD_INPUT}"}</code>, para estructuras que no calzan en el wrapper
          (checkboxes, grupos con hint entre el label y el input, etc).
        </p>
        <label className={FIELD_LABEL}>
          Checkbox con FIELD_LABEL, estructura libre
          {/* font-sans normal-case text-[13px]: corta la herencia de font-mono/uppercase/
              text-[11px] del <label> — el texto de una opción de checkbox es contenido real,
              no chrome de UI, y va al tamaño de cuerpo de la maqueta, no al de un label. */}
          <span className="mt-1 flex items-center gap-2 text-[13px] font-sans normal-case tracking-normal text-text">
            <input type="checkbox" className="w-[15px] h-[15px] accent-accent rounded-none" /> Compartir con todo el
            grupo
          </span>
        </label>
      </Section>

      <Section
        title="Subir archivo"
        note='components/ui/FileDropzone.tsx — drag-and-drop real, 3 estados (vacío/cargado/error). Reemplaza al botón simple donde el archivo ES el campo (Logo). Donde además hay alternativa de cámara en vivo (RIF, cédula) se mantiene el par de íconos — una zona de drop no reemplaza "sacar una foto ahora".'
      >
        <div className="grid w-full gap-3 sm:grid-cols-2 max-w-2xl">
          <StyleguideDropzoneDemo />
        </div>
      </Section>

      <Section title="Cards" note='components/ui/Card.tsx — corner="accent"|"accent2" agrega las 2 marcas de esquina (usado en StatCard), en el color de la métrica.'>
        <div className="grid w-full gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <StatCard kicker="Equipos en línea" value="2 / 2" meta="visto en los últimos 30s" tone="accent" />
          <StatCard kicker="Marcaciones hoy" value="1.284" meta="+4% vs ayer" tone="accent2" />
          <Card corner="accent2">
            <CardKicker tone="accent2">Kicker</CardKicker>
            <CardTitle>Card con esquinas</CardTitle>
            <CardBody>Cuerpo de ejemplo, texto secundario.</CardBody>
            <CardMeta>
              <StatusDot online /> con StatusDot
            </CardMeta>
          </Card>
        </div>
      </Section>

      <Section
        title="Listas: tabla (desktop) + tarjetas (mobile)"
        note="Todo listado sigue el mismo patrón: <Table> envuelto en `hidden md:block`, más un <MobileList> de <MobileRow> envuelto en `md:hidden` — nunca solo la tabla."
      >
        <div className="hidden md:block">
          <Table>
            <thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Estado</Th>
                <Th>Empleos</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td className="font-medium">Farmalido C.A.</Td>
                <Td>
                  <Tag variant="accent">Activa</Tag>
                </Td>
                <Td>12</Td>
                <Td>
                  <Btn variant="ghost">Detalle →</Btn>
                </Td>
              </Tr>
            </tbody>
          </Table>
        </div>
        <MobileList>
          <MobileRow
            title="Farmalido C.A."
            tags={<Tag variant="accent">Activa</Tag>}
            fields={[{ label: "Empleos", value: 12 }]}
            actions={<Btn variant="ghost">Detalle →</Btn>}
          />
        </MobileList>
        <p className="m-0 text-xs text-text/60">
          (La fila de arriba se ve en tabla en desktop y en tarjeta en mobile — angostá la ventana
          para verlo cambiar.)
        </p>
      </Section>

      <Section
        title="Diálogos"
        note="components/ui/Dialog.tsx — pantalla completa en mobile (header y footer fijos, cuerpo con scroll), modal centrado en sm+. `footer` es el lugar estándar del botón de submit — nunca adentro del body que scrollea."
      >
        <StyleguideDialogDemo />
      </Section>

      <Section
        title="Opcionales colapsados"
        note="components/ui/Collapsible.tsx — <details> nativo, sin JS. Estándar para grupos de campos opcionales dentro de un diálogo (Representante legal, Umbrales de asistencia)."
      >
        <div className="max-w-md">
          <Collapsible title="Umbrales de asistencia">
            <Field label="Tolerancia tardanza" hint="(min)">
              <input className={FIELD_INPUT} type="number" />
            </Field>
          </Collapsible>
        </div>
      </Section>

      <Section
        title="Filtros"
        note="components/ui/FiltersDialog.tsx — ícono de embudo con badge (cuántos filtros hay aplicados) que abre un diálogo con los campos. Reemplaza una fila de <select> sueltos en la barra superior (Empleados, Asistencia)."
      >
        <StyleguideFiltersDemo />
      </Section>

      <Section title="Estado vacío" note="components/ui/EmptyState.tsx">
        <EmptyState
          title="Sin resultados"
          description="Texto descriptivo de qué hacer a continuación."
          action={<Btn variant="primary">Acción principal</Btn>}
        />
      </Section>
    </div>
  );
}
