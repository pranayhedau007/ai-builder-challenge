# Asset tracking — submission

## Live URL

`[deployed URL]`

## Run locally

```bash
# Prerequisites: Node 18+, pnpm

# From the monorepo root
pnpm install

cp starter/.env.example starter/.env
# Set API_BASE_URL and API_TOKEN in starter/.env

# Two terminals:
pnpm --filter api dev                       # API on :8080
pnpm --filter @asset-tracking/starter dev  # Next.js on :3000
```

Open http://localhost:3000. Reset seed state between test runs:

```bash
curl -s -X POST \
  -H "Authorization: Bearer <your-token>" \
  http://localhost:8080/v1/reset
```

### Environment variables

| Variable | Notes |
|---|---|
| `API_BASE_URL` | Upstream API including `/v1`, e.g. `http://localhost:8080/v1` |
| `API_TOKEN` | Server-only. Never prefix with `NEXT_PUBLIC_`. Browser requests proxy through `/api/upstream/*`, which adds the token server-side. |

---

## Three calls I nearly made the other way

**1. Idempotent confirmations as calm-blue cards, not red errors**

Duplicate receive and already-stored both leave system state unchanged — nothing went wrong. The instinct is a red error card ("asset already received"), but that implies the tech did something bad when they didn't. Both surfaces instead show a neutral blue ● card with person-first attribution ("tech-jane logged it at 9:42pm. Nothing to do."). The pattern is intentional and shared between the two flows — the code marks them as siblings.

The risk: a tech who isn't paying attention might read the blue card as success and miss that nothing actually changed. Real risk, worth monitoring. But the alternative — a red error every time a dock worker rescans an asset — creates more noise than signal at 11pm.

**2. `expected_gap` excluded from the has-discrepancy filter**

`expected_gap` means ops shows an asset as disposed or in RMA while finance still carries a book value. This is expected — finance retires the record at the next billing close. About 52 of the ~143 seed assets land here.

Including `expected_gap` in the has-discrepancy filter would return ~55 assets, of which 52 need nothing done. A manager using the filter to find real problems would abandon it immediately. Excluding it makes the filter return ~3 assets that actually need attention: location conflicts, ghosts, orphans, finance lags. The exclusion is documented with a comment in `app/manager/page.tsx`.

**3. Primary + secondary categorization, not multi-label**

When an asset matches multiple reconciliation categories — C0000108 is both an expected gap and a ghost in facilities — the obvious move is multi-labeling: list the asset under every applicable section. We chose primary + secondary instead: each asset gets one primary category for the count, and secondary matches appear as small inline tags ("also: ghost in facilities").

The risk with multi-labeling: a manager scanning the Monday morning report sees the same asset twice and double-counts in their head. The risk with primary + secondary: if the secondary tag is visually weak, the manager misses that the asset has multiple problems. We chose the second risk because it respects "one row per asset" as the manager's mental model — the report is a list of problems to fix, not a list of category memberships.

---

## What I cut

- **RMA and dispose scan screens** — marked out of scope in the brief. The state machine handles `rma_open`, `rma_receive_back`, and `dispose`; they appear in the event log on `/manager/assets/[tag]`.
- **Batch operations** — each scan flow is single-asset. Batch would require a different UX contract (select list, confirm-all) that the brief doesn't ask for.
- **Finance writedown escalation** — an `rma_pending + capitalized` asset stale for 90+ days is probably a writedown candidate, not just an expected gap. There is a `// TODO` comment at the relevant branch in `lib/reconcile.ts`. Out of scope here.
- **Camera retry UX** — camera permission errors show as inline amber text. No retry button. Works for the happy path; needs iteration for real deployment.

---

## Notes on the brief

**"A dozen of the seeded assets disagree across systems"** — the actual count is 5 assets with meaningful cross-system anomalies, plus 2 assets (C0000113, C0000199) that appear in finance or facilities with no operations record at all. The ID-union in `reconcileAssets` surfaces these by iterating all tags across all three sources rather than ops-first. The brief's "dozen" appears to be a draft-time estimate; worth knowing if the scorer is checking for exactly 12.

**Hosted vs. self-hosted API** — the challenge email mentions a hosted API endpoint. The starter defaults to `http://localhost:8080/v1`. If evaluating against a shared hosted instance, set `API_BASE_URL` in `.env`. The proxy at `/api/upstream/*` works the same either way.

**`in_transit` is not an API state** — the brief's Attention Required section mentions "assets in in_transit with no recent activity." This state does not exist: the canonical enum is `unreceived | received | stored | in_service | rma_pending | disposed` (verified in `api/src/domain/types.ts` and the state machine table in `docs/api-reference.md`). The dashboard covers the underlying concern with a "Stalled receiving" category: assets in `received` state for more than 7 days.

**`stored` state assets have no rack assignment in seed data** — the brief implies "in storage" means somewhere trackable, but `stored` assets in the seed have `rack: null`. Demonstrating the store workflow with the seed data requires either deploying an asset first (then storing it) or using `/dev/barcodes` to print a storage location code and scan it in. Worth calling out in a Loom.

**Stalled receiving is flooded by seed dates** — the seed generator places many assets into `received` state with `updated_at` timestamps from 134 days ago, so the Attention Required section would enumerate 134 stalled-receiving rows on cold load, burying the one drifted asset. The dashboard caps each attention category at 5 (oldest-first, sorted by `updated_at` ascending) with a collapsible "+ N more" toggle.

---

## Architecture notes

**Token security** — `API_TOKEN` never leaves the server. Browser requests go through `/api/upstream/[...path]/route.ts`, which reads the token from `process.env.API_TOKEN` server-side and forwards it. `NEXT_PUBLIC_API_TOKEN` is never set.

**Idempotent confirmation pattern** — duplicate receive (`/tech/receive`) and already-stored (`/tech/store`) both show a calm-blue ● neutral card instead of a red error. Both leave system state unchanged. This is distinct from the green ✓ success card used when a real state transition occurs. The two surfaces share a comment in the code explicitly marking them as siblings.

**Reconciliation categories and the `expected_gap` filter decision** — each asset gets a primary category and zero or more `secondaryFlags`. Primary category determines the count bucket; secondary flags appear as inline "also: X" tags on the report row. `expected_gap` is excluded from the has-discrepancy filter because it is non-actionable by design. The remaining four actionable categories (drift, ghost in facilities, orphan in operations, finance lag) are what the filter is for.

**RSC / client component boundary** — server components handle all data fetching (assets, facilities, finance via the server-side API client). Client components receive serialized props and own only UI state. No client component holds `API_TOKEN` or makes direct upstream calls.

**Write-back pattern** — deploy writes to facilities (`rack_location`) and finance (`status: capitalized`). Store-from-in_service clears the facilities rack entry. Receive and transfer have no write-back requirements. Write-back failures are non-blocking: the primary scan succeeds and the success card shows a `warningText` noting the pending sync.

---

## Tests

Run with `pnpm test` from `starter/`.

**`test/reconcile.test.ts`** — 33 cases across all six reconciliation categories. Covers primary + secondary flag combinations, no-ops-record cases (the C0000199 ghost and C0000113 orphan patterns), the 7-day finance-lag threshold (strict `>`, so exactly 7 days is not a lag), and the ID-union behavior that surfaces fac-only and fin-only records. The reconcile functions are pure (deterministic given a fixed `now` argument) and require no mocks.

**`test/ScanInput.test.tsx`** — 3 cases: fires on Enter with trimmed value, ignores empty submission, clears after firing.

End-to-end coverage is provided by `docs/happy-path.md`. Run it manually with `POST /v1/reset` between scenarios.
