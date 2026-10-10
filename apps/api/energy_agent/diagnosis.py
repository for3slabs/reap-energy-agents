"""Deterministic diagnosis: energy signature → machine state → the part that fixes it.

The model of record is a rule table, not an LLM: a decision that leads to spending money has to be
reproducible and explainable line by line. An LLM can phrase the explanation; it never decides.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .telemetry import Machine

# States shown to the operator
RUNNING = "FUNCIONA"
OFF = "NO_FUNCIONA"
DEGRADED = "DEFECTO"
FAULT = "FALLA"


@dataclass(frozen=True)
class Diagnosis:
    machine_id: str
    state: str
    excess_pct: float  # draw over baseline, %
    wasted_kwh_day: float  # energy above baseline over 24 h of operation
    wasted_usd_month: float  # at the configured tariff
    cause: str | None
    part_query: str | None  # what to search in Reap's catalog
    part_label: str | None
    max_part_usd: float | None  # price ceiling sent to search
    evidence: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


TARIFF_USD_KWH = 0.12  # demo tariff; set per plant in production


def diagnose(machine: Machine, sample: dict) -> Diagnosis:
    watts = float(sample["watts"])
    pf = float(sample["power_factor"])
    base = machine.baseline_watts
    excess = (watts - base) / base
    ceiling = base * (1 + machine.tolerance)
    wasted_w = max(0.0, watts - base)
    wasted_kwh_day = wasted_w * 24 / 1000
    evidence = [
        f"Consumo actual {watts:.0f} W vs línea base {base:.0f} W ({excess * 100:+.0f}%)",
        f"Factor de potencia {pf:.2f}",
        f"Tolerancia de la máquina: hasta {ceiling:.0f} W",
    ]

    def build(state: str, cause: str | None, query: str | None, label: str | None, max_usd: float | None) -> Diagnosis:
        return Diagnosis(
            machine_id=machine.id,
            state=state,
            excess_pct=round(excess * 100, 1),
            wasted_kwh_day=round(wasted_kwh_day, 2) if state in (DEGRADED, FAULT) else 0.0,
            wasted_usd_month=round(wasted_kwh_day * 30 * TARIFF_USD_KWH, 2) if state in (DEGRADED, FAULT) else 0.0,
            cause=cause,
            part_query=query,
            part_label=label,
            max_part_usd=max_usd,
            evidence=evidence,
        )

    if watts < base * 0.05:
        evidence.append("Consumo de reposo con la máquina programada en marcha")
        cause = "La máquina no arranca: fuente de control de 24 V sin salida"
        return build(OFF, cause, "24V DIN rail power supply", "Fuente de 24 V para riel DIN", 80.0)
    if watts > base * 1.5:
        evidence.append("Sobreconsumo mayor a 50%: el motor trabaja forzado y se calienta")
        cause = "Ventilador de enfriamiento del motor trabado: el motor se sobrecalienta"
        return build(FAULT, cause, "cooling fan 120mm 24V", "Ventilador de enfriamiento", 40.0)
    if watts > ceiling and pf < 0.75:
        evidence.append("Factor de potencia bajo con sobreconsumo: firma de capacitor de marcha degradado")
        return build(DEGRADED, "Capacitor de marcha del motor degradado", "30uF motor run capacitor", "Capacitor de marcha 30 µF", 30.0)
    if watts > ceiling:
        return build(DEGRADED, "Sobreconsumo sin causa clara: requiere inspección", None, None, None)
    return build(RUNNING, None, None, None, None)
