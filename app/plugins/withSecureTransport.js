const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// The RN debug template otherwise adds a cleartext exception for Metro.
// Keep the development manifest subject to the same TLS rule as the app.
module.exports = function withSecureTransport(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    for (const variant of ['debug', 'debugOptimized']) {
      const manifest = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', variant, 'AndroidManifest.xml');
      if (fs.existsSync(manifest)) {
        const original = fs.readFileSync(manifest, 'utf8');
        fs.writeFileSync(manifest, original.replace(/android:usesCleartextTraffic="true"/g, 'android:usesCleartextTraffic="false"'));
      }
    }
    return mod;
  }]);
};
