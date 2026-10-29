// ── READING A PDF WITH CLAUDE, FOR A ROUTE ──────────────────────────────────
// The parts every "import from PDF" route shares, lifted out of
// app/api/quotes/extract so the sales order route (app/api/orders/extract) uses
// the same gate, the same PDF handling and the same model call rather than a
// copy that drifts. Each route keeps only its prompt, its schema and what it
// does with the answer.
//
// runExtract(req, opts) does, in order -- and stops at the first that fails,
// returning { response } for the route to return as it is:
//   1 the server is configured (Anthropic key, Supabase URL and anon key);
//   2 the caller: the Supabase session in the bearer token, staff only. The
//     token goes ON the client, so every read the route makes afterwards --
//     the bucket, companies, codes -- runs as the caller under RLS;
//   3 the PDF: multipart `file` up to opts.directMaxBytes (Vercel caps a request
//     body at 4.5 MB), or JSON { path } in opts.bucket, read back AS THE CALLER
//     so the bucket policy decides; then the size cap and the %PDF- magic;
//   4 Claude reads it with structured output (opts.schema), falling back
//     server-side if the model declines; a refusal that survives the chain, or
//     a reply cut off at max_tokens, is reported rather than parsed.
// On success it returns { sb, out, msg }: the caller's client, the parsed answer
// and the raw message (model, usage).
//
// It WRITES NOTHING, and neither should a route built on it: the form decides
// what to apply, and nothing is saved until somebody presses Save.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

export const EXTRACT_MODEL = 'claude-opus-5-5';

export const json = (body, status) => Response.json(body, { status });

const isStaffEmail = (email) =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');

export async function runExtract(req, { bucket, pathRe, maxBytes, directMaxBytes, system, schema, prompt, maxTokens = 16000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey || !url || !anon) return { response: json({ ok:false, error:'Server is not configured to read PDFs.' }, 500) };

  // ── 1. WHO IS CALLING ──────────────────────────────────────────────────────
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return { response: json({ ok:false, error:'Not signed in.' }, 401) };
  const sb = createClient(url, anon, {
    db:{ schema:'vessl' },
    auth:{ persistSession:false, autoRefreshToken:false },
    global:{ headers:{ Authorization: 'Bearer '+token } },
  });
  const { data:{ user }, error:authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { response: json({ ok:false, error:'Session is not valid.' }, 401) };
  if (!isStaffEmail(user.email)) return { response: json({ ok:false, error:'Not authorised.' }, 401) };

  // ── 2. THE PDF ─────────────────────────────────────────────────────────────
  let bytes;
  const ctype = req.headers.get('content-type') || '';
  if (ctype.startsWith('multipart/form-data')) {
    let form;
    try { form = await req.formData(); } catch { return { response: json({ ok:false, error:'Malformed upload.' }, 400) }; }
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return { response: json({ ok:false, error:'No file given.' }, 400) };
    if (file.size > directMaxBytes) return { response: json({ ok:false, error:'Too large to send directly; upload it first and send its path.' }, 413) };
    bytes = Buffer.from(await file.arrayBuffer());
  } else {
    let body;
    try { body = await req.json(); } catch { return { response: json({ ok:false, error:'Malformed request.' }, 400) }; }
    const path = body && typeof body.path === 'string' ? body.path : '';
    if (!pathRe.test(path)) return { response: json({ ok:false, error:'No valid PDF path given.' }, 400) };
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error || !data) return { response: json({ ok:false, error:'That PDF could not be read from storage.' }, 404) };
    bytes = Buffer.from(await data.arrayBuffer());
  }
  if (bytes.length > maxBytes) return { response: json({ ok:false, error:'PDF is larger than 25 MB.' }, 413) };
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { response: json({ ok:false, error:'That file is not a PDF.' }, 400) };

  // ── 3. CLAUDE READS IT ─────────────────────────────────────────────────────
  // fallbacks "default": if the model declines, the API re-runs the request on
  // its recommended fallback inside this same call. A refusal that survives the
  // whole chain still arrives as stop_reason "refusal" and is handled below.
  const client = new Anthropic({ apiKey });
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } },
          { type: 'text', text: prompt },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { response: json({ ok:false, error:'The PDF reader is busy; try again in a minute.' }, 429) };
    if (e instanceof Anthropic.BadRequestError) return { response: json({ ok:false, error:'The PDF could not be read (' + (e.message || 'bad request') + ').' }, 422) };
    if (e instanceof Anthropic.APIError) return { response: json({ ok:false, error:'The PDF reader failed (' + (e.status || 'error') + ').' }, 502) };
    return { response: json({ ok:false, error:'Could not reach the PDF reader.' }, 502) };
  }
  if (msg.stop_reason === 'refusal') return { response: json({ ok:false, error:'The PDF reader declined this document.' }, 422) };
  if (msg.stop_reason === 'max_tokens') return { response: json({ ok:false, error:'The PDF was too long to read in one go.' }, 422) };
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { return { response: json({ ok:false, error:'The PDF reader answered in an unexpected shape.' }, 502) }; }
  return { sb, out, msg };
}

// ── SMALL HELPERS BOTH ROUTES USE ────────────────────────────────────────────
// The fields array back into { name: { value, confidence, evidence, page } }.
// Unknown names and empty values are dropped; the first entry for a name wins.
export function fieldsFrom(list) {
  const out = {};
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.field !== 'string' || out[e.field]) continue;
    const value = String(e.value ?? '').trim();
    if (!value) continue;
    out[e.field] = { value, confidence: e.confidence || 'medium', evidence: String(e.evidence || ''), page: Number(e.page) || 0 };
  }
  return out;
}

// "1,250.50" or "$0.85/pc" -> a number; null when there is none.
export const toNum = (s) => {
  const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// Company names compared without the words every company name carries --
// lib/companyName.js, where the quote form can import it too.
export { normName } from '@/lib/companyName';
// An email's domain, or '' for a free mailbox that says nothing about the company.
export const domainOf = (email) => {
  const d = String(email || '').toLowerCase().split('@')[1] || '';
  return /^(gmail|qq|163|126|yahoo|hotmail|outlook|foxmail|sina)\./.test(d) ? '' : d;
};
