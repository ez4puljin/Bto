// Metro for the pnpm workspace (ADR-0061 #3): watch the whole workspace, look in apps/mobile's
// node_modules first, read @tugeel/shared from source (ADR-0025 #4), keep React Native on its own
// React and skip folders that are not app code.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { pinToApp } = require('./scripts/metro-pin.cjs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const under = (...parts) => new RegExp(`^${escape(path.join(workspaceRoot, ...parts))}[\\\\/].*`);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_conditionNames = [
  '@tugeel/source',
  ...(config.resolver.unstable_conditionNames ?? []),
];
config.resolver.blockList = [
  ...[config.resolver.blockList ?? []].flat(),
  under('.claude'),
  under('apps', 'api'),
  under('apps', 'web'),
  under('tmp'),
  under('.data'),
  under('apps', 'mobile', 'android'),
  under('apps', 'mobile', 'build'),
];
config.resolver.resolveRequest = pinToApp(projectRoot, config.resolver.resolveRequest);

module.exports = config;
