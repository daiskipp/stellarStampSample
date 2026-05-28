# Plans

## Status: All Phases Complete

All 7 phases (0-6) implemented in a single session.

## Completed

### Phase 6: Testnet Launch (2026-05-18)
- [x] Deploy script — identity creation, friendbot funding, WASM deploy, .env.testnet output
- [x] Initialize script — all 5 contracts initialized, cross-contract wiring automated
- [x] Demo seed script — 10 stamps, beans, benefit voucher, spring badge for walkthrough
- [x] README.md — setup, architecture, demo walkthrough, project structure
- [x] CLAUDE.md — updated with final commands and architecture

### Phase 5: Integration & UX (2026-05-18)
- [x] Playwright E2E — 22 tests (customer: 13, staff: 9)
- [x] ErrorBoundary, i18n foundation (ja/en), PWA manifests, CSS reset

### Phase 4: PolicyEngine (2026-05-18)
- [x] 4 policies: 10visit_bonus, 100visit_master, morning_lover, spring_campaign
- [x] Cross-contract reward distribution, double-claim prevention

### Phase 3: Benefits & Badges (2026-05-18)
- [x] dicekey-benefits (SEP-50 NFT), dicekey-badges (SEP-50 SBT)
- [x] Gift dialog, badge display, staff receive benefit

### Phase 2: Reward Token (2026-05-18)
- [x] dicekey-beans-token (SEP-41 FT), allowance, burn_from
- [x] Cross-contract: 10 beans auto-mint per visit

### Phase 1: Visit Stamps (2026-05-18)
- [x] dicekey-visit-stamps (SEP-50 SBT), SDK, customer + staff apps

### Phase 0: Project Foundation (2026-05-18)
- [x] Monorepo (Cargo + pnpm), deploy scripts, dev environment

## Test Summary

| Layer | Count | Status |
|---|---|---|
| Contract unit tests | 46 | All pass |
| Playwright E2E | 22 | All pass |
| **Total** | **68** | **All pass** |

## WASM Sizes

| Contract | Size |
|---|---|
| dicekey-visit-stamps | 9.2 KB |
| dicekey-beans-token | 6.8 KB |
| dicekey-benefits | 7.1 KB |
| dicekey-badges | 6.2 KB |
| dicekey-reward-policy | 5.8 KB |
| **Total** | **35.1 KB** |
