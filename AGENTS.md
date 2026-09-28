# ClinicCare — Project Conventions

Clinic management system built per the approved architecture plan (see the plan
approval in the project thread for the full design: modules, RBAC matrix, AI
boundaries, roadmap).

## Stack

- Next.js (App Router) + TypeScript (strict), React 19
- Tailwind CSS v4; shadcn/ui components are added per-module as needed
- PostgreSQL + Prisma (Prisma is the ONLY database access path)
- Redis (queues/rate limiting/cache — added where actually needed)
- Vitest (unit + integration), Playwright (E2E from Phase 3+)

## Rules

1. **Never commit to `main` directly.** Branch `feat/<phase>-<slug>`, squash-merge
   via PR. Conventional Commits (`feat:`, `fix:`, `chore:`, `db:`, `test:`, `docs:`).
2. **No secrets in the client.** Only `src/lib/env.ts` reads `process.env`
   (via `src/lib/env-schema.ts`); it imports `server-only`.
3. **Validated boundaries.** Zod-parse all external input; server actions return
   `ActionResult<T>` envelopes, never raw throws.
4. **Audit everything sensitive.** Writes go through feature services; the audit
   log is append-only.
5. **Migrations are additive.** Never edit a shipped migration. Add columns with
   defaults; drop only behind a feature flag.
6. **Every phase keeps the app runnable.** `npm run build`, lint, typecheck, and
   tests must pass before merge; CI is the gate.
7. **Clinical data is never silently mutated** (append-only clinical records from
   Phase 4) and **never logged** (PHI-safe logger policy).
8. **Commits are authored by the human owner only** — no agent or bot
   co-author trailers, on `main` or on feature branches.

## Layout

- `src/app/` — routes (pages, layouts, route handlers)
- `src/features/<module>/` — module code (schemas, services, components)
- `src/lib/` — db, env, logger, rbac, errors, utils
- `prisma/` — schema, migrations, seed
- `docker/` — compose files; `Dockerfile` builds the production image
- `tests/` — vitest suites + local smoke script

## Testing

- `npm test` needs `DATABASE_URL` pointing at a reachable Postgres; the
  DB-backed suites skip themselves without one.
- `npx playwright test` resets the E2E database at startup, so a local run
  starts from the same state as CI's ephemeral one. Set `E2E_DATABASE_URL` when
  the embedded Postgres cannot start (e.g. an elevated shell on Windows).

## Phase status

- [x] Phase 0 — bootstrap
- [x] Phase 1 — auth (Auth.js v5 DB sessions, argon2id), RBAC enforcement
  (`requirePermission`), staff management, audit viewer, role dashboards
- [x] Phase 2 — patients & dashboards
- [x] Phase 3 — doctor profiles/schedules, appointments (double-booking
  impossible via partial unique index + serializable availability check),
  in-app notifications, portal self-service
- [x] Phase 3.1 (`v0.4.1`) — clinic-timezone-aware scheduling: availability,
  conflicts, events, notifications, calendar, detail and portal surfaces all
  read the clinic's wall clock (see `src/lib/timezone.ts`); doctor profile and
  absence administration; slot-grid day view (`/appointments?view=day`)
- [x] Phase 4 — medical records: append-only encounters (editable only while
  OPEN, signing locks the field set), clinical notes and vitals, gated by
  `clinical:view` / `clinical:author` / `vitals:record`; signed visits surface
  in the patient portal
- [x] Phase 5 (`v0.6.0`) — laboratory: clinic test catalog, requests moving
  ORDERED → COLLECTED → COMPLETED → VERIFIED (cancelled from either of the first
  two), a bench queue at `/laboratory` grouped by the step each request needs,
  results on the patient chart and released results in the portal; gated by
  `lab:catalog` / `lab:order` / `lab:collect` / `lab:verify`. Verification is the
  lock (rule 7), so a recheck is a new request; audit rows carry metadata only —
  values, comments, test names and the indication never enter the audit trail.
  Ordered items snapshot the catalog, so editing a test cannot rewrite a result
  that was already reported.
- [ ] Phase 6–9 — pharmacy, billing, reports/AI, hardening
