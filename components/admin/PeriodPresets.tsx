import Link from "next/link";
import { cx } from "@/lib/cx";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { periodPresets } from "@/lib/attendance/reports";

/**
 * "Período: Quincena en curso · Quincena anterior · Mes en curso · Mes anterior"
 * (periodPresets): cambian el rango Desde/Hasta de la URL y conservan los demás
 * filtros de la vista (`keep`: vista, sede, estado, tipo…). El activo va en negrita.
 */
export function PeriodPresets({
  basePath,
  from,
  to,
  keep = {},
}: {
  basePath: string;
  from?: string;
  to?: string;
  keep?: Record<string, string | null | undefined>;
}) {
  const today = dateKeyInTz(new Date(), DEFAULT_TZ);
  const href = (f: string, t: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    q.set("from", f);
    q.set("to", t);
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-text/70">Período:</span>
      {periodPresets(today).map((p) => {
        const on = p.from === from && p.to === to;
        return (
          <Link
            key={p.label}
            href={href(p.from, p.to)}
            aria-current={on ? "true" : undefined}
            className={cx("no-underline hover:underline", on ? "font-semibold text-text" : "text-accent")}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
