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
    rules: {
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
