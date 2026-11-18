const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/** Register only text and image shares on the existing exported launcher activity. */
function addIncomingShareFilters(activity) {
  const filters = activity["intent-filter"] || (activity["intent-filter"] = []);
  const definitions = [
    ["android.intent.action.SEND", "text/plain"],
    ["android.intent.action.SEND", "image/*"],
    ["android.intent.action.SEND_MULTIPLE", "image/*"],
  ];
  for (const [action, mime] of definitions) {
    const exists = filters.some(
      (filter) =>
        filter.action?.some((entry) => entry.$?.["android:name"] === action) &&
        filter.data?.some((entry) => entry.$?.["android:mimeType"] === mime) &&
        filter.category?.some(
          (entry) => entry.$?.["android:name"] === "android.intent.category.DEFAULT",
        ),
    );
    if (!exists)
      filters.push({
        action: [{ $: { "android:name": action } }],
        category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
        data: [{ $: { "android:mimeType": mime } }],
      });
  }
  return activity;
}

module.exports = function withIncomingShares(config) {
  return withAndroidManifest(config, (config) => {
    addIncomingShareFilters(AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults));
    return config;
  });
};
module.exports.addIncomingShareFilters = addIncomingShareFilters;
