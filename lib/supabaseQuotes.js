import { createClient } from '@supabase/supabase-js';

// Same Supabase project + same login as the ERP (lib/supabase.js),
// but pointed at the PUBLIC schema where the migrated quotes data lives.
// The ERP's main client (SB) stays locked to the `vessl` schema and is
// left completely untouched.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const SBQ = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  // no `db.schema` override -> defaults to public, where quotes live
});
