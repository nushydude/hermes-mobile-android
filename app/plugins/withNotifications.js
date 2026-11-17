const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');
module.exports = function withNotifications(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    for (const name of ['android.permission.POST_NOTIFICATIONS','android.permission.FOREGROUND_SERVICE','android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING']) AndroidConfig.Permissions.addPermission(config.modResults, name);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.service = app.service || [];
    const name = 'app.notifee.core.ForegroundService';
    let service = app.service.find(s => s.$['android:name'] === name);
    if (!service) { service = {$:{'android:name':name}}; app.service.push(service); }
    service.$['android:foregroundServiceType'] = 'remoteMessaging';
    service.$['tools:replace'] = 'android:foregroundServiceType';
    service.$['android:exported'] = 'false';
    return config;
  });
};
