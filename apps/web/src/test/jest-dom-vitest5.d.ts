// Workaround for testing-library/jest-dom#738: jest-dom 7.0.1 types target the Vitest 4 Assertion<T>
// signature, so its matchers are missing under Vitest 5. Delete this file when the fix (PR #742) ships.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Matchers<R, T> extends TestingLibraryMatchers<T, R> {}
}
