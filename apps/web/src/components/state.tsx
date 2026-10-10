import type { MachineState } from "@/lib/api";

export const STATE_META: Record<MachineState, { label: string; fg: string; bg: string; dot: string }> = {
  FUNCIONA: { label: "Funciona", fg: "text-ok", bg: "bg-ok-tint", dot: "bg-ok" },
  DEFECTO: { label: "Defecto", fg: "text-warn", bg: "bg-warn-tint", dot: "bg-warn" },
  FALLA: { label: "Falla", fg: "text-fault", bg: "bg-fault-tint", dot: "bg-fault" },
  NO_FUNCIONA: { label: "No funciona", fg: "text-off", bg: "bg-off-tint", dot: "bg-off" },
};

export function StateBadge({ state, live = false }: { state: MachineState; live?: boolean }) {
  const m = STATE_META[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold ${m.fg} ${m.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${live && state !== "FUNCIONA" ? "live-dot" : ""}`} aria-hidden />
      {m.label}
    </span>
  );
}

/** Strip chart: draw vs baseline with the tolerance band shaded, like a chart recorder. */
export function StripChart({
  points,
  baseline,
  tolerance,
  height = 120,
  className = "",
}: {
  points: number[];
  baseline: number;
  tolerance: number;
  height?: number;
  className?: string;
}) {
  const w = 480;
  const ceiling = baseline * (1 + tolerance);
  // Zoom to the band: a meter that starts at 0 W squashes the deviation the chief needs to see.
  const max = Math.max(...points, ceiling) * 1.08;
  const min = Math.min(...points, baseline) * 0.85;
  const y = (v: number) => height - ((v - min) / (max - min)) * height;
  const x = (i: number) => (i / Math.max(points.length - 1, 1)) * w;
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const over = points.some((v) => v > ceiling);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} className={`block w-full ${className}`} role="img" aria-label={`Consumo frente a la línea base de ${Math.round(baseline)} W`}>
      <rect x="0" y={y(ceiling)} width={w} height={y(baseline) - y(ceiling)} fill="var(--ok-tint)" />
      <line x1="0" x2={w} y1={y(baseline)} y2={y(baseline)} stroke="var(--ok)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={w} y1={y(ceiling)} y2={y(ceiling)} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke={over ? "var(--warn)" : "var(--ink)"} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
