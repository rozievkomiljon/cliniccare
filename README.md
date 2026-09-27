# ClinicCare

A production-oriented **clinic management system** — Next.js App Router,
TypeScript, PostgreSQL + Prisma, Redis, Docker.

## Quick start

```bash
# 1. Infrastructure (Postgres, Redis, MailHog) — requires Docker
docker compose -f docker/compose.yml up -d

# 2. App
cp .env.example .env
npm install
npx prisma migrate deploy   # or: npm run db:migrate:dev
npm run db:seed
npm run dev                 # http://localhost:3000
```

No Docker? The app still boots and serves the landing page and `/health`;
DB-backed features require the Postgres URL to be reachable.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suites |
| `npm run test:smoke` | Boots dev server + probes `/health`, `/`, `/login` |
| `npm run db:migrate:dev` | Create/apply migrations locally |
| `npm run db:seed` | Seed demo clinic + one user per role |

## Seeded users (local dev)

After `npm run db:seed`, every role has a user at `demo-clinic`
(password `ChangeMe_2026!`): `super@`, `admin@`, `reception@`, `doctor@`,
`nurse@`, `lab@`, `pharmacy@`, `accountant@`, `patient@` `...@cliniccare.local`.
Login is wired in Phase 1 — the seed exists so the RBAC data model is
testable from day one.

## Environment

Copy `.env.example` → `.env`. Variables are Zod-validated at boot
(`src/lib/env-schema.ts`); invalid config fails fast with a readable error.

## CI

Every PR runs: install → Prisma generate → lint → typecheck → migrate +
seed → tests (against real Postgres/Redis service containers) → build.
