const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withWindowsBuildPaths(config) {
  return withAppBuildGradle(config, mod => {
    const marker = '// Hermes Mobile: hash C++ object paths for Windows Ninja.';
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents += `\n${marker}\nandroid {\n    defaultConfig {\n        externalNativeBuild {\n            cmake { arguments "-DCMAKE_OBJECT_PATH_MAX=240" }\n        }\n    }\n}\n`;
    }
    return mod;
  });
};
