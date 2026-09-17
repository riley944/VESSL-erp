// Minimal on purpose. This is not a style pass -- there is no formatting rule
// here, nothing about semicolons or quotes, and no plugin. It exists for ONE
// class of bug: an identifier that reads like a local, resolves to a browser
// global, and therefore never errors.
//
// That is not hypothetical. A deleted `const open = openId === r.id` left two
// handlers reading `open`, which resolved to window.open -- a function, so always
// truthy -- and every PLM card click evaluated setOpenId(null). No throw, no
// console output, nothing to search for: a valid reference to a real global doing
// exactly what it says. It shipped, and it took a bug report to find.
//
// no-undef cannot catch this, because these names ARE defined. Only
// no-restricted-globals sees them, and only if they are named explicitly.

// ── THE SECOND CLASS: READ ABOVE ITS OWN DECLARATION ────────────────────────
// Shipments crashed in production with "Cannot access 'q' before
// initialization" -- 'q' being what the minifier called QF_DEFAULT. The stage-2
// filter conversion moved `usePageState('shipments', { qSel: QF_DEFAULT })` up
// to sit with the other useState calls, and it crossed over the `const
// QF_DEFAULT` fourteen lines below it. Valid JavaScript, compiles clean, throws
// on every single render.
//
// WHY NOT no-use-before-define. Because it reports 299 of these and 278 are
// fine: quotes.jsx components reference the module's S style object, declared
// at the bottom of the file, from inside their own bodies -- which run long
// after the module finished evaluating. A rule that cries 299 times to catch
// once is a rule somebody turns off.
//
// THE REAL TEST IS NOT POSITION, IT IS EXECUTION PASS. A reference is fatal
// only when no function boundary sits between it and the declaration: same
// pass, so the binding is still in its temporal dead zone when the reference
// runs. Cross a function boundary and the reference is deferred to a call that
// happens later, which is every one of the 278. That is the whole rule.
const tdzSameScope = {
  meta: {
    type: 'problem',
    docs: { description: 'A const or let read above its own declaration, in the same execution pass.' },
    schema: [],
  },
  create(ctx) {
    // Climb from the reference towards the declaration's scope. Arriving means
    // same pass; hitting a function or class on the way means deferred.
    const samePass = (from, target) => {
      for (let s = from; s; s = s.upper) {
        if (s === target) return true;
        if (s.type === 'function' || s.type === 'class') return false;
      }
      return false;
    };
    const walk = scope => {
      for (const v of scope.variables) {
        const def = v.defs[0];
        // Only let and const have a dead zone. A var reads as undefined, which
        // is a different bug and not this one. Function declarations hoist.
        if (!def || def.type !== 'Variable' || def.parent.kind === 'var') continue;
        const declaredAt = def.name.range[0];
        for (const ref of v.references) {
          if (ref.identifier.range[0] >= declaredAt) continue;
          if (!samePass(ref.from, v.scope)) continue;
          ctx.report({
            node: ref.identifier,
            message: `'${v.name}' is read here but declared below it in the same scope. `
                   + 'At runtime that is a ReferenceError on every pass, not undefined. Move the declaration above this line.',
          });
        }
      }
      scope.childScopes.forEach(walk);
    };
    return { 'Program:exit'(node) { walk(ctx.sourceCode.getScope(node)); } };
  },
};

export default [
  {
    files: ['app/**/*.{js,jsx}', 'lib/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      // Declared by hand rather than pulled from the `globals` package, to keep
      // this config dependency-free. Everything here is something the app really
      // uses; anything missing shows up as a no-undef error naming it, which is
      // a one-line fix rather than a mystery.
      globals: Object.fromEntries([
        'window','document','navigator','location','history','screen',
        'console','fetch','Headers','Request','Response','FormData','Blob','File','FileReader',
        'URL','URLSearchParams','AbortController','TextEncoder','TextDecoder',
        'localStorage','sessionStorage','indexedDB',
        'setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask',
        'requestAnimationFrame','cancelAnimationFrame',
        'alert','confirm','prompt','atob','btoa','structuredClone','crypto',
        'Image','Audio','Event','CustomEvent','MutationObserver','ResizeObserver','IntersectionObserver',
        'Element','HTMLElement','Node','DOMParser','getComputedStyle',
        'process','Buffer','globalThis','React',
      ].map(k => [k, 'readonly'])),
    },
    // Defined inline, above, rather than installed. It is twenty lines and it
    // belongs to this repo's history, not to npm.
    plugins: { local: { rules: { 'tdz-same-scope': tdzSameScope } } },
    rules: {
      // Reads above their own declaration. See the note above the rule.
      'local/tdz-same-scope': 'error',
      // THE SIBLING RULE, and the one that catches the other half of this class.
      // no-restricted-globals catches a deleted local that resolves to a real
      // browser global; no-undef catches a reference that resolves to nothing at
      // all -- which is how a row marker shipped reading orderedIds inside a
      // component that never received it. It threw at render, on a tab nobody
      // had opened yet, rather than at build.
      'no-undef': 'error',
      'no-restricted-globals': ['error',
        { name: 'open',   message: 'window.open. Did you mean a local named open? Rename the local or write window.open explicitly.' },
        { name: 'close',  message: 'window.close. Did you mean a local? Rename it or write window.close explicitly.' },
        { name: 'name',   message: 'window.name, which is a string. Did you mean a local named name?' },
        { name: 'status', message: 'window.status, which is a string. Did you mean a local named status?' },
        { name: 'length', message: 'window.length, the frame count. Did you mean something.length?' },
        { name: 'event',  message: 'window.event, the legacy global. Use the handler argument instead.' },
      ],
    },
  },
];
