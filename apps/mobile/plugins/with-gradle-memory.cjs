// Expo config plugin: `expo prebuild` writes a Gradle limit of 2 GiB of heap and 512 MiB of metaspace.
// On 2026-11-07 the Kotlin compile of the native modules ran out of that metaspace twice in a row
// (`OutOfMemoryError: Metaspace` in compileReleaseKotlin), with 5 GB free on the machine.
const { withGradleProperties } = require('expo/config-plugins');

const JVM_ARGS = 'org.gradle.jvmargs';
const VALUE = '-Xmx3072m -XX:MaxMetaspaceSize=1024m';

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === JVM_ARGS),
    );
    mod.modResults.push({ type: 'property', key: JVM_ARGS, value: VALUE });
    return mod;
  });
};
