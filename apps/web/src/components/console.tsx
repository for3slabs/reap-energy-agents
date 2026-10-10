"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount, useConnect, useDisconnect, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import {
  api,
  ApiError,
  type Checkout,
  type Enrollment,
  type Machine,
  type Policy,
  type Product,
  type Quote,
  type Reading,
  usd,
  type Verification,
  watts,
} from "@/lib/api";
import { CHAIN, explorerTx, machineKey, refHash, VAULT_ADDRESS, VAULT_ENABLED, vaultAbi } from "@/lib/vault";
import { STATE_META, StateBadge, StripChart } from "./state";

// ── persisted work orders (per-viewer demo state; the contract is the shared ledger) ──────────────
interface Order {
  products?: Product[];
  query?: string;
  variant?: Product;
  quote?: Quote;
  policy?: Policy;
  quoteKey?: string;
  chainOrderId?: string;
  reserveTx?: string;
  checkoutKey?: string;
  checkout?: Checkout;
  purchaseTx?: string;
  installed?: boolean;
  verification?: Verification;
  evidenceTx?: string;
}
type Orders = Record<string, Order>;

const LS = { orders: "rea:orders", enrollment: "rea:enrollment", email: "rea:email", pending: "rea:pending" };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the session still works, it just won't survive a reload */
  }
}

const cents = (amount: number) => Math.round(amount * 100);
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${e.code && !e.code.startsWith("HTTP") ? ` (${e.code})` : ""}` : e instanceof Error ? e.message.split("\n")[0] : "Error inesperado");

// ── the console ──────────────────────────────────────────────────────────────────────────────────
export function Console() {
  // Client-only component (see client-console.tsx): initial state can read the browser directly.
  const [selected, setSelected] = useState<string>(() => new URLSearchParams(window.location.search).get("machine") ?? "press-03");
  const [orders, setOrders] = useState<Orders>(() => load<Orders>(LS.orders, {}));

  const repaired = useMemo(() => Object.entries(orders).filter(([, o]) => o.installed).map(([id]) => id), [orders]);

  const plant = useQuery({
    queryKey: ["machines", repaired.join(",")],
    queryFn: () => api.machines(repaired),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
  const machines: Machine[] | null = plant.data?.machines ?? null;
  const apiDown = plant.error ? errText(plant.error) : null;
  const { refetch } = plant;
  const refresh = useCallback(() => void refetch(), [refetch]);

  const patch = useCallback((id: string, p: Partial<Order> | null) => {
    setOrders((prev) => {
      const next = { ...prev };
      if (p === null) delete next[id];
      else next[id] = { ...prev[id], ...p };
      save(LS.orders, next);
      return next;
    });
  }, []);

  const machine = machines?.find((m) => m.id === selected) ?? null;
  const attention = machines?.filter((m) => m.diagnosis.state !== "FUNCIONA").length ?? 0;
  const waste = machines?.reduce((s, m) => s + m.diagnosis.wasted_usd_month, 0) ?? 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
          <Link href="/" className="text-sm font-bold tracking-[0.14em]" style={{ fontStretch: "80%" }}>
            REAP · ENERGY AGENTS
          </Link>
          <span className="flex items-center gap-2 text-sm text-ink-2">
            <span className="live-dot h-2 w-2 rounded-full bg-ok" aria-hidden />
            Planta demo · telemetría simulada
          </span>
          {machines && (
            <span className="text-sm text-ink-2">
              <strong className="text-ink">{attention}</strong> de {machines.length} requieren atención ·{" "}
              <span className="readout text-warn">{usd(waste)}</span>/mes desperdiciados
            </span>
          )}
          <div className="ml-auto">
            <WalletBar />
          </div>
        </div>
      </header>

      {apiDown && !machines && (
        <div className="flex flex-wrap items-center gap-3 border-b border-fault/30 bg-fault-tint px-4 py-3 text-sm text-fault md:px-6" role="alert">
          <span>{apiDown}.</span>
          <button className="rounded-sm border border-fault/40 px-2 py-1 font-semibold" onClick={refresh}>
            Reintentar
          </button>
        </div>
      )}
      {!machines && !apiDown && (
        <p className="mx-auto max-w-7xl px-4 pt-5 text-sm text-ink-2 md:px-6" role="status">
          <span className="live-dot mr-2 inline-block h-2 w-2 rounded-full bg-ink align-middle" aria-hidden />
          Conectando con el agente. La primera visita despierta la API y puede tardar unos segundos.
        </p>
      )}

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-6 lg:grid-cols-[22rem_1fr]">
        <nav aria-label="Máquinas" className="grid content-start gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {!machines && !apiDown && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[5.5rem] rounded-md" />)}
          {machines?.map((m) => (
            <MachineRow key={m.id} m={m} active={m.id === selected} order={orders[m.id]} onClick={() => setSelected(m.id)} />
          ))}
        </nav>

        <section className="min-w-0">
          {machine ? (
            <MachineDetail key={machine.id} m={machine} order={orders[machine.id] ?? {}} patch={(p) => patch(machine.id, p)} refresh={refresh} />
          ) : (
            !apiDown && <div className="skeleton h-96 rounded-md" />
          )}
        </section>
      </main>
    </div>
  );
}

function MachineRow({ m, active, order, onClick }: { m: Machine; active: boolean; order?: Order; onClick: () => void }) {
  const meta = STATE_META[m.diagnosis.state];
  const closed = order?.verification?.verified;
  return (
    <button
      onClick={onClick}
      aria-current={active}
      className={`grid grid-cols-[1fr_auto] items-end gap-x-3 rounded-md border bg-panel px-4 py-3 text-left transition-colors duration-150 ${
        active ? "border-ink" : "border-line hover:border-line-strong"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{m.name}</span>
        <span className="block truncate text-xs text-muted">{m.area} · {m.kind}</span>
      </span>
      <StateBadge state={m.diagnosis.state} live />
      <span className="readout mt-2 text-2xl font-bold">{watts(m.reading.watts)}</span>
      <span className={`readout text-sm ${m.diagnosis.excess_pct > m.tolerance * 100 ? meta.fg : "text-muted"}`}>
        {closed ? "verificada" : `${m.diagnosis.excess_pct > 0 ? "+" : ""}${m.diagnosis.excess_pct}%`}
      </span>
    </button>
  );
}

