---
register: product
---

# PRODUCT — Reap Energy Agents

## Product purpose

An agent watches the electrical consumption of every machine in a plant, tells the maintenance chief which
one works, which one is off and which one is defective, prices the part that fixes it through **Reap
Agentic Payments**, and closes the work order only when the machine's power draw is back to normal. The
spend rules and the repair proof live in an on-chain contract (`MaintenanceVault`), so "paid" and "fixed"
are two separate, public facts.

Built for the Reap × AI Builders Mexico Agentic Hackathon, track **Best Bridge Between Onchain and Real
World**: a smart contract defines when and how much the agent may pay, and the money lands on a real
merchant for a real part.

## Users

- **Primary: the plant maintenance chief.** On the production floor with a tablet or laptop, under harsh
  industrial lighting, deciding fast which machine to attend first. Not a crypto user. Trusts instruments,
  distrusts dashboards that "look nice".
- **Secondary: the operations manager.** Reviews energy waste and repair spend per machine, approves charges
  on Reap's hosted page.
- **Audience for the demo: hackathon judges** (Reap, OSL, Payward). They must see in under two minutes that
  agentic payments are central, not decorative.

## Brand and tone

- A precision instrument, not an app: like a Fluke multimeter or a panel meter. Big, exact numbers. Color
  only carries state (works, defect, fault, off).
- Plain Spanish, technical where it matters (watts, power factor, µF), never marketing.
- Honest about what is simulated: telemetry is simulated in this demo and the UI says so.

## Anti-references

- Crypto neon: black backgrounds, neon green or purple, gradients, "web3" glow.
- Generic SaaS: cream background, identical icon cards, hero with one giant metric.
- Saturated dashboards: twenty charts at once with no hierarchy.

## Strategic principles

1. **A purchase is not a repair.** Every screen keeps payment state and repair state apart.
2. **The rule decides, the model explains.** Diagnosis and spend policy are deterministic and shown line by
   line; nothing that spends money depends on a model's mood.
3. **Card data never touches us.** The card is stored and every charge approved on Reap's hosted pages.
4. **The contract is the ledger.** Budget, reservation, purchase and verified repair are on-chain events
   anyone can audit.
