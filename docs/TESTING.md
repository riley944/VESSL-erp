# Testing with Vitest

Vitest runs the project's automated JavaScript tests. The starter tests cover
quote-tier costs, landed costs, and shipment status helpers.

## Run tests

Install dependencies with `npm install`, then run:

```bash
npm test             # run the full suite once
npm run test:watch   # rerun affected tests as you work; press q to quit
```

Run a single file with `npm test -- tests/landedCost.test.js`. Run `npm test`
and `npm run lint` before opening a pull request. The current tests do not
require Supabase credentials or a network connection.

## Add a test

Place files under `tests/` with names ending in `.test.js`. Import the code
under test using the project's `@/` alias and use Vitest's assertions:

```js
import { describe, expect, it } from 'vitest';
import { effectiveQty } from '@/lib/tierCost';

describe('effectiveQty', () => {
  it('uses the size quantities when provided', () => {
    expect(effectiveQty({ qty: 100, sizeQty: { small: 20, large: 30 } })).toBe(50);
  });
});
```

Test the expected behavior, including important edge cases and regressions.
Keep tests independent of live services; mock external calls when needed.
The runner and alias are configured in `vitest.config.mjs`. It currently uses
Vitest's default Node environment; browser-based component tests will need
additional setup.