// ── one machine: instrument + diagnosis + work order ─────────────────────────────────────────────
function MachineDetail({ m, order, patch, refresh }: { m: Machine; order: Order; patch: (p: Partial<Order> | null) => void; refresh: () => void }) {
  const [history, setHistory] = useState<Reading[] | null>(null);
  const d = m.diagnosis;

  useEffect(() => {
    let live = true;
    api
      .history(m.id, !!order.installed)
      .then((h) => live && setHistory(h.points))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [m.id, order.installed]);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <article className="rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="label">{m.area} · {m.kind}</p>
            <h1 className="mt-1 text-2xl font-bold">{m.name}</h1>
          </div>
          <StateBadge state={d.state} live />
        </div>

        <div className="grid gap-6 p-5">
          <dl className="grid content-start gap-4">
            <div>
              <dt className="label">Consumo ahora</dt>
              <dd className="readout text-5xl font-bold">{watts(m.reading.watts)}</dd>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat k="Línea base" v={watts(m.baseline_watts)} />
              <Stat k="Tolerancia" v={`+${Math.round(m.tolerance * 100)}%`} />
              <Stat k="Corriente" v={`${m.reading.amps} A`} />
              <Stat k="F. potencia" v={m.reading.power_factor.toFixed(2)} warn={m.reading.power_factor < 0.75} />
            </div>
          </dl>
          <div className="min-w-0">
            <p className="label">Últimas 4 horas · consumo en watts</p>
            {history ? (
              history.length ? (
                <StripChart points={history.map((p) => p.watts)} baseline={m.baseline_watts} tolerance={m.tolerance} height={170} className="mt-2" />
              ) : (
                <p className="mt-6 text-sm text-muted">Sin historial disponible.</p>
              )
            ) : (
              <div className="skeleton mt-2 h-[170px] rounded" />
            )}
            <p className="mt-2 text-xs text-muted">Línea punteada: base. Banda verde: tolerancia.</p>
          </div>
        </div>

        <div className="border-t border-line p-5">
          <h2 className="label !text-ink">Diagnóstico del agente</h2>
          {d.state === "FUNCIONA" ? (
            <p className="mt-2 text-ink-2">Dentro de su banda. No hay nada que comprar.</p>
          ) : (
            <>
              <p className="mt-2 text-lg font-semibold">{d.cause}</p>
              {d.wasted_usd_month > 0 && (
                <p className="mt-1 text-ink-2">
                  Desperdicia <span className="readout text-warn">{d.wasted_kwh_day} kWh/día</span>, unos <span className="readout text-warn">{usd(d.wasted_usd_month)}</span> al mes.
                </p>
              )}
            </>
          )}
          <ul className="mt-4 space-y-1.5 text-sm text-ink-2">
            {d.evidence.map((e) => (
              <li key={e}>
                · {e}
              </li>
            ))}
          </ul>
        </div>
      </article>

      <WorkOrder m={m} order={order} patch={patch} refresh={refresh} />
    </div>
  );
}

