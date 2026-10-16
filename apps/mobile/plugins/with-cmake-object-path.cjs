// Expo config plugin (ADR-0061 #2): on Windows, ninja stops at file names of 260 characters, and
// CMake names an object file after its source's full path (react-native-gesture-handler's shadow
// nodes reach 350). Past CMAKE_OBJECT_PATH_MAX, CMake shortens the name with a hash.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// bto: CMAKE_OBJECT_PATH_MAX';

module.exports = function withCmakeObjectPath(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(MARK)) return mod;
    mod.modResults.contents += `
${MARK}
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=240"
            }
        }
    }
}
`;
    return mod;
  });
};
