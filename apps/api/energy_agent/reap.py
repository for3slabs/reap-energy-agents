"""Reap Agentic Payments client — the payment rail.

Follows https://docs.reap.global/agentic-payments: enrollment (card stored on Reap's hosted page) →
product search → variant → quote → checkout (user approves on Reap's hosted page) → read checkout.

Rules this client enforces, straight from the docs:
- `Authorization: Bearer <key>` and `Reap-Version` on every request.
- `Idempotency-Key` on every call that creates something (enrollments, quotes, checkouts). The caller
  passes the key so a retry of the SAME logical operation reuses it and never charges twice.
- Card data never touches this service or the model: the user types the card on Reap's page.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://sg.sandbox.api.reap.global"
DEFAULT_VERSION = "2025-02-14"


class ReapError(Exception):
    """A Reap API error with its machine-readable code (e.g. QUOTE_UNFULFILLABLE)."""

    def __init__(self, status: int, code: str, message: str, detail: Any = None) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


@dataclass(frozen=True)
class ReapConfig:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    version: str = DEFAULT_VERSION
    sandbox: bool = True

    @classmethod
    def from_env(cls) -> ReapConfig:
        key = os.environ.get("REAP_API_KEY", "").strip()
        if not key:
            raise RuntimeError("REAP_API_KEY is not set")
        base = os.environ.get("REAP_BASE_URL", DEFAULT_BASE_URL).strip().rstrip("/")
        return cls(
            api_key=key,
            base_url=base,
            version=os.environ.get("REAP_VERSION", DEFAULT_VERSION).strip(),
            sandbox="sandbox" in base,
        )


def new_idempotency_key() -> str:
    return str(uuid.uuid4())


class ReapClient:
    def __init__(self, config: ReapConfig, transport: httpx.BaseTransport | None = None) -> None:
        self._cfg = config
        self._http = httpx.Client(
            base_url=config.base_url,
            timeout=httpx.Timeout(45.0, connect=10.0),
            transport=transport,
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Reap-Version": config.version,
                "Content-Type": "application/json",
            },
        )

    @property
    def sandbox(self) -> bool:
        return self._cfg.sandbox

    def _call(self, method: str, path: str, *, json: Any = None, headers: dict[str, str] | None = None) -> Any:
        res = self._http.request(method, path, json=json, headers=headers)
        body = res.json() if res.content else {}
        if res.status_code >= 400:
            err = body.get("error", {}) if isinstance(body, dict) else {}
            raise ReapError(res.status_code, err.get("code", "UNKNOWN"), err.get("message", res.text[:200]), err.get("detail"))
        return body

    # ── discovery ─────────────────────────────────────────────────────────
    def search_products(self, query: str, *, max_usd: float | None = None, limit: int = 6, country: str = "US") -> dict:
        filters: dict[str, Any] = {"availability": "AVAILABLE_ONLY"}
        if max_usd is not None:
            filters["price"] = {"min": "0", "max": f"{max_usd:.2f}"}
        return self._call(
            "POST",
            "/agentic/products/search",
            json={
                "query": query,
                "context": {"country": country, "currency": "USD"},
                "filters": filters,
                "pagination": {"limit": limit},
            },
        )

    def product_details(self, product_ids: list[str]) -> dict:
        return self._call("POST", "/agentic/products/details", json={"productIds": product_ids})

    def resolve_variant(self, product_id: str, option_ids: list[str]) -> dict:
        return self._call("POST", "/agentic/products/variant", json={"productId": product_id, "optionIds": option_ids})

    # ── pricing ───────────────────────────────────────────────────────────
    def create_quote(self, *, variant_id: str, quantity: int, email: str, shipping_address: dict, idempotency_key: str) -> dict:
        return self._call(
            "POST",
            "/agentic/quotes",
            json={
                "items": [{"variantId": variant_id, "quantity": quantity}],
                "email": email,
                "shippingAddress": shipping_address,
            },
            headers={"Idempotency-Key": idempotency_key},
        )

    def get_quote(self, quote_id: str) -> dict:
        return self._call("GET", f"/agentic/quotes/{quote_id}")

    def select_shipping(self, quote_id: str, shipping_option_id: str) -> dict:
        return self._call("POST", f"/agentic/quotes/{quote_id}/shipping-option", json={"shippingOptionId": shipping_option_id})

    # ── card (stored on Reap's hosted page, never here) ────────────────────
    def create_external_enrollment(self, *, owner_ref: str, email: str, return_url: str, idempotency_key: str) -> dict:
        return self._call(
            "POST",
            "/agentic/enrollments",
            json={
                "source": "EXTERNAL",
                "owner": {"type": "CLIENT_REFERENCE", "id": owner_ref, "email": email},
                "presentation": {"type": "REDIRECT", "returnUrl": return_url},
            },
            headers={"Idempotency-Key": idempotency_key},
        )

    def get_enrollment(self, enrollment_id: str) -> dict:
        return self._call("GET", f"/agentic/enrollments/{enrollment_id}")

    # ── charge ────────────────────────────────────────────────────────────
    def create_checkout(
        self, *, quote_id: str, enrollment_id: str, return_url: str, idempotency_key: str, simulate_completed: bool = False
    ) -> dict:
        headers = {"Idempotency-Key": idempotency_key}
        if simulate_completed:
            if not self._cfg.sandbox:
                raise ValueError("X-Simulate-Checkout is sandbox-only")
            headers["X-Simulate-Checkout"] = "COMPLETED"
        return self._call(
            "POST",
            "/agentic/checkouts",
            json={
                "quoteId": quote_id,
                "enrollmentId": enrollment_id,
                "presentation": {"type": "REDIRECT", "returnUrl": return_url},
            },
            headers=headers,
        )

    def get_checkout(self, checkout_id: str) -> dict:
        return self._call("GET", f"/agentic/checkouts/{checkout_id}")
