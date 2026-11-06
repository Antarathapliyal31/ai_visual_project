// STUB (owner: D) — created by A so collision tests run; replace freely.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 120_000,
  },
});
