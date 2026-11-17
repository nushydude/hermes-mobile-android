import { useSyncExternalStore } from "react";
import * as SQLite from "expo-sqlite";

const db = SQLite.openDatabaseSync("hermes-preferences.db");
db.execSync(
  "CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
);
const row = db.getFirstSync<{ value: string }>(
  "SELECT value FROM preferences WHERE key = ?",
  "show_activity",
);
let showActivity = row?.value === "1";
const listeners = new Set<() => void>();

export function setShowActivity(value: boolean) {
  db.runSync(
    "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
    "show_activity",
    value ? "1" : "0",
  );
  showActivity = value;
  listeners.forEach((listener) => listener());
}
export function useShowActivity() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => showActivity,
    () => false,
  );
}

export type MonitorMode = 'off' | 'whileturnruns' | 'always';
const monitorRow = db.getFirstSync<{value:string}>('SELECT value FROM preferences WHERE key = ?', 'monitor_mode');
let monitorMode: MonitorMode = monitorRow?.value === 'always' || monitorRow?.value === 'whileturnruns' ? monitorRow.value : 'off';
const monitorListeners = new Set<() => void>();
export function getMonitorMode() { return monitorMode; }
export function subscribeMonitorMode(listener: () => void) { monitorListeners.add(listener); return () => { monitorListeners.delete(listener); }; }
export function setMonitorMode(value: MonitorMode) { db.runSync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', 'monitor_mode', value); monitorMode = value; monitorListeners.forEach(listener => listener()); }
export function useMonitorMode() { return useSyncExternalStore(subscribeMonitorMode, getMonitorMode, () => 'off' as MonitorMode); }
