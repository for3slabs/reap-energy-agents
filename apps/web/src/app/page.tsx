import Link from "next/link";
import { StripChart } from "@/components/state";

// Deterministic sample of press-03 drifting over its band, for the hero instrument (no fetch on the landing).
const DRIFT = [1460, 1480, 1475, 1500, 1530, 1610, 1720, 1850, 1930, 1990, 2040, 2030, 2060, 2049, 2071, 2055];

const CIRCUIT = [
  { n: "01", t: "Medir", d: "Cada máquina reporta watts, amperes y factor de potencia. El agente compara contra su línea base." },
  { n: "02", t: "Diagnosticar", d: "Una tabla de reglas, no un modelo, decide: funciona, no funciona, defecto o falla, y qué pieza lo arregla." },
  { n: "03", t: "Comprar con Reap", d: "El agente busca la pieza en el catálogo de Reap, la cotiza con envío e impuestos y abre el checkout." },
  { n: "04", t: "Verificar on-chain", d: "La orden se cierra solo si el consumo vuelve a la banda de tolerancia. Si no, queda fallida y pública." },
];

const RAILS = [
  {
    who: "Reap Agentic Payments",
    does: [
      "Guarda la tarjeta en su página: nunca llega al agente",
      "Catálogo de comercios, cotización en vivo y checkout",
      "La persona aprueba cada cargo en la página de Reap",
    ],
  },
  {
    who: "El agente",
    does: ["Lee la telemetría y diagnostica con reglas", "Elige la pieza dentro del tope por orden", "Usa una llave de idempotencia por compra: un reintento nunca cobra dos veces"],
  },
  {
    who: "MaintenanceVault · Ink Sepolia",
    does: ["Presupuesto y tope por máquina", "Reserva antes de pagar; el cargo final no puede excederla", "Pagado y reparado son dos eventos distintos"],
  },
];

