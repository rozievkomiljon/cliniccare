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
| `npm run test:e2e` | Playwright: real login journey against a production server + embedded Postgres |
| `npm run test:smoke` | Boots dev server + probes `/api/health`, `/`, `/login` |
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
seed → tests (against real Postgres/Redis service containers) → build →
E2E auth journey (embedded Postgres + production server).

### E2E database note (Windows)

The E2E suite boots an embedded Postgres automatically. On machines where the
shell runs elevated, PostgreSQL refuses to start (admin token); register the
ephemeral cluster as a service instead and point the suite at it:

```bash
node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe register \
  -N cliniccare-pg-e2e -D .pgdata-e2e -o "-p 54329"
net start cliniccare-pg-e2e
node -e "new (require('pg').Client)({connectionString:'postgresql://cliniccare:cliniccare@127.0.0.1:54329/postgres'}).query('CREATE DATABASE cliniccare_e2e').catch(()=>{}).then(()=>process.exit())"
E2E_DATABASE_URL=postgresql://cliniccare:cliniccare@127.0.0.1:54329/cliniccare_e2e npm run test:e2e
```
