import Link from "next/link";
import { cx } from "@/lib/cx";

const TABS = [
  { key: "datos", label: "Datos y sedes", href: (id: number) => `/admin/empresas/${id}` },
  { key: "empleados", label: "Empleados", href: (id: number) => `/admin/empresas/${id}/empleados` },
  { key: "asistencia", label: "Asistencia", href: (id: number) => `/admin/empresas/${id}/asistencia` },
] as const;

/**
 * Encabezado + pestañas de una empresa (docs/10 §6): Empleados y Asistencia
 * viven dentro de la empresa, no como secciones sueltas.
 */
export function CompanyTabs({
  companyId,
  companyName,
  active,
  badges,
}: {
  companyId: number;
  companyName: string;
  active: (typeof TABS)[number]["key"];
  badges?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Link href="/admin/empresas" className="text-xs text-accent no-underline hover:underline">
          ← Empresas
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h2 className="font-heading text-2xl font-semibold tracking-tight m-0">{companyName}</h2>
          {badges}
        </div>
      </div>
      <nav className="flex gap-1 border-b border-divider" aria-label="Secciones de la empresa">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href(companyId)}
            aria-current={t.key === active ? "page" : undefined}
            className={cx(
              "px-3 py-2 text-sm no-underline -mb-px border-b-2",
              t.key === active ? "border-text font-semibold text-text" : "border-transparent text-text/70 hover:text-text"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
