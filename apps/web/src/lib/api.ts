// Typed client for apps/api. Every call that creates something on Reap carries an idempotency key
// generated ONCE per logical operation and reused on retry, so a double click never charges twice.

// Same-origin by default: next.config.ts proxies /api to the agent API (AGENT_API_ORIGIN).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export type MachineState = "FUNCIONA" | "NO_FUNCIONA" | "DEFECTO" | "FALLA";

export interface Reading {
  watts: number;
  volts: number;
  amps: number;
  power_factor: number;
  timestamp: number;
  simulated: boolean;
}

export interface Diagnosis {
  machine_id: string;
  state: MachineState;
  excess_pct: number;
  wasted_kwh_day: number;
  wasted_usd_month: number;
  cause: string | null;
  part_query: string | null;
  part_label: string | null;
  max_part_usd: number | null;
  evidence: string[];
}

export interface Machine {
  id: string;
  name: string;
  kind: string;
  area: string;
  baseline_watts: number;
  tolerance: number;
  budget_cents: number;
  per_order_cap_cents: number;
  reading: Reading;
  diagnosis: Diagnosis;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface Product {
  id: string;
  name: string;
  imageUrl?: string;
  merchant: { name: string };
  priceRange?: { min: Money; max: Money };
  previewVariant: { id: string; name?: string; price: Money; available: boolean };
}

export interface Quote {
  id: string;
  shippingOptions: { id: string; name: string; selected: boolean; price: Money }[];
  amountBreakdown: {
    itemsSubtotal: Money;
    shipping: Money;
    tax: { amount: Money; includedInPrices: boolean };
    finalAmount: Money;
  };
  expiresAt: string;
}

export interface Policy {
  decision: "ALLOW" | "DENY";
  amount_cents: number;
  per_order_cap_cents: number;
  remaining_cents: number;
  reasons: string[];
}

export interface Enrollment {
  id: string;
  status: "REQUIRES_ACTION" | "ACTIVE" | "REVOKED" | "FAILED" | "EXPIRED";
  nextAction?: { type: string; url: string; expiresAt?: string } | null;
  paymentMethod?: { network: string; last4: string } | null;
}

export interface Checkout {
  id: string;
  status: string;
  quoteId: string;
  enrollmentId: string;
  orderId?: string;
  amount?: Money;
  finalAmount?: Money;
  nextAction?: { type: string; url: string; expiresAt?: string } | null;
}

export interface Verification {
  verified: boolean;
  post_repair_watts: number;
  ceiling_watts: number;
  evidence_hash: `0x${string}`;
  evidence: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(45_000), // never hang the console on a dead request
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") throw new ApiError(0, "TIMEOUT", "La API del agente no respondió en 45 s");
    throw new ApiError(0, "NETWORK", "No se pudo contactar a la API del agente");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    const detail = typeof body?.detail === "string" ? body.detail : undefined;
    // Reap validation errors name the offending field: surface it instead of a bare "Validation failed".
    const field = err.detail?.errors?.[0];
    const reason = field ? `${field.path}: ${field.message}` : err.detail?.reason;
    const message = [err.message ?? detail ?? "Error de la API", reason].filter(Boolean).join(" · ");
    throw new ApiError(res.status, err.code ?? "HTTP_" + res.status, message);
  }
  return body as T;
}

const post = <T,>(path: string, data: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(data) });

export const api = {
  machines: (repaired: string[]) => call<{ machines: Machine[] }>(`/api/machines?repaired=${repaired.join(",")}`),
  history: (id: string, repaired: boolean) =>
    call<{ baseline_watts: number; points: Reading[] }>(`/api/machines/${id}/history?repaired=${repaired}&points=48`),
  parts: (id: string) => call<{ query?: string; products: Product[] }>(`/api/machines/${id}/parts`),
  quote: (machine_id: string, variant_id: string, spent_cents: number, idempotency_key: string) =>
    post<{ quote: Quote; policy: Policy; idempotency_key: string }>("/api/quotes", { machine_id, variant_id, spent_cents, idempotency_key }),
  enroll: (owner_ref: string, email: string, return_url: string, idempotency_key: string) =>
    post<{ enrollment: Enrollment }>("/api/enrollments", { owner_ref, email, return_url, idempotency_key }),
  enrollment: (id: string) => call<{ enrollment: Enrollment }>(`/api/enrollments/${id}`),
  checkout: (quote_id: string, enrollment_id: string, return_url: string, idempotency_key: string, simulate_completed: boolean) =>
    post<{ checkout: Checkout }>("/api/checkouts", { quote_id, enrollment_id, return_url, idempotency_key, simulate_completed }),
  getCheckout: (id: string) => call<{ checkout: Checkout }>(`/api/checkouts/${id}`),
  verify: (machine_id: string, order_ref: string | null) =>
    post<{ verification: Verification }>("/api/verify", { machine_id, order_ref, repaired: true }),
};

export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const watts = (n: number) => `${Math.round(n).toLocaleString("es-MX")} W`;
