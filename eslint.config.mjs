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
    },
    rules: {
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
