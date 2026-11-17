const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
// Shared Hermes sources use .js specifiers for TypeScript files.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    for (const extension of ['.ts', '.tsx']) {
      const candidate = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3) + extension);
      if (fs.existsSync(candidate)) return context.resolveRequest(context, candidate, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
