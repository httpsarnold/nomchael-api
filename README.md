# Nomchael API

NestJS + Prisma backend for Nomchael Construction ERP.

## Local

```bash
cp .env.example .env
npm install
npx prisma db push
npm run prisma:seed
npm run dev
```

API: `http://localhost:3001/api`

## Railway

1. New project from this repo
2. Add Postgres (or point `DATABASE_URL` / `DIRECT_URL` at Supabase)
3. Set env vars from `.env.example` (`JWT_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `COMPANY_NAME`, …)
4. Build: `npm run build`
5. Start: `npm run start:prod`
6. Root directory: repo root

CORS is open for browser clients. Set `NEXT_PUBLIC_API_URL` on the web service to this API’s public URL.
