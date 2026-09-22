/**
 * El lenguaje de íconos del panel — hasta ahora, glifos sueltos repetidos a
 * mano en cada botón. Un solo lugar para verlos todos y para cambiar uno sin
 * tener que encontrar cada copia. Set "Sistema de diseño" (2026-09-22):
 * caracteres monocromos que heredan currentColor, no emoji a color — cámara
 * e imagen quedan como emoji por ahora porque la maqueta no da un glifo
 * monocromo para esos dos casos puntuales.
 */
export const Icon = {
  add: "+",
  camera: "📷",
  upload: "↥",
  sync: "⟳",
  trash: "⌫",
  edit: "✎",
  key: "⚿",
  power: "⏻",
  check: "✓",
  close: "✕",
  rank: "★",
  view: "◎",
  unlink: "⏚",
  send: "⇉",
  capture: "⇣",
} as const;

/**
 * La maqueta usa "⛃" para "Filtrar" — en Chromium (esta fuente, esta
 * plataforma) ese glifo renderiza como un dado/cubo negro sin ninguna
 * relación visual con "filtrar". Un ícono que no comunica su acción es peor
 * que uno que no es 100% literal a la maqueta, así que el embudo dibujado a
 * mano se queda: no depende de fuente ni de plataforma.
 */
export function FunnelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-[18px] h-[18px] flex-none shrink-0"
      aria-hidden
    >
      <path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
