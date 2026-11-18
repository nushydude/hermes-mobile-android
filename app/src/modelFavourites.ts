import { useSyncExternalStore } from "react";
import { readPreference, writePreference } from "./preferenceDatabase";
import { modelFavouriteKey, parseModelFavourites } from "./components/modelFavouriteCore";
export { modelFavouriteKey } from "./components/modelFavouriteCore";
let favourites = parseModelFavourites(readPreference("model_favourites"));
const listeners = new Set<() => void>();
export function useModelFavourites() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => favourites,
    () => favourites,
  );
}
export function toggleModelFavourite(choice: { provider: string; model: string }) {
  const key = modelFavouriteKey(choice);
  if (!favourites.includes(key) && favourites.length >= 100)
    throw Error("You can save up to 100 favourite models.");
  const next = favourites.includes(key)
    ? favourites.filter((v) => v !== key)
    : [...favourites, key];
  writePreference("model_favourites", JSON.stringify(next));
  favourites = next;
  listeners.forEach((listener) => listener());
}
