# Autonomous Automotive Agent

An intent-driven, taste-aware automotive search agent that guides a user from a vague desire ("I want X") to an informed decision (buy now vs. wait vs. watch), using live market data and explicit reasoning instead of static filters.

This project is **not** a marketplace clone or filter wrapper. It is an agentic system that:

* captures user intent and constraints
* reasons over imperfect market data
* explains *why* results qualify or fail
* recommends action (act, wait, revise) based on evidence

---

## Core Concept

Traditional car search tools rely on rigid filters and assume clean data. Real listings are messy: trims are missing, colors are ambiguous, and duplicates are common.

This agent treats car search as a **reasoning problem**, not a filtering problem.

High-level flow:

```
User Intent
   ↓
S1 Capture  → extract vehicle + usage intent
S2 Confirm  → lock Tier 1 / Tier 2 boundaries
S3 Explore  → live market search + evidence-based gating
S4 Decide   → act vs watch vs revise (coming next)
S5 Watch    → persistent monitoring for rare specs
```

---

## Key Features

### Intent-Driven State Machine

The agent progresses through explicit states (S1–S5). The **server owns state transitions**; the model only emits structured patches.

### Tiered Constraints

Constraints are classified as:

* **Tier 1 (non-negotiable)** – must be confirmed by evidence
* **Tier 2 (strong preferences)** – affect scoring
* **Tier 3 (nice-to-haves)** – soft ranking signals

### Evidence-Based Matching

Listings are evaluated using *signals*, not trust in provider fields:

* trim inferred from engine / series / text
* color confirmed via strict semantic match
* duplicates removed by VIN

Absence of evidence ≠ rejection. The agent distinguishes:

* confirmed
* unknown
* contradictory

### Live Market Search (S3)

* Provider: Auto.dev
* Deterministic, bounded retrieval (top-N)
* VIN-based deduplication
* Explicit rationale for every candidate

### Watch-Oriented by Design

Rare specs often do not exist *right now*. The agent can correctly conclude:

> "Waiting is the right decision."

and automatically generate a **Watch artifact** to monitor the market.

---

## Current Status

✅ S1 Capture – intent extraction

✅ S2 Confirm – boundary locking

✅ S3 Explore – live market search, dedupe, gating

⏭️ S4 Decide – *next to implement*

⏳ S5 Watch – artifact generation & persistence

---

## Example Use Case

> *"I’m looking for a Porsche Boxster S (986.2), manual, Speed Yellow only. Long-term ownership."*

The agent:

* confirms strict constraints
* searches the live market
* identifies near-miss Boxster S listings
* correctly concludes no Speed Yellow examples exist
* recommends waiting and creates a watch

This behavior is **impossible** with simple filters.

---

## Development

### Setup

```bash
npm install
npm run dev
```

Environment variables:

```env
AUTODEV_API_KEY=your_key_here
```

---

## Philosophy

* The agent should **never hardcode domain knowledge** (colors, trims, brands)
* All semantics flow from **user intent** and **evidence**
* Correctly saying *"no"* is as important as finding a match

---

## Roadmap

* [ ] S4 Decide (act vs watch vs revise)
* [ ] Watch notifications
* [ ] Multi-provider search
* [ ] Broader vehicle test cases (Audi, BMW, Mercedes)

---

## Disclaimer

This project is experimental and for educational / exploratory purposes.

It does not provide financial advice and does not guarantee listing accuracy.
