// Expo config plugin (ADR-0061 #2): on Windows, ninja stops at file names of 260 characters, and
// CMake names an object file after its source's full path (react-native-gesture-handler's shadow
// nodes reach 350). Past CMAKE_OBJECT_PATH_MAX, CMake replaces the leading directories with a
// 32-character hash, but only when the hash and the file name still fit: the object directory of
// that codegen target is 172 characters in the C:\Android\m mirror (174 for armeabi-v7a) and its
// longest file name 40, so the limit must be at least 247. 250 keeps every path under 260.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// bto: CMAKE_OBJECT_PATH_MAX';
const OBJECT_PATH_MAX = 250;

module.exports = function withCmakeObjectPath(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(MARK)) return mod;
    mod.modResults.contents += `
${MARK}
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=${OBJECT_PATH_MAX}"
            }
        }
    }
}
`;
    return mod;
  });
};