function Stat({ k, v, warn = false }: { k: string; v: string; warn?: boolean }) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className={`readout mt-0.5 text-lg ${warn ? "text-warn" : ""}`}>{v}</dd>
    </div>
  );
}

// ── the work order: diagnosis → Reap → contract → repair → proof ─────────────────────────────────
function WorkOrder({ m, order, patch, refresh }: { m: Machine; order: Order; patch: (p: Partial<Order> | null) => void; refresh: () => void }) {
  const d = m.diagnosis;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(() => load<Enrollment | null>(LS.enrollment, null));
  const [email, setEmail] = useState(() => load<string>(LS.email, "ops@plantademo.mx"));
  const [simulate, setSimulate] = useState(true);
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const { data: remaining } = useReadContract({
    address: VAULT_ENABLED ? (VAULT_ADDRESS as `0x${string}`) : undefined,
    abi: vaultAbi,
    functionName: "remainingCents",
    args: [machineKey(m.id)],
    chainId: CHAIN.id,
    query: { enabled: VAULT_ENABLED },
  });

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const persistEnrollment = (e: Enrollment) => {
    setEnrollment(e);
    save(LS.enrollment, e);
  };

  // Returning from a Reap hosted page: read the real status instead of trusting the redirect.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const step = qs.get("step");
    if (!step || qs.get("machine") !== m.id) return;
    window.history.replaceState(null, "", "/consola");
    const t = setTimeout(() => {
      const enrollmentId = load<Enrollment | null>(LS.enrollment, null)?.id;
      if (step === "enrolled" && enrollmentId) run("Leyendo la tarjeta", async () => persistEnrollment((await api.enrollment(enrollmentId)).enrollment));
      if (step === "paid" && order.checkout?.id) run("Leyendo el pago", async () => patch({ checkout: (await api.getCheckout(order.checkout!.id)).checkout }));
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const ensureChain = async () => {
    if (!address) throw new Error("Conecta tu wallet para firmar en el contrato");
    if (chainId !== CHAIN.id) await switchChainAsync({ chainId: CHAIN.id });
  };

  const tx = async (fn: () => Promise<`0x${string}`>) => {
    const hash = await fn();
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("La transacción revirtió");
    return { hash, receipt };
  };

  const returnUrl = (step: string) => `${window.location.origin}/consola?machine=${m.id}&step=${step}`;

  // ── steps ──
  const searchParts = () =>
    run("Buscando en el catálogo de Reap", async () => {
      const r = await api.parts(m.id);
      patch({ products: r.products, query: r.query, variant: undefined, quote: undefined, policy: undefined });
    });

  const quote = (p: Product) =>
    run("Cotizando con el comercio", async () => {
      const key = crypto.randomUUID(); // one key per quote attempt
      const spent = VAULT_ENABLED && remaining !== undefined ? m.budget_cents - Number(remaining) : 0;
      const r = await api.quote(m.id, p.previewVariant.id, spent, key);
      patch({ variant: p, quote: r.quote, policy: r.policy, quoteKey: key, chainOrderId: undefined, reserveTx: undefined, checkout: undefined, checkoutKey: undefined });
    });

  const reserve = () =>
    run("Reservando presupuesto on-chain", async () => {
      await ensureChain();
      const q = order.quote!;
      const { hash, receipt } = await tx(() =>
        writeContractAsync({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: vaultAbi,
          functionName: "openWorkOrder",
          args: [machineKey(m.id), BigInt(cents(q.amountBreakdown.finalAmount.amount)), refHash(JSON.stringify(d)), refHash(q.id)],
          chainId: CHAIN.id,
        }),
      );
      const [ev] = parseEventLogs({ abi: vaultAbi, eventName: "WorkOrderOpened", logs: receipt.logs });
      patch({ chainOrderId: ev ? ev.args.orderId.toString() : undefined, reserveTx: hash });
    });

  const enroll = () =>
    run("Abriendo la página de Reap", async () => {
      if (window.location.protocol !== "https:") throw new Error("Reap exige una URL de retorno HTTPS: registra la tarjeta desde la versión desplegada.");
      save(LS.email, email);
      const r = await api.enroll(address ?? "plant-demo-operator", email, returnUrl("enrolled"), crypto.randomUUID());
      persistEnrollment(r.enrollment);
      if (r.enrollment.nextAction?.url) window.location.href = r.enrollment.nextAction.url;
    });

  const refreshEnrollment = () =>
    run("Leyendo la tarjeta", async () => {
      if (enrollment) persistEnrollment((await api.enrollment(enrollment.id)).enrollment);
    });

  const pay = () =>
    run("Abriendo el checkout de Reap", async () => {
      if (new Date(order.quote!.expiresAt).getTime() < Date.now()) throw new Error("La cotización venció. Cotiza de nuevo para tener el precio vigente.");
      const key = order.checkoutKey ?? crypto.randomUUID(); // reused on retry: never two charges
      patch({ checkoutKey: key });
      const r = await api.checkout(order.quote!.id, enrollment!.id, returnUrl("paid"), key, simulate);
      patch({ checkout: r.checkout, checkoutKey: key });
      if (r.checkout.nextAction?.url) window.location.href = r.checkout.nextAction.url;
    });

  const readCheckout = () =>
    run("Leyendo el pago", async () => {
      patch({ checkout: (await api.getCheckout(order.checkout!.id)).checkout });
    });

  const recordPurchase = () =>
    run("Registrando la compra on-chain", async () => {
      await ensureChain();
      const co = order.checkout!;
      const final = co.finalAmount ?? co.amount!;
      const { hash } = await tx(() =>
        writeContractAsync({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: vaultAbi,
          functionName: "recordPurchase",
          args: [BigInt(order.chainOrderId!), refHash(co.orderId ?? co.id), BigInt(cents(final.amount))],
          chainId: CHAIN.id,
        }),
      );
      patch({ purchaseTx: hash });
    });

  const install = () => {
    patch({ installed: true });
    setTimeout(refresh, 50);
  };

  const verify = () =>
    run("Midiendo la ventana posterior a la reparación", async () => {
      const r = await api.verify(m.id, order.checkout?.orderId ?? null);
      patch({ verification: r.verification });
    });

  const anchor = () =>
    run("Escribiendo la prueba on-chain", async () => {
      await ensureChain();
      const v = order.verification!;
      const { hash } = await tx(() =>
        writeContractAsync({
          address: VAULT_ADDRESS as `0x${string}`,
          abi: vaultAbi,
          functionName: "recordRepairEvidence",
          args: [BigInt(order.chainOrderId!), BigInt(Math.round(v.post_repair_watts)), v.evidence_hash],
          chainId: CHAIN.id,
        }),
      );
      patch({ evidenceTx: hash });
    });

  // ── derived stage ──
  const paid = order.checkout?.status === "COMPLETED";
  const reserved = !VAULT_ENABLED || !!order.chainOrderId;
  const purchaseOnChain = !VAULT_ENABLED || !!order.purchaseTx;
  const nothingToDo = d.state === "FUNCIONA" && !order.installed;

  if (nothingToDo) {
    return (
      <aside className="self-start rounded-md border border-line bg-panel p-5">
        <h2 className="label !text-ink">Orden de trabajo</h2>
        <p className="mt-3 text-ink-2">Sin orden abierta. El agente solo abre una cuando el consumo sale de la banda.</p>
      </aside>
    );
  }

  return (
    <aside className="grid content-start gap-4 self-start rounded-md border border-ink bg-panel p-5" aria-live="polite">
      <div className="flex items-center justify-between">
        <h2 className="label !text-ink">Orden de trabajo · {m.name}</h2>
        {Object.keys(order).length > 0 && (
          <button className="text-xs text-muted underline underline-offset-2" onClick={() => patch(null)}>
            reiniciar
          </button>
        )}
      </div>

      <Step n={1} title="Diagnóstico" done>
        <p className="text-sm text-ink-2">
          {d.part_label ? (
            <>
              Pieza: <strong className="text-ink">{d.part_label}</strong>, tope de búsqueda {usd(d.max_part_usd ?? 0)}
            </>
          ) : (
            "Requiere inspección manual: no hay pieza asociada."
          )}
        </p>
      </Step>

      <Step n={2} title="Repuesto en Reap" done={!!order.quote} active={!!d.part_query && !order.quote}>
        {!order.products ? (
          <Action onClick={searchParts} disabled={!d.part_query || !!busy}>
            Buscar en el catálogo
          </Action>
        ) : order.products.length === 0 ? (
          <p className="text-sm text-ink-2">Reap no encontró productos disponibles para «{order.query}».</p>
        ) : (
          <ul className="grid gap-2">
            {order.products.slice(0, 4).map((p) => {
              const chosen = order.variant?.id === p.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => quote(p)}
                    disabled={!!busy}
                    className={`grid w-full grid-cols-[1fr_auto] gap-x-3 rounded border px-3 py-2 text-left text-sm transition-colors duration-150 disabled:opacity-60 ${
                      chosen ? "border-ink bg-panel-2" : "border-line hover:border-line-strong"
                    }`}
                  >
                    <span className="line-clamp-2">{p.name}</span>
                    <span className="readout font-semibold">{usd(p.previewVariant.price.amount)}</span>
                    <span className="truncate text-xs text-muted">{p.merchant.name.split("|")[0].trim()}</span>
                    <span className="text-xs text-muted">{chosen ? "cotizado" : "cotizar"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Step>

      {order.quote && order.policy && (
        <Step n={3} title="Cotización y política" done={order.policy.decision === "ALLOW" && reserved} active={order.policy.decision === "ALLOW" && !reserved}>
          <QuoteView q={order.quote} policy={order.policy} />
          {order.policy.decision === "ALLOW" &&
            (VAULT_ENABLED ? (
              order.chainOrderId ? (
                <TxLink label={`Reservado on-chain · orden #${order.chainOrderId}`} hash={order.reserveTx} />
              ) : (
                <Action onClick={reserve} disabled={!!busy}>
                  Reservar presupuesto on-chain
                </Action>
              )
            ) : (
              <p className="text-xs text-muted">Contrato no desplegado en esta demo: la misma regla se aplicó fuera de cadena.</p>
            ))}
        </Step>
      )}

      {order.policy?.decision === "ALLOW" && reserved && (
        <Step n={4} title="Pago con Reap" done={paid && purchaseOnChain} active={!paid}>
          {!enrollment || enrollment.status !== "ACTIVE" ? (
            <div className="grid gap-2">
              <p className="text-sm text-ink-2">
                {enrollment?.status === "REQUIRES_ACTION" ? "La tarjeta espera completar el paso en la página de Reap." : "Registra la tarjeta una vez. Se captura en la página de Reap; nunca pasa por el agente."}
              </p>
              <label className="grid gap-1 text-sm">
                <span className="label">Correo del responsable</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="rounded border border-line bg-surface px-3 py-2" />
              </label>
              <div className="flex flex-wrap gap-2">
                <Action onClick={enroll} disabled={!!busy || !email}>
                  Registrar tarjeta en Reap
                </Action>
                {enrollment && (
                  <Action onClick={refreshEnrollment} disabled={!!busy} quiet>
                    Ya la registré
                  </Action>
                )}
              </div>
            </div>
          ) : !order.checkout ? (
            <div className="grid gap-2">
              <p className="text-sm text-ink-2">
                Tarjeta {enrollment.paymentMethod?.network} ···· {enrollment.paymentMethod?.last4} lista. El cargo se aprueba en Reap.
              </p>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
                Simular la aprobación (solo sandbox)
              </label>
              <Action onClick={pay} disabled={!!busy}>
                Pagar {usd(order.quote!.amountBreakdown.finalAmount.amount)} con Reap
              </Action>
            </div>
          ) : !paid ? (
            <div className="grid gap-2">
              <p className="text-sm text-ink-2">Checkout {order.checkout.status}. Aprueba el cargo en la página de Reap y vuelve.</p>
              <div className="flex flex-wrap gap-2">
                {order.checkout.nextAction?.url && (
                  <a className="rounded-sm bg-ink px-3 py-2 text-sm font-semibold text-panel" href={order.checkout.nextAction.url}>
                    Ir a aprobar
                  </a>
                )}
                <Action onClick={readCheckout} disabled={!!busy} quiet>
                  Revisar estado
                </Action>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm">
                Pedido <span className="readout">{order.checkout.orderId ?? order.checkout.id}</span> · cobrado{" "}
                <strong className="readout">{usd((order.checkout.finalAmount ?? order.checkout.amount)!.amount)}</strong>
              </p>
              {VAULT_ENABLED &&
                (order.purchaseTx ? (
                  <TxLink label="Compra registrada on-chain" hash={order.purchaseTx} />
                ) : (
                  <Action onClick={recordPurchase} disabled={!!busy}>
                    Registrar la compra on-chain
                  </Action>
                ))}
            </div>
          )}
        </Step>
      )}

      {paid && purchaseOnChain && (
        <Step n={5} title="Reparación" done={!!order.installed} active={!order.installed}>
          {order.installed ? (
            <p className="text-sm text-ink-2">Repuesto instalado. La telemetría ya refleja la máquina reparada.</p>
          ) : (
            <>
              <p className="text-sm text-ink-2">Pagado no es reparado. Cuando el técnico instale la pieza, márcalo aquí.</p>
              <Action onClick={install} disabled={!!busy}>
                Marcar repuesto instalado
              </Action>
            </>
          )}
        </Step>
      )}

      {order.installed && (
        <Step n={6} title="Verificación" done={!!order.verification && (!VAULT_ENABLED || !!order.evidenceTx)} active={!order.verification}>
          {!order.verification ? (
            <Action onClick={verify} disabled={!!busy}>
              Medir y verificar
            </Action>
          ) : (
            <div className="grid gap-2">
              <p className={`text-sm font-semibold ${order.verification.verified ? "text-ok" : "text-fault"}`}>
                {order.verification.verified ? "Reparación verificada" : "La máquina sigue fuera de banda"}: promedio{" "}
                <span className="readout">{watts(order.verification.post_repair_watts)}</span> {order.verification.verified ? "≤" : ">"} {watts(order.verification.ceiling_watts)}
              </p>
              <p className="readout break-all text-[0.7rem] text-muted">evidencia {order.verification.evidence_hash}</p>
              {VAULT_ENABLED &&
                (order.evidenceTx ? (
                  <TxLink label="Prueba escrita on-chain: orden cerrada" hash={order.evidenceTx} />
                ) : (
                  <Action onClick={anchor} disabled={!!busy}>
                    Cerrar la orden on-chain
                  </Action>
                ))}
            </div>
          )}
        </Step>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <span className="live-dot h-2 w-2 rounded-full bg-ink" aria-hidden />
          {busy}…
        </p>
      )}
      {error && (
        <p className="rounded border border-fault/30 bg-fault-tint px-3 py-2 text-sm text-fault" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}

function QuoteView({ q, policy }: { q: Quote; policy: Policy }) {
  const a = q.amountBreakdown;
  const [left, setLeft] = useState(() => new Date(q.expiresAt).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(q.expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [q.expiresAt]);
  const mins = Math.max(0, Math.floor(left / 60000));
  const secs = Math.max(0, Math.floor((left % 60000) / 1000));
  return (
    <div className="grid gap-3">
      <dl className="readout grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="font-sans text-ink-2">Pieza</dt>
        <dd>{usd(a.itemsSubtotal.amount)}</dd>
        <dt className="font-sans text-ink-2">Envío</dt>
        <dd>{usd(a.shipping.amount)}</dd>
        <dt className="font-sans text-ink-2">Impuestos</dt>
        <dd>{usd(a.tax.amount.amount)}</dd>
        <dt className="border-t border-line pt-1 font-sans font-semibold">Total final</dt>
        <dd className="border-t border-line pt-1 text-base font-bold">{usd(a.finalAmount.amount)}</dd>
      </dl>
      <p className="text-xs text-muted">{left > 0 ? `Precio vigente ${mins}:${String(secs).padStart(2, "0")} min` : "Cotización vencida: vuelve a cotizar"}</p>
      <div className={`rounded px-3 py-2 text-sm ${policy.decision === "ALLOW" ? "bg-ok-tint text-ok" : "bg-fault-tint text-fault"}`}>
        <p className="font-bold">{policy.decision === "ALLOW" ? "Política: permitido" : "Política: denegado"}</p>
        <ul className="mt-1 space-y-0.5">
          {policy.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Step({ n, title, done = false, active = false, children }: { n: number; title: string; done?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[1.75rem_1fr] gap-x-3">
      <span
        className={`readout flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
          done ? "border-ok bg-ok text-panel" : active ? "border-ink bg-ink text-panel" : "border-line-strong text-muted"
        }`}
        aria-hidden
      >
        {done ? "✓" : n}
      </span>
      <div className="grid gap-2 pb-1">
        <h3 className={`pt-0.5 font-semibold ${done || active ? "text-ink" : "text-muted"}`}>{title}</h3>
        {children}
      </div>
    </section>
  );
}

function Action({ onClick, disabled, quiet = false, children }: { onClick: () => void; disabled?: boolean; quiet?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`justify-self-start rounded-sm px-3 py-2 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        quiet ? "border border-line-strong text-ink hover:bg-panel-2" : "bg-ink text-panel hover:bg-ink-2"
      }`}
    >
      {children}
    </button>
  );
}

function TxLink({ label, hash }: { label: string; hash?: string }) {
  return (
    <p className="text-sm text-ok">
      {label}
      {hash && (
        <>
          {" · "}
          <a className="readout underline underline-offset-2" href={explorerTx(hash)} target="_blank" rel="noreferrer">
            {hash.slice(0, 10)}…
          </a>
        </>
      )}
    </p>
  );
}

function WalletBar() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  if (!VAULT_ENABLED) return <span className="text-xs text-muted">Contrato no desplegado · {CHAIN.name}</span>;
  if (!isConnected)
    return (
      <button
        className="rounded-sm border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-panel-2 disabled:opacity-50"
        disabled={isPending || connectors.length === 0}
        onClick={() => connectors[0] && connect({ connector: connectors[0], chainId: CHAIN.id })}
      >
        {connectors.length ? "Conectar wallet" : "Instala una wallet"}
      </button>
    );
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className={chainId === CHAIN.id ? "text-ink-2" : "text-fault"}>{chainId === CHAIN.id ? CHAIN.name : "Red equivocada"}</span>
      <button className="readout rounded-sm border border-line px-2 py-1 text-xs" onClick={() => disconnect()} title="Desconectar">
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </button>
    </span>
  );
}
