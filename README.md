# Nomchael Construction ERP

TypeScript monorepo for construction project management, quotations, finance, stock, suppliers, employees, WhatsApp, Epson receipts, and Pastel-style reports.

## Stack

- **API**: NestJS + Prisma + Supabase Postgres (`apps/api`)
- **Web**: Next.js App Router (`apps/web`)
- **Shared**: enums and stage templates (`packages/shared`)
- **Database**: Supabase (PostgreSQL) via Prisma `DATABASE_URL` + `DIRECT_URL`

## Quick start (Supabase)

1. In Supabase: **Project Settings → Database**, copy:
   - **Transaction pooler** URI → `DATABASE_URL` (add `?pgbouncer=true` if missing; port `6543`)
   - **Direct / Session** URI → `DIRECT_URL` (port `5432`, used by Prisma migrate)

2. Put both into [`apps/api/.env`](apps/api/.env) (see [`.env.example`](.env.example)).

3. Install and push schema:

```bash
npm install
npm run build --workspace=@nomchael/shared
cd apps/api
npx prisma generate
npx prisma db push
npm run prisma:seed
cd ../..
```

4. Run API and web (two terminals):

```bash
npm run dev:api
npm run dev:web
```

- Web: http://localhost:3000
- API: http://localhost:3001/api

### Default logins (password `admin123`)

| Email | Role |
|-------|------|
| admin@nomchael.local | SUPER_ADMIN |
| md@nomchael.local | MANAGING_DIRECTOR |
| accounts@nomchael.local | ACCOUNTANT |
| pm@nomchael.local | PROJECT_MANAGER |
| clerk@nomchael.local | SITE_CLERK |

## Integrations

Copy `.env.example` values into `.env` / `apps/api/.env`:

- `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` for Meta Cloud API
- `EPSON_PRINTER_HOST` + `EPSON_PRINTER_PORT` (default 9100) for ESC/POS

Without these, WhatsApp and Epson calls run in stub/log mode so local development still works.
