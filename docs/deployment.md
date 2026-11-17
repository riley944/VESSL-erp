# Deployment setup

Pushes to `develop` deploy the develop environment; pushes to `main` deploy
production. The workflow installs dependencies, runs `npm test`, builds using
Vercel's environment settings, applies pending Supabase migrations, and deploys
the prebuilt app. A failed step stops the deployment and sends a link to the
GitHub Actions run to Slack.

## One-time setup

1. Create separate Vercel projects and Supabase projects for develop and
   production. Configure each Vercel project's production environment variables
   and domain for its corresponding Supabase project. The develop project uses
   Vercel's **production** target so it has a stable domain; it is still a
   separate project from the production app. Vercel cron jobs in `vercel.json`
   also run on that target, so configure the develop project's integrations and
   data accordingly.
2. Disable Git-triggered Vercel deployments for both projects in Vercel's Git
   settings. GitHub Actions must be the only deployment path for these branches,
   otherwise Vercel can deploy before tests and migrations finish.
3. In GitHub, create environments named `develop` and `production`. Add these
   **environment secrets** to each, using the values for that environment:

   | Secret | Value |
   | --- | --- |
   | `VERCEL_TOKEN` | Vercel access token with access to the project |
   | `VERCEL_ORG_ID` | Vercel team or personal account ID |
   | `VERCEL_PROJECT_ID` | ID of that environment's Vercel project |
   | `SUPABASE_ACCESS_TOKEN` | Supabase personal access token with access to the project |
   | `SUPABASE_PROJECT_REF` | That environment's Supabase project reference |
   | `SUPABASE_DB_PASSWORD` | Database password for that project |

4. Create a Slack incoming webhook for `#vessl-deployments` and save its URL as
   the **repository secret** `SLACK_WEBHOOK_URL`. The notification job does not
   use environment secrets. Check its logs if delivery to Slack fails.
5. Before the first deploy, compare the migration history and schema on **each**
   Supabase project with `supabase/migrations/`. The repository does not contain
   the original schema baseline and its empty `missing_history` migration is not
   a schema. Resolve any history or schema differences using Supabase's migration
   tools before enabling the pipeline. Never mark a migration applied unless its
   changes are already present. Only files in `supabase/migrations/` are applied;
   older scripts in `sql/` are not.
6. Push to `develop` and confirm the Actions run, database migration history,
   Vercel domain and app all work. Confirm Slack delivery with a controlled failed
   workflow before relying on notifications. Then configure and verify production.

Migrations run after the build and before deployment. A failed deployment after a
successful migration leaves the database changes in place, so migrations must be
compatible with the currently running app. The SQL pgTAP tests require an existing
VESSL schema and are not run by this workflow; add a reproducible schema baseline
and isolated test database before enabling them in CI. GitHub serializes active
deployments per branch; if several pushes queue up, GitHub may replace an older
pending run with a newer one.
