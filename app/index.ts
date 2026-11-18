import "./polyfills";
import { registerRootComponent } from "expo";

import App from "./App";
import { registerNotifications } from "./src/notifications";
import { conversationDiagnostics } from "./src/state/conversationDiagnostics";
import { getCollectTimings } from "./src/preferences";

// Before anything can start the state manager, so cache_restore_ms covers the cold start.
try {
  conversationDiagnostics.setEnabled(getCollectTimings());
} catch {}

registerNotifications();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
