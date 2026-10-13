# Colosseum submission copy: Tollgate

Replace every **TODO** with a real value before submitting. Do not claim anything that is not true on the day you submit.

## Form fields

**Project name:** Tollgate

**Category:** Developer Infrastructure (use Payments if that option is missing)

**Brief description (paste as is):**
Tollgate is an open-source toolkit that lets any API owner charge AI agents and users per request in USDC on Solana using x402, with a dashboard for revenue, per-wallet spending caps, and refusals. Add a few lines of middleware, and agents pay and get access instantly, with no accounts, API keys, or card processors.

**Track:** Solana

**Repo:** TODO public GitHub URL (MIT licensed)
**Live demo:** TODO deployed URL  (only if it is deployed and working)
**Demo video:** TODO link (2 to 3 minutes)

## Longer description

AI agents need to buy things from APIs, and APIs need to sell to agents. Today that means sign-up forms, API keys, invoices and card processors, none of which an autonomous agent can use. x402 revives HTTP 402 so a request can carry its own payment. Tollgate is the owner-side and agent-side toolkit around it:

- **Middleware** that puts a price on any Express route and settles in USDC on Solana before the handler runs.
- **Revenue ledger and dashboard**: every settled payment, per-route and per-wallet totals, and a link to each transaction on the Solana explorer.
- **Owner controls**: a daily spending cap per paying wallet, enforced before settlement so refused payers are never charged.
- **Agent client**: a drop-in `fetch` that pays automatically and refuses to sign past a per-request or total budget.

## Why Solana

Sub-cent prices are the point: a $0.002 call only makes sense when the network fee is a small fraction of it. Solana's fees and finality make per-request pricing practical, and the facilitator sponsors fees so agents only need USDC.

## Business plan (state as a plan, not as traction)

- Open-source core stays free (MIT).
- Revenue: a hosted version with a persistent ledger, team access and alerts (SaaS subscription), plus an optional small fee on settled volume for the hosted facilitator path.
- First customers: developers publishing APIs, datasets and tools meant for agent consumption.
- Risks, stated honestly: x402 is young and many teams build on it; differentiation is the owner-side tooling (cap, ledger, dashboard) and agent budgets, not the protocol.

## What was built during the hackathon

Everything in this repository: middleware, ledger, owner cap, agent client with budgets, dashboard, tests, deployment config. Built on the official `@x402/*` packages. TODO: link the commit history and note the date range.

## Traction (fill in only real numbers)

- TODO: number of developers who tried it, with a real quote each (or delete this section)
- TODO: number of real devnet transactions in the demo, with explorer links

## Demo video script (2 to 3 minutes)

1. (0:00) One sentence: "Agents can't fill in sign-up forms. Tollgate lets any API charge them per request."
2. (0:15) Split screen. Left: terminal running `npm run demo:agent`. Right: dashboard.
3. (0:25) Agent calls the paid route, gets 402, pays, and gets data. Dashboard total ticks up. Click a transaction to show it on the Solana explorer.
4. (1:15) Show the agent's budget guard stopping it mid-run ("budget exhausted").
5. (1:35) Show the owner cap refusing a second wallet; refusal appears in the dashboard and no money moved.
6. (1:55) Show the 6 lines of code to add Tollgate to an API.
7. (2:15) Business plan in two sentences, then the repo link.

## Pre-submit checklist

- [ ] Real devnet transaction exists and opens on explorer.solana.com
- [ ] Repo is public, MIT, README renders, commit history is visible
- [ ] Deployed URL works (or remove the Live demo line)
- [ ] Demo video link opens in a private window
- [ ] No secret keys or `.env` in the repo (`git log -p | grep -i secret`)
- [ ] Every TODO above is replaced or deleted
- [ ] Submitted at least 2 hours before 11:59pm PT (Oct 13, 7:59am Lagos)
