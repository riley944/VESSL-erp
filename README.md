# VESSL-ERP

VESSL-ERP is the internal operations system for King Universal, a sourcing and
import business. Staff use it to run the work from first quote to delivered goods:
quotes and pricing, the product catalogue, purchase and sales orders, shipments and
freight quotes, compliance testing, and sample tracking. The client-facing portal is
a separate application that shares the same backend.

## Stack

- **Next.js 14** (App Router) and **React 18**
- **Supabase** for the database and staff sign-in
- **Resend** for outgoing email
- **ExcelJS** for spreadsheet export, **lucide-react** for icons
- Hosted on **Vercel**

## Running it locally

You need a current Node.js LTS release and access to the Supabase project.

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

The app runs on **http://localhost:3000** and nowhere else. Before starting, a guard
script (`scripts/dev-port.mjs`) checks that port 3000 is free and ends a leftover dev
server if it finds one, so you never review an old build by mistake.

`.env.example` lists every environment variable the code reads. The browser needs
only the two `NEXT_PUBLIC_` values; the rest are used by the server routes.

Before pushing, run:

```bash
npm run lint
```

## Deployment

The existing Vercel project deploys `main` to production. The intended development
deployment is a separate Vercel project connected to this repository, with
`develop` as its production branch. Pushes to `develop` will then update its stable
production URL. Set this up after the development Supabase project is ready:

1. Create the development Supabase project and provision its schema, policies,
   functions, storage and test users. The SQL history is incomplete in this repo;
   see `sql/README.md` and obtain a current schema separately. Configure Supabase
   Auth URLs for the development deployment.
2. Create a separate Vercel project for this repository and set its production
   branch to `develop`. Keep the existing project on `main`. Configure a stable
   development domain if needed.
3. In the development Vercel project, set `APP_ENV=development` for Production,
   Preview and Development. Set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and, if needed, `SUPABASE_SERVICE_ROLE_KEY` to
   the **development** project's values in each environment. Never reuse production
   Supabase credentials. Redeploy after changing environment variables.
4. Leave `RESEND_API_KEY` unset in development. The app also blocks its email
   routes when `APP_ENV=development`, and on deployments of the `develop` branch.
   Blocked requests return an error rather than claiming an email was sent.
5. Verify the development URL uses the development database and that email requests
   are blocked. Keep other integration credentials separate or unset. Database
   functions, Supabase Auth and the separate client portal can send their own
   messages; configure those independently before enabling them in development.

Vercel cron jobs in `vercel.json` run on each project's production deployment:
the freight-quote and testing digests on Mondays at 13:00 UTC, and shipment
tracking refresh daily at 12:00 UTC. In the development project, email routes are
blocked; leave tracking credentials unset until a separate test integration is
ready. Set a distinct `CRON_SECRET` if testing scheduled routes.

## Layout

| Path | What it holds |
|---|---|
| `app/` | Pages and the main screens (`page.jsx`, `quotes.jsx`, `testing.jsx`, `programs.jsx`, …) |
| `app/components/` | Shared React components |
| `app/api/` | Server routes: sending freight quote requests and the weekly digest |
| `lib/` | Shared helpers — data access, documents and PDFs, spreadsheet export, formatting |
| `public/` | Static assets |
| `scripts/` | Developer tooling (the port-3000 guard) |
| `docs/` | Design notes and the change record |
| `sql/` | Database change scripts, run by hand. Most are kept outside the repository; see `sql/README.md` locally. |
| `archive/` | Data snapshots taken before one-off data fixes |

## Documentation

The `docs/` folder holds the working notes behind the code:

- [`docs/CATALOGUE.md`](docs/CATALOGUE.md) — the product catalogue and the record
  of data and schema changes
- [`docs/PLM.md`](docs/PLM.md) — the sample lifecycle board (shown to users as Samples)
- [`docs/PORTAL.md`](docs/PORTAL.md) — how the ERP and the client portal fit together
- [`docs/RFQ-SEND.md`](docs/RFQ-SEND.md) — sending freight quote requests and the
  weekly digest

## Licence

Proprietary internal software of King Universal. Not open source; no licence is
granted to use, copy or distribute it.
