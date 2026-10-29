// Node module hooks for running the app's own lib/ and app/ code outside Next,
// for scripts such as sheet-snapshot.mjs. Registered with module.register().
//
//   resolve  '@/x' is the repo root, as in jsconfig.json; a specifier with no
//            extension tries .js, .jsx, .mjs and /index.js, as webpack does.
//   load     the repo's own .js and .jsx (never node_modules) are compiled with
//            Next's bundled SWC -- JSX to react/jsx-runtime, ES modules kept.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const { transformSync } = require('next/dist/build/swc');

const withExt = (p) => {
  if (existsSync(p) && !/\/$/.test(p) && /\.[cm]?jsx?$/.test(p)) return p;
  for (const e of ['.js', '.jsx', '.mjs', '/index.js', '/index.jsx']) if (existsSync(p + e)) return p + e;
  return null;
};

export async function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith('@/')) target = withExt(join(ROOT, specifier.slice(2)));
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.startsWith('file:')) {
    const parent = fileURLToPath(context.parentURL);
    if (!parent.includes('node_modules')) target = withExt(resolvePath(dirname(parent), specifier));
  }
  if (target) return { url: pathToFileURL(target).href, shortCircuit: true, format: 'module' };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:')) {
    const file = fileURLToPath(url);
    if (!file.includes('node_modules') && file.startsWith(ROOT) && /\.jsx?$/.test(file)) {
      const out = transformSync(readFileSync(file, 'utf8'), {
        filename: file,
        jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' },
        module: { type: 'es6' },
      });
      return { format: 'module', source: out.code, shortCircuit: true };
    }
  }
  return next(url, context);
}
