#!/usr/bin/env node
// ── predev guard: this project develops on :3000 and nowhere else ─────────────
//
// WHY THIS EXISTS. `next dev` falls back to 3001, then 3002, when 3000 is taken,
// and says so in one line of startup noise that is easy to miss. The failure that
// causes is not "the server is on the wrong port" -- it is that a STALE server is
// still answering on 3000, serving code from an earlier session against the same
// production database, and the person reviewing localhost:3000 sees the old build
// with nothing to tell them so. Twice in one session that stale server was read
// as a successful compile.
//
// A port flag does not fix it: `next dev -p 3000` still falls back. The port has
// to be free before Next starts, so the check belongs in predev.
//
// KILLS ONLY NODE. A leftover `next dev` is safe to end -- it is ours, and the
// worst case is losing a terminal nobody was reading. Anything else on 3000 is
// somebody's actual service, so this refuses and tells the human what it found
// rather than deciding for them.
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.PORT || 3000);
const WIN = process.platform === 'win32';

const free = (port) => new Promise((resolve) => {
  const s = createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  // 0.0.0.0, not localhost: a server bound to one and not the other still takes
  // the port for Next's purposes, and a check that misses it defeats the guard.
  s.listen(port, '0.0.0.0');
});

const sh = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }); }
  catch { return ''; }
};

const pidsOn = (port) => {
  const out = WIN
    ? sh('netstat', ['-ano'])
    : sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (WIN) {
      if (!/LISTENING/.test(line)) continue;
      if (!new RegExp(`[:.]${port}\\s`).test(line)) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    } else {
      const m = line.match(/^\S+\s+(\d+)/);
      if (m) pids.add(m[1]);
    }
  }
  return [...pids];
};

const nameOf = (pid) => {
  if (WIN) {
    const out = sh('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    const m = out.match(/^"([^"]+)"/m);
    return m ? m[1] : '';
  }
  return sh('ps', ['-p', pid, '-o', 'comm=']).trim();
};

const isNode = (name) => /^node(\.exe)?$/i.test(name);

const kill = (pid) => WIN ? sh('taskkill', ['/PID', pid, '/F']) : sh('kill', ['-9', pid]);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Ports Next would fall back to. Reported but never killed silently -- a server
// on 3001 is not in this run's way, and a person may be using it on purpose.
const FALLBACKS = [3001, 3002];

const main = async () => {
  if (await free(PORT)) {
    for (const p of FALLBACKS) {
      if (!(await free(p))) console.log(`  note: something is also listening on :${p} — not touched, but :3000 is the only port this project reviews on.`);
    }
    return;
  }

  const pids = pidsOn(PORT);
  if (!pids.length) {
    console.error(`\n  Port ${PORT} is in use and the owning process could not be identified.`);
    console.error(`  Free it by hand, then run npm run dev again.\n`);
    process.exit(1);
  }

  for (const pid of pids) {
    const name = nameOf(pid) || '(unknown)';
    if (!isNode(name)) {
      console.error(`\n  Port ${PORT} is held by PID ${pid} (${name}), which is not a node process.`);
      console.error(`  Refusing to kill it. Stop it yourself, or free the port, then run npm run dev again.\n`);
      process.exit(1);
    }
    console.log(`  Port ${PORT} held by a stale node process (PID ${pid}) — ending it.`);
    kill(pid);
  }

  // Give the OS a moment to release the socket before Next tries to bind it.
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    if (await free(PORT)) { console.log(`  Port ${PORT} is free.`); return; }
  }

  console.error(`\n  Port ${PORT} is still in use after ending PID(s) ${pids.join(', ')}.`);
  console.error(`  Free it by hand, then run npm run dev again.\n`);
  process.exit(1);
};

main();
