# Supabase migration workflow

- Run these commands from the project root with local Supabase running.
- Create a timestamped migration:

  ```bash
  npx --no-install supabase migration new describe_your_change
  ```

- Add the SQL to the new file in `supabase/migrations/`. These are migrations, so do not end them with `ROLLBACK`.
- Apply pending migrations to **local Supabase**:

  ```bash
  npx --no-install supabase migration up
  ```

- Check migration history:

  ```bash
  npx --no-install supabase migration list
  ```

- Verify the resulting tables and constraints locally. Supabase records applied migrations, so repeating `migration up` applies only pending files.
- Keep applied migration files unchanged; make a new migration for later changes. Commit the migration file alongside the application code that needs it.
- Local migrations do not update production. Review the pending migration and target before deploying to a remote project.
- The older files in `sql/` are manual scripts; `migration up` reads `supabase/migrations/` instead.
