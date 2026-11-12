# VESSL ERP Local Dev Setup Guide (Docker Route).

These are the steps that got a staff user logged in at `localhost:3000` (or whatever local port) against a Supabase running in Docker, with no connection to the production or develop projects. Every step below was run today. The one place I recommend a different order from what I ran is marked.

## Before you start

- Docker Desktop running. On Windows it needs WSL 2.
- Node and npm. The CLI runs through `npx supabase`, so nothing is added to `package.json`.
- A `psql` client, for loading the schema file.
- Make sure you have at least several GB of free RAM for the docker download if you want to go the docker route.
- A schema-only dump of the `vessl`, `portal` and `public` schemas. The repo has no baseline yet, so this currently comes from a pull or a `pg_dump --schema-only` of the develop project.

## 1. Start the stack and load the schema

From the repo root:

```bash
npx supabase init
npx supabase start -x logflare,vector
```

Excluding `logflare` and `vector` saves memory and the app does not need them. Then load the schema:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 -f <your-schema-file>.sql
```

Three things the schema file needed before it would load into a fresh Supabase database:

- Remove `CREATE SCHEMA public;` because that schema already exists.
- Add `CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA vessl;` straight after `CREATE SCHEMA vessl;`. Two email columns use `vessl.citext`, and `pg_dump` leaves extensions out.
- Remove the `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` lines. The `postgres` role cannot run them.

Also add `CREATE EXTENSION IF NOT EXISTS pg_net;` since three functions call `net.http_post`.

## 2. Expose vessl and portal to the API

A local stack only exposes `public`. The app reads from `vessl` and `portal`, so without this the staff lookup fails for every login. In `supabase/config.toml`:

```toml
[api]
schemas = ["public", "graphql_public", "vessl", "portal"]
```

Then restart so the API picks it up:

```bash
npx supabase stop
npx supabase start -x logflare,vector
```

Order matters here. I set the schemas before loading the schema file, and the first `supabase start` failed: the API health check returns 503 while `vessl` does not exist. I got past it with `--ignore-health-check`. Loading the schema first, as written above, avoids the problem; that order was verified from an empty stack on 12 Nov, with every start passing its health check.

## 3. Create a staff login

### Auth user

Open local Studio at `http://127.0.0.1:54323`, then Authentication, Users, Add user, Create new user. Use an `@kinguniversal.com` email and tick Auto Confirm User.

The domain is required in two places: `isStaffEmail` in `lib/access.js` rejects any other address at sign-in, and the restrictive `kui_staff_only` policies call `portal.is_kui_staff()`, which checks the domain in the JWT. Outside email address cannot get in whatever is in the database, it needs to be a @kinguniversal.com address.

### Staff profile

In Studio’s SQL Editor, after the auth user exists:

```sql
insert into vessl.staff_profiles
  (email, full_name, role, hide_financials, can_see_analytics,
   notifications_enabled, auth_user_id)
select u.email, 'Joel Harris', 'staff', false, true, true, u.id
from auth.users u
where lower(u.email) = 'joel@kinguniversal.com'
on conflict (email) do nothing;
```

This inserts nothing, without an error, if the auth user is missing. Studio’s SQL Editor shows "Success. No rows returned" whether or not a row was inserted, so the select below is the real check. Confirm the row is there and linked:

```sql
select email, role, auth_user_id from vessl.staff_profiles;
```

### Triggers on auth.users (optional)

Production has two triggers on `auth.users`. They sit outside the three dumped schemas, so they do not come across. The insert above sets `auth_user_id` directly and does not need them, but later sign-ups will only link automatically if they exist:

```sql
create trigger link_staff_user
  after insert or update of email on auth.users
  for each row execute function vessl.link_staff_on_signin();

create trigger trg_new_auth_user
  after insert on auth.users
  for each row execute function portal.handle_new_auth_user();
```

## 4. Point the app at the local stack

Optionally, keep a copy of your current `.env.local` first (the `cp` line below), so you can switch back later. Both files are covered by the `.env*` rule in `.gitignore`.

```bash
cp .env.local .env.local.prod
npx supabase status -o env
```

In `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`: the anon and service-role keys from the status output.
- Comment out `RESEND_API_KEY`, `SHIPSGO_API_KEY`, `SHIPSGO_WEBHOOK_SECRET` and `SHIPSGO_AIR_WEBHOOK_SECRET`, so a local run cannot send real email or spend tracking credits.

Nothing fails at startup with those four unset. The five email routes and three tracking routes return a 500 "not configured" when called. Next.js reads `.env.local` only at startup, so if the dev server is already running, stop it and start it again after editing the file. Then:

```bash
npm run dev
```

Log in at `http://localhost:3000` with the local user. You should land in an empty app.

## 5. Check it

```sql
select table_schema, count(*) from information_schema.tables
where table_schema in ('vessl','portal','public')
  and table_type = 'BASE TABLE'
group by 1 order by 1;
```

Expect portal 9, public 5, vessl 75. Through the REST API the grants behave as they do on production: `anon` gets 401 on `vessl`, `service_role` gets 403 on `vessl` tables because it has schema usage but no table grants, and `authenticated` gets 200.

## If you get "This account doesn’t have access to the staff app"

| Cause | Fix |
|---|---|
| Email is not `@kinguniversal.com` | Create the user with a KUI address. No database change gets another domain in. |
| No auth user in the local database | Step 3. A local stack starts with no users, so logins from other projects do not exist here. |
| No `vessl.staff_profiles` row | Run the insert in step 3, then the select to confirm it. |
| `vessl` and `portal` not exposed | Step 2, then stop and start the stack. |
| App is pointed at a different project | Check `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` and restart the dev server. |

## Day to day (Recommended)

- Start: Docker Desktop, then `npx supabase start -x logflare,vector`, then `npm run dev`.
- Stop: `npx supabase stop`. The local data is kept.
- Back to the previous setup: copy `.env.local.prod` over `.env.local` and restart the dev server.
