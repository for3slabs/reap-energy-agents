"""Spend policy and repair verification — the off-chain mirror of MaintenanceVault.

The contract is the source of truth once deployed; this module applies the same arithmetic so the API
can answer before a transaction exists (and the UI can explain WHY an order was denied).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass

from .telemetry import Machine

ALLOW = "ALLOW"
DENY = "DENY"


@dataclass(frozen=True)
class PolicyDecision:
    decision: str
    amount_cents: int
    per_order_cap_cents: int
    remaining_cents: int
    reasons: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def evaluate_spend(machine: Machine, amount_cents: int, spent_cents: int = 0) -> PolicyDecision:
    remaining = machine.budget_cents - spent_cents
    reasons: list[str] = []
    if amount_cents > machine.per_order_cap_cents:
        reasons.append(f"El total ${amount_cents / 100:.2f} supera el tope por orden de ${machine.per_order_cap_cents / 100:.2f}")
    if amount_cents > remaining:
        reasons.append(f"El total ${amount_cents / 100:.2f} supera el presupuesto restante de ${remaining / 100:.2f}")
    if reasons:
        return PolicyDecision(DENY, amount_cents, machine.per_order_cap_cents, remaining, reasons)
    return PolicyDecision(
        ALLOW,
        amount_cents,
        machine.per_order_cap_cents,
        remaining,
        ["Dentro del tope por orden y del presupuesto de la máquina", "El cargo final lo aprueba una persona en la página de Reap"],
    )


@dataclass(frozen=True)
class Verification:
    verified: bool
    post_repair_watts: float
    ceiling_watts: float
    evidence_hash: str  # keccak-compatible input is the canonical JSON; we expose sha256 for display
    evidence: dict

    def to_dict(self) -> dict:
        return asdict(self)


def verify_repair(machine: Machine, samples: list[dict], *, order_id: str | None = None) -> Verification:
    """A repair counts only if the AVERAGE draw over the post-repair window is back within tolerance.
    One good sample is not proof; a window is."""
    if not samples:
        raise ValueError("verification needs at least one post-repair sample")
    avg = sum(float(s["watts"]) for s in samples) / len(samples)
    ceiling = machine.baseline_watts * (1 + machine.tolerance)
    evidence = {
        "machine_id": machine.id,
        "order_id": order_id,
        "window": {"from": samples[0]["timestamp"], "to": samples[-1]["timestamp"], "samples": len(samples)},
        "avg_watts": round(avg, 1),
        "ceiling_watts": round(ceiling, 1),
        "baseline_watts": machine.baseline_watts,
    }
    canonical = json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()
    return Verification(avg <= ceiling, round(avg, 1), round(ceiling, 1), "0x" + hashlib.sha256(canonical).hexdigest(), evidence)
