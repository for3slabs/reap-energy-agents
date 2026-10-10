"""Simulated plant telemetry.

There are no physical meters in this demo: readings are generated deterministically from the machine
profile and the current minute, so every visitor sees the same plant. The shape of a reading is what a
real three-phase meter (or a Shelly/Emporia-style clamp) reports, so swapping the source is one function.
"""

from __future__ import annotations

import math
import time
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Machine:
    id: str
    name: str
    kind: str
    area: str
    baseline_watts: float  # healthy draw while running
    tolerance: float  # allowed deviation over baseline (0.10 = 10%)
    budget_cents: int  # mirrors MaintenanceVault.configureMachine
    per_order_cap_cents: int
    scenario: str  # healthy | degraded_capacitor | overload_fan | off


PLANT: tuple[Machine, ...] = (
    Machine("compressor-01", "Compresor de aire 01", "Compresor de tornillo 7.5 kW", "Línea A", 7500, 0.10, 50_000, 15_000, "healthy"),
    Machine("press-03", "Prensa hidráulica 03", "Motor de bomba 1.5 kW", "Línea B", 1500, 0.10, 20_000, 6_000, "degraded_capacitor"),
    Machine("conveyor-02", "Banda transportadora 02", "Motorreductor 2.2 kW", "Empaque", 2200, 0.12, 15_000, 5_000, "overload_fan"),
    Machine("chiller-04", "Chiller 04", "Enfriador de agua 5 kW", "Servicios", 5000, 0.10, 40_000, 12_000, "off"),
)


def get_machine(machine_id: str) -> Machine:
    for m in PLANT:
        if m.id == machine_id:
            return m
    raise KeyError(machine_id)


def _wobble(seed: str, t: float, amplitude: float) -> float:
    """Small, smooth, deterministic noise so the charts look alive without randomness."""
    phase = sum(ord(c) for c in seed) % 97
    return amplitude * (math.sin(t / 37.0 + phase) * 0.6 + math.sin(t / 11.0 + phase * 1.7) * 0.4)


def reading(machine: Machine, *, repaired: bool = False, at: float | None = None) -> dict:
    """One meter sample. `repaired=True` returns the machine to its healthy signature."""
    t = (at if at is not None else time.time()) / 60.0
    scenario = "healthy" if repaired else machine.scenario
    base = machine.baseline_watts
    voltage = 220.0 + _wobble(machine.id + "v", t, 2.5)

    if scenario == "off":
        watts, pf = 6.0 + abs(_wobble(machine.id, t, 3.0)), 0.30  # standby trickle: should be running
    elif scenario == "degraded_capacitor":
        watts, pf = base * 1.38 + _wobble(machine.id, t, base * 0.03), 0.68  # weak run capacitor: more current, poor PF
    elif scenario == "overload_fan":
        watts, pf = base * 1.72 + _wobble(machine.id, t, base * 0.05), 0.81  # seized cooling fan: motor overheats, overdraws
    else:
        watts, pf = base * 0.97 + _wobble(machine.id, t, base * 0.02), 0.93

    amps = watts / (voltage * pf)
    return {
        "watts": round(watts, 1),
        "volts": round(voltage, 1),
        "amps": round(amps, 2),
        "power_factor": pf,
        "timestamp": int(at if at is not None else time.time()),
        "simulated": True,
    }


def history(machine: Machine, *, points: int = 48, step_s: int = 300, repaired: bool = False) -> list[dict]:
    now = time.time()
    return [reading(machine, repaired=repaired, at=now - (points - 1 - i) * step_s) for i in range(points)]


def machine_dict(machine: Machine) -> dict:
    return asdict(machine)
