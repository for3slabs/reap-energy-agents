import json

import httpx
import pytest

from energy_agent import telemetry
from energy_agent.diagnosis import DEGRADED, FAULT, OFF, RUNNING, diagnose
from energy_agent.policy import ALLOW, DENY, evaluate_spend, verify_repair
from energy_agent.reap import ReapClient, ReapConfig, ReapError

AT = 1_760_000_000.0


@pytest.mark.parametrize(
    ("machine_id", "state", "has_part"),
    [("compressor-01", RUNNING, False), ("press-03", DEGRADED, True), ("conveyor-02", FAULT, True), ("chiller-04", OFF, True)],
)
def test_each_scenario_maps_to_its_state(machine_id, state, has_part):
    m = telemetry.get_machine(machine_id)
    d = diagnose(m, telemetry.reading(m, at=AT))
    assert d.state == state
    assert (d.part_query is not None) == has_part


def test_repaired_machine_reads_healthy():
    m = telemetry.get_machine("press-03")
    assert diagnose(m, telemetry.reading(m, repaired=True, at=AT)).state == RUNNING


def test_degraded_machine_reports_waste():
    m = telemetry.get_machine("press-03")
    d = diagnose(m, telemetry.reading(m, at=AT))
    assert d.wasted_kwh_day > 0 and d.wasted_usd_month > 0


def test_policy_allows_within_cap_and_budget():
    m = telemetry.get_machine("press-03")  # cap $60, budget $200
    assert evaluate_spend(m, 3_725).decision == ALLOW


def test_policy_denies_over_cap_and_over_budget():
    m = telemetry.get_machine("press-03")
    assert evaluate_spend(m, 6_001).decision == DENY
    assert evaluate_spend(m, 5_000, spent_cents=17_000).decision == DENY


def test_verification_needs_the_window_back_in_tolerance():
    m = telemetry.get_machine("press-03")
    fixed = telemetry.history(m, points=12, step_s=60, repaired=True)
    broken = telemetry.history(m, points=12, step_s=60, repaired=False)
    assert verify_repair(m, fixed).verified is True
    assert verify_repair(m, broken).verified is False


def test_verification_hash_is_deterministic():
    m = telemetry.get_machine("press-03")
    w = [telemetry.reading(m, repaired=True, at=AT + i * 60) for i in range(5)]
    assert verify_repair(m, w).evidence_hash == verify_repair(m, w).evidence_hash


# ── the Reap client honours the documented contract ──────────────────────
def _client(handler):
    return ReapClient(ReapConfig(api_key="sk_test_x"), transport=httpx.MockTransport(handler))


def test_reap_sends_auth_version_and_idempotency_headers():
    seen = {}

    def handler(req: httpx.Request):
        seen.update(req.headers)
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"id": "q_1", "amountBreakdown": {"finalAmount": {"amount": 37.25, "currency": "USD"}}})

    _client(handler).create_quote(variant_id="var_1", quantity=1, email="a@b.co", shipping_address={}, idempotency_key="k-1")
    assert seen["authorization"] == "Bearer sk_test_x"
    assert seen["reap-version"] == "2025-02-14"
    assert seen["idempotency-key"] == "k-1"
    assert seen["body"]["items"] == [{"variantId": "var_1", "quantity": 1}]


def test_reap_error_code_is_surfaced():
    def handler(_req):
        return httpx.Response(400, json={"error": {"code": "QUOTE_UNFULFILLABLE", "message": "no", "detail": {"reason": "INVALID_PHONE"}}})

    with pytest.raises(ReapError) as e:
        _client(handler).get_quote("q_1")
    assert e.value.code == "QUOTE_UNFULFILLABLE"


def test_simulated_checkout_header_only_in_sandbox():
    sent = {}

    def handler(req):
        sent.update(req.headers)
        return httpx.Response(200, json={"id": "co_1", "status": "COMPLETED"})

    _client(handler).create_checkout(quote_id="q", enrollment_id="e", return_url="https://x", idempotency_key="k", simulate_completed=True)
    assert sent["x-simulate-checkout"] == "COMPLETED"
    prod = ReapClient(ReapConfig(api_key="k", base_url="https://sg.prod.api.reap.global", sandbox=False))
    with pytest.raises(ValueError):
        prod.create_checkout(quote_id="q", enrollment_id="e", return_url="https://x", idempotency_key="k", simulate_completed=True)
