import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../.eslintrc.cjs') as { root?: boolean };

describe('ESLint project boundary', () => {
  test('stops config lookup before a nested worktree reaches the parent repository', () => {
    expect(config.root).toBe(true);
  });
});
