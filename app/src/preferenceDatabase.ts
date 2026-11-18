import * as SQLite from "expo-sqlite";

const db = SQLite.openDatabaseSync("hermes-preferences.db");
db.execSync(
  "CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
);
export function readPreference(key: string) {
  return db.getFirstSync<{ value: string }>("SELECT value FROM preferences WHERE key = ?", key)
    ?.value;
}
export function writePreference(key: string, value: string) {
  db.runSync("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)", key, value);
}
