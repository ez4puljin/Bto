// React Native 0.86 runs only with the React it was built for (19.2.3, installed in apps/mobile),
// while the web's React 19.3.0 is hoisted at the workspace root (ADR-0061 #3). Every import of
// react or react-native, from anywhere in the bundle, is resolved as if apps/mobile asked for it.
const path = require('node:path');

const PINNED = /^(react|react-native)(\/.*)?$/;

/**
 * Wraps Metro's resolver: pinned names resolve from `projectRoot`; everything else as usual.
 * `next` is an earlier custom resolver, if any; otherwise Metro's own (`context.resolveRequest`).
 */
function pinToApp(projectRoot, next) {
  const origin = path.join(projectRoot, 'package.json');
  return (context, moduleName, platform) => {
    const resolve = next ?? context.resolveRequest;
    return PINNED.test(moduleName)
      ? resolve({ ...context, originModulePath: origin }, moduleName, platform)
      : resolve(context, moduleName, platform);
  };
}

module.exports = { PINNED, pinToApp };
