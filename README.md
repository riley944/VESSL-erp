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

Vercel deploys automatically from `main`: every push to `main` goes to production.
There are no feature branches. Two weekly Vercel cron jobs (`vercel.json`) run on
Mondays at 13:00 UTC: the freight-quote digest and the testing digest.

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
- [`docs/PLM.md`](docs/PLM.md) — the sample lifecycle board (shown to users as SLM)
- [`docs/PORTAL.md`](docs/PORTAL.md) — how the ERP and the client portal fit together
- [`docs/RFQ-SEND.md`](docs/RFQ-SEND.md) — sending freight quote requests and the
  weekly digest

## Licence

Proprietary internal software of King Universal. Not open source; no licence is
granted to use, copy or distribute it.
