// @ts-check
/** Three projects, always selected one at a time (see package.json scripts). */

/** @type {import('jest').Config} */
const common = {
  rootDir: __dirname,
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  // Tests run the TypeScript source of workspace packages (ADR-0025); runtime uses the built dist.
  moduleNameMapper: {
    '^@tugeel/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@tugeel/shared/(money|errors|auth|settings|time|phone)$':
      '<rootDir>/../../packages/shared/src/$1/index.ts',
  },
};

/** @param {'integration' | 'integrity'} project */
const withDatabase = (project) => ({
  globalSetup: '<rootDir>/test/harness/global-setup.ts',
  setupFiles: [`<rootDir>/test/harness/env.${project}.ts`],
  setupFilesAfterEnv: ['<rootDir>/test/harness/after-env.ts'],
});

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    { ...common, displayName: 'unit', roots: ['<rootDir>/src'], testMatch: ['**/*.spec.ts'] },
    {
      ...common,
      ...withDatabase('integration'),
      displayName: 'integration',
      roots: ['<rootDir>/test/integration'],
      testMatch: ['**/*.int-spec.ts'],
    },
    {
      ...common,
      ...withDatabase('integrity'),
      displayName: 'integrity',
      roots: ['<rootDir>/test/integrity'],
      testMatch: ['**/*.spec.ts'],
    },
  ],
};
