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

## Layout

- `src/app/` — routes (pages, layouts, route handlers)
- `src/features/<module>/` — module code (schemas, services, components)
- `src/lib/` — db, env, logger, rbac, errors, utils
- `prisma/` — schema, migrations, seed
- `docker/` — compose files; `Dockerfile` builds the production image
- `tests/` — vitest suites + local smoke script

## Phase status

- [x] Phase 0 — bootstrap
- [x] Phase 1 — auth (Auth.js v5 DB sessions, argon2id), RBAC enforcement
  (`requirePermission`), staff management, audit viewer, role dashboards
- [ ] Phase 2 — patients & dashboards
- [ ] Phase 3 — scheduling & appointments
- [ ] Phase 4 — medical records (MVP complete)
- [ ] Phase 5–9 — laboratory, pharmacy, billing, reports/AI, hardening
