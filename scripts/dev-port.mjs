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

// Busy only when something actually holds the address. Any other bind error --
// EADDRNOTAVAIL for ::1 on a machine without IPv6 -- means nothing can be
// listening there, so it must not read as "in use".
const freeOn = (port, host) => new Promise((resolve) => {
  const s = createServer();
  s.once('error', (e) => resolve(!['EADDRINUSE', 'EACCES'].includes(e.code)));
  s.once('listening', () => s.close(() => resolve(true)));
  // host null means no host argument at all: Node binds :: in dual-stack mode.
  if (host === null) s.listen(port); else s.listen(port, host);
});

// TEST THE PORT THE WAY NEXT BINDS IT, AND EVERY WAY A STALE SERVER MIGHT.
// `npm run dev` is `next dev -H 127.0.0.1`, so Next binds 127.0.0.1 alone, and
// that is probed first. On Windows a bind on one address can SUCCEED while
// another process holds the same port on a different one -- this guard once
// probed 0.0.0.0 alone, reported a stale server on :: as "port free", and Next
// died with EADDRINUSE while localhost:3000 kept answering 200 from the stale
// process. So every address that localhost:3000 could reach is probed too:
//   ::1      the browser tries it first for "localhost"; a stale server there
//            would answer instead of ours
//   ::       a server from before 5 Oct 2026, bound with no host (all of IPv6
//            and, dual-stack, IPv4)
//   0.0.0.0  a server bound to all of IPv4 only
// The port counts as busy if any of them refuses.
const free = async (port) => {
  for (const host of ['127.0.0.1', '::1', null, '0.0.0.0']) {
    if (!(await freeOn(port, host))) return false;
  }
  return true;
};

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
