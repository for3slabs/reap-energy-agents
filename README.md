# Reap Energy Agents

**An agent that reads every machine's power draw, buys the part that fixes it with Reap Agentic Payments, and
closes the work order on-chain only when the machine's consumption is back to normal.**

> *Un agente lee el consumo eléctrico de cada máquina, compra el repuesto con Reap y cierra la orden on-chain
> solo cuando el consumo vuelve a la normalidad. Pagado no es reparado.*

Built for the **Reap × AI Builders Mexico Agentic Hackathon** · track **Best Bridge Between Onchain and Real
World** · sandbox only, no real money moves.

| | |
|---|---|
| Live demo | https://reap-energy-agents.vercel.app |
| API | https://reap-energy-agents-api.vercel.app/api/health |
| Contract | `packages/contracts/src/MaintenanceVault.sol` (Ink Sepolia) |

---

## The problem

A machine with a failing part rarely stops. It keeps running and **overdraws**: a weak run capacitor makes a
motor pull ~40% more power with a poor power factor; a seized cooling fan pushes it past +70%. Plants pay for
that energy every hour until someone notices, then lose more time sourcing the part.

## What it does

```
 meter ──▶ diagnosis ──▶ Reap: search · quote · checkout ──▶ technician installs ──▶ verification
 (W, A, PF)  (rule table)    (card on Reap's hosted page)                          (power back in band)
                │                         │                                               │
                └──────── MaintenanceVault (on-chain): budget · reservation · purchase · VERIFIED / FAILED
```

1. **Measure.** Each machine reports watts, amps and power factor against its healthy baseline.
2. **Diagnose.** A deterministic rule table, not an LLM, classifies the machine (works · off · defect · fault)
   and names the part that fixes it. Anything that leads to spending money must be reproducible.
3. **Buy with Reap.** The agent searches Reap's merchant catalog for the part, prices it with shipping and
   tax (`POST /agentic/quotes`), checks the spend policy, and opens a checkout the operator approves on Reap's
   hosted page. Card data never reaches the agent.
4. **Verify on-chain.** The order closes as **VERIFIED** only if the average draw over a post-repair window is
   back within tolerance. Otherwise it closes as **FAILED**: paid, not fixed, and public.

## Why on-chain (the bridge)

`MaintenanceVault` defines **when and how much the agent may pay**, the example the track asks for:

- a budget and a per-order cap per machine (`configureMachine`);
- a reservation **before** the Reap checkout (`openWorkOrder`), reverted if it exceeds either limit;
- the purchase (`recordPurchase`), whose final charge can never exceed the reservation;
- the repair proof (`recordRepairEvidence`), which compares post-repair watts with the baseline.

Payment and repair are two separate on-chain facts. Off-chain references (Reap quote and order ids, the
diagnosis, the telemetry window) are stored as hashes, so nothing private lands on-chain. Transactions are
signed by the operator's wallet in the browser: **no private key lives on any server.**

## How Reap is used (and nothing around it)

| Reap Agentic Payments | This project |
|---|---|
| Stores the card on a hosted page (`EXTERNAL` enrollment) | Never sees a card number |
| Merchant catalog: `products/search` | Turns a diagnosis into a search with a price ceiling |
| Live merchant pricing: `quotes` (expires) | Re-quotes when expired; policy runs on the final amount |
| `checkouts` + hosted approval | One `Idempotency-Key` per purchase, reused on retry: never two charges |
| `GET checkouts/:id` → `orderId`, `finalAmount` | Reconciles on `finalAmount`, writes it on-chain |

Rules respected: Agentic module central · sandbox only · supported merchants only · no checkout scraping · no
raw card data to an LLM · `Reap-Version` and `Idempotency-Key` on every call that creates something.

## Repository

```
apps/web            Next.js 16 · landing + operator console · wagmi/viem (injected wallets)
apps/api            FastAPI · telemetry, diagnosis, spend policy, Reap client · deploys to Vercel
packages/contracts  Foundry · MaintenanceVault + tests + deploy script
PRODUCT.md          product and design context
docs/VISION.md      vision, mission, objective and the market analysis behind them
```

## Run it locally

```bash
# API
cd apps/api && cp env.example .env    # put your Reap sandbox key in .env
uv sync && uv run uvicorn index:app --port 8811 --env-file .env

# Web
cd apps/web && cp env.example .env.local
pnpm install && pnpm dev               # http://localhost:3000

# Contracts
cd packages/contracts && forge test
```

⚠️ Reap requires an **HTTPS** `returnUrl` for its hosted pages, so card enrollment and checkout approval only
work on the deployed site, not on `localhost`.

## Deploy the contract

```bash
cd packages/contracts
AGENT_ADDRESS=<operator wallet> forge script script/Deploy.s.sol \
  --rpc-url https://rpc-gel-sepolia.inkonchain.com --account <keystore> --broadcast
```

Then set `NEXT_PUBLIC_VAULT_ADDRESS` (and `NEXT_PUBLIC_CHAIN_ID=763373`) on the web project. Until then the
console runs the same rules off-chain and says so on screen.

## Honest limits

- **Telemetry is simulated** (deterministic, same for every visitor). The reading shape matches a real
  three-phase meter, so the source is one function to swap.
- The **repair step is simulated** in the demo (a button marks the part installed); verification then reads the
  post-repair window.
- Reap **mandates** are not live yet (per Reap's docs), so every charge is approved on Reap's hosted page.

## License

MIT
