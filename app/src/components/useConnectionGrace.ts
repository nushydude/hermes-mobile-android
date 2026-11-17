import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { appManager } from '../state';
import { ConnectionGrace } from './connectionGrace';
const grace = new ConnectionGrace(appManager.getState().connection);
let started = false;
export function startConnectionGrace() {
  if (started) return; started = true;
  appManager.subscribe(() => grace.update(appManager.getState().connection));
  AppState.addEventListener('change', state => { if (state === 'active') grace.foreground(); });
  grace.update(appManager.getState().connection);
  if (AppState.currentState === 'active') grace.foreground();
}
export function useConnectionGrace() { return useSyncExternalStore(grace.subscribe,grace.getSnapshot,grace.getSnapshot); }
