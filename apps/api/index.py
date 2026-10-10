"""HTTP API for the energy maintenance agent (FastAPI · deploys to Vercel as-is).

Stateless on purpose: serverless instances share no memory. The browser carries the mission, the
MaintenanceVault contract is the shared ledger, and Reap holds the purchase. No private key lives here.
"""

from __future__ import annotations

import os
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field

from energy_agent import telemetry
from energy_agent.diagnosis import diagnose
from energy_agent.policy import evaluate_spend, verify_repair
from energy_agent.reap import ReapClient, ReapConfig, ReapError, new_idempotency_key

app = FastAPI(title="Reap Energy Agents API", version="0.1.0")

_origins = [o.strip() for o in os.environ.get("WEB_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=os.environ.get("WEB_ORIGIN_REGEX") or None,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Demo delivery address for quotes (merchants need one to price shipping). Override per request.
DEMO_SHIP_TO = {
    "firstName": "Planta",
    "lastName": "Demo",
    "phone": "+12125550123",
    "addressLine1": "350 5th Ave",
    "city": "New York",
    "state": "NY",
    "postalCode": "10118",
    "country": "US",
}


@lru_cache(maxsize=1)
def reap() -> ReapClient:
    return ReapClient(ReapConfig.from_env())


@app.exception_handler(ReapError)
async def _reap_error(_request, exc: ReapError) -> JSONResponse:
    status = exc.status if 400 <= exc.status < 500 else 502
    return JSONResponse({"error": {"code": exc.code, "message": exc.message, "detail": exc.detail}}, status_code=status)


def _machine(machine_id: str) -> telemetry.Machine:
    try:
        return telemetry.get_machine(machine_id)
    except KeyError:
        raise HTTPException(404, f"unknown machine '{machine_id}'") from None


def _repaired(raw: str | None) -> set[str]:
    return {x for x in (raw or "").split(",") if x}


# ── plant ─────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "reap_configured": bool(os.environ.get("REAP_API_KEY")), "telemetry": "simulated"}


@app.get("/api/machines")
def machines(repaired: str | None = Query(None, description="comma-separated ids already repaired")) -> dict:
    done = _repaired(repaired)
    out = []
    for m in telemetry.PLANT:
        sample = telemetry.reading(m, repaired=m.id in done)
        out.append({**telemetry.machine_dict(m), "reading": sample, "diagnosis": diagnose(m, sample).to_dict()})
    return {"machines": out}


@app.get("/api/machines/{machine_id}/history")
def machine_history(machine_id: str, repaired: bool = False, points: int = Query(48, ge=6, le=288)) -> dict:
    m = _machine(machine_id)
    return {"machine_id": m.id, "baseline_watts": m.baseline_watts, "points": telemetry.history(m, points=points, repaired=repaired)}


# ── the payment rail (Reap Agentic Payments) ─────────────────────────────
@app.get("/api/machines/{machine_id}/parts")
def parts_for_machine(machine_id: str) -> dict:
    """The agent turns the diagnosis into a catalog search on Reap."""
    m = _machine(machine_id)
    d = diagnose(m, telemetry.reading(m))
    if not d.part_query:
        return {"diagnosis": d.to_dict(), "products": []}
    res = reap().search_products(d.part_query, max_usd=d.max_part_usd, limit=6)
    return {"diagnosis": d.to_dict(), "query": d.part_query, "products": res.get("products", []), "warnings": res.get("warnings", [])}


class QuoteIn(BaseModel):
    machine_id: str
    variant_id: str
    quantity: int = Field(1, ge=1, le=10)
    email: EmailStr = "ops@example.com"
    spent_cents: int = Field(0, ge=0, description="already spent on this machine (read from the vault)")
    idempotency_key: str | None = None


@app.post("/api/quotes")
def create_quote(body: QuoteIn) -> dict:
    """Price the part with the merchant, then evaluate the spend policy BEFORE any checkout exists."""
    m = _machine(body.machine_id)
    key = body.idempotency_key or new_idempotency_key()
    quote = reap().create_quote(
        variant_id=body.variant_id, quantity=body.quantity, email=body.email, shipping_address=DEMO_SHIP_TO, idempotency_key=key
    )
    final = quote["amountBreakdown"]["finalAmount"]["amount"]
    policy = evaluate_spend(m, round(float(final) * 100), body.spent_cents)
    return {"quote": quote, "policy": policy.to_dict(), "idempotency_key": key}


class EnrollmentIn(BaseModel):
    owner_ref: str = Field(..., min_length=3, max_length=64)
    email: EmailStr
    return_url: str
    idempotency_key: str | None = None


@app.post("/api/enrollments")
def create_enrollment(body: EnrollmentIn) -> dict:
    """Store a card on Reap's hosted page. The card never reaches this API or the agent."""
    key = body.idempotency_key or new_idempotency_key()
    enr = reap().create_external_enrollment(owner_ref=body.owner_ref, email=body.email, return_url=body.return_url, idempotency_key=key)
    return {"enrollment": enr, "idempotency_key": key}


@app.get("/api/enrollments/{enrollment_id}")
def get_enrollment(enrollment_id: str) -> dict:
    return {"enrollment": reap().get_enrollment(enrollment_id)}


class CheckoutIn(BaseModel):
    quote_id: str
    enrollment_id: str
    return_url: str
    idempotency_key: str
    simulate_completed: bool = False


@app.post("/api/checkouts")
def create_checkout(body: CheckoutIn) -> dict:
    """Charge the stored card for the quote. Requires the idempotency key from the caller so a retry
    of the same purchase replays instead of charging twice."""
    enr = reap().get_enrollment(body.enrollment_id)
    if enr.get("status") != "ACTIVE":
        raise HTTPException(409, f"enrollment is {enr.get('status')}, not ACTIVE")
    co = reap().create_checkout(
        quote_id=body.quote_id,
        enrollment_id=body.enrollment_id,
        return_url=body.return_url,
        idempotency_key=body.idempotency_key,
        simulate_completed=body.simulate_completed,
    )
    return {"checkout": co}


@app.get("/api/checkouts/{checkout_id}")
def get_checkout(checkout_id: str) -> dict:
    return {"checkout": reap().get_checkout(checkout_id)}


# ── closing the loop with the physical world ─────────────────────────────
class VerifyIn(BaseModel):
    machine_id: str
    order_ref: str | None = None
    repaired: bool = True  # demo: the technician installed the part


@app.post("/api/verify")
def verify(body: VerifyIn) -> dict:
    """A purchase is not a repair. The order closes only when a window of post-repair readings is back
    within tolerance; the evidence hash is what the browser writes to MaintenanceVault."""
    m = _machine(body.machine_id)
    window = telemetry.history(m, points=12, step_s=60, repaired=body.repaired)
    return {"verification": verify_repair(m, window, order_id=body.order_ref).to_dict()}