export default function Home() {
  return (
    <main>
      <section className="bg-safety text-on-safety">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-6 md:grid-cols-[1.1fr_1fr] md:gap-14 md:px-8 md:pb-24">
          <header className="col-span-full flex items-center justify-between">
            <span className="text-sm font-bold tracking-[0.14em]" style={{ fontStretch: "80%" }}>
              REAP · ENERGY AGENTS
            </span>
            <Link href="/consola" className="rounded-sm border border-on-safety/30 px-3 py-1.5 text-sm font-semibold hover:bg-on-safety hover:text-safety">
              Consola
            </Link>
          </header>

          <div className="flex flex-col justify-end">
            <p className="label !text-on-safety/70">Mantenimiento eléctrico con agentes</p>
            <h1 className="mt-4 text-[2.6rem] font-extrabold leading-[1.02] tracking-tight md:text-[3.6rem]" style={{ fontStretch: "88%" }}>
              Una máquina defectuosa no se apaga. Se come la luz.
            </h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-on-safety/85">
              Un agente lee el consumo de cada máquina, encuentra la que trabaja forzada, compra el repuesto con Reap y cierra la orden solo cuando el
              consumo vuelve a la normalidad. El presupuesto y la prueba viven en un contrato.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/consola" className="rounded-sm bg-on-safety px-5 py-3 font-semibold text-safety transition-transform duration-200 hover:-translate-y-0.5">
                Abrir la consola
              </Link>
              <a href="#circuito" className="rounded-sm px-5 py-3 font-semibold underline decoration-2 underline-offset-4">
                Cómo funciona
              </a>
            </div>
          </div>

          {/* The instrument: a panel meter reading the press as it drifts over its band */}
          <figure className="self-end rounded-md border-2 border-on-safety bg-panel p-5 text-ink shadow-[6px_6px_0_var(--on-safety)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="label">Prensa hidráulica 03 · Línea B</p>
                <p className="readout mt-2 text-5xl font-bold md:text-6xl">2,049<span className="ml-1 text-2xl text-muted">W</span></p>
              </div>
              <span className="rounded-sm bg-warn-tint px-2 py-1 text-xs font-bold text-warn">DEFECTO</span>
            </div>
            <StripChart points={DRIFT} baseline={1500} tolerance={0.1} height={110} className="mt-4" />
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-sm">
              <div>
                <dt className="label">Sobre base</dt>
                <dd className="readout mt-1 text-warn">+37%</dd>
              </div>
              <div>
                <dt className="label">F. potencia</dt>
                <dd className="readout mt-1">0.68</dd>
              </div>
              <div>
                <dt className="label">Pieza</dt>
                <dd className="mt-1 font-semibold">Capacitor 30 µF</dd>
              </div>
            </dl>
            <figcaption className="mt-3 text-xs text-muted">Banda verde: tolerancia de la máquina. Lectura de ejemplo.</figcaption>
          </figure>
        </div>
      </section>

      <section id="circuito" className="mx-auto max-w-6xl px-5 py-20 md:px-8">
        <h2 className="max-w-[24ch] text-3xl font-bold leading-tight md:text-4xl" style={{ fontStretch: "90%" }}>
          Un circuito cerrado, de la lectura al repuesto instalado
        </h2>
        <ol className="relative mt-12 grid gap-10 md:grid-cols-4 md:gap-6">
          <span className="absolute left-0 right-0 top-[1.05rem] hidden h-0.5 bg-ink md:block" aria-hidden />
          {CIRCUIT.map((s) => (
            <li key={s.n} className="relative">
              <span className="readout relative z-10 inline-flex h-9 items-center bg-surface pr-3 text-sm font-bold">{s.n}</span>
              <h3 className="mt-3 text-xl font-bold">{s.t}</h3>
              <p className="mt-2 leading-relaxed text-ink-2">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-[1fr_1.2fr] md:px-8">
          <div>
            <h2 className="text-3xl font-bold leading-tight md:text-4xl" style={{ fontStretch: "90%" }}>
              Pagado no es reparado
            </h2>
            <p className="mt-5 max-w-[48ch] text-lg leading-relaxed text-ink-2">
              Un checkout completado prueba que el dinero salió. No prueba que la prensa dejó de desperdiciar energía. Por eso la orden de trabajo tiene
              dos hechos separados, y el segundo lo firma la propia máquina con su consumo.
            </p>
          </div>
          <ol className="readout grid gap-px self-center overflow-hidden rounded-md border border-line bg-line text-sm">
            {[
              ["Abierta", "presupuesto reservado antes de comprar", "text-ink"],
              ["Comprada", "Reap confirma el pedido y el monto final", "text-ink"],
              ["Verificada", "consumo promedio ≤ base + tolerancia", "text-ok"],
              ["Fallida", "se pagó y la máquina sigue fuera de banda", "text-fault"],
            ].map(([s, d, c]) => (
              <li key={s} className="grid grid-cols-[8.5rem_1fr] items-center gap-4 bg-panel px-4 py-3.5">
                <span className={`font-bold ${c}`}>{s}</span>
                <span className="font-sans text-ink-2">{d}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 md:px-8">
        <h2 className="text-3xl font-bold md:text-4xl" style={{ fontStretch: "90%" }}>
          Quién hace qué
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          {RAILS.map((r, i) => (
            <div key={r.who} className={i === 1 ? "md:border-x md:border-line md:px-8" : ""}>
              <h3 className="label !text-ink">{r.who}</h3>
              <ul className="mt-4 space-y-3">
                {r.does.map((d) => (
                  <li key={d} className="leading-relaxed text-ink-2">
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col items-start justify-between gap-6 rounded-md bg-ink px-6 py-8 text-panel md:flex-row md:items-center md:px-10">
          <p className="max-w-[46ch] text-xl font-semibold leading-snug">Cuatro máquinas, una prensa con el capacitor degradado y un repuesto de $37.25 esperando.</p>
          <Link href="/consola" className="rounded-sm bg-safety px-5 py-3 font-semibold text-on-safety">
            Ir a la consola
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted md:flex-row md:justify-between md:px-8">
          <p>Telemetría simulada en esta demo. Sandbox de Reap: ningún cargo es real.</p>
          <p>
            Reap × AI Builders Mexico ·{" "}
            <a className="underline underline-offset-2" href="https://github.com/for3slabs/reap-energy-agents">
              código
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}
