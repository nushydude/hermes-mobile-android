import { useSyncExternalStore } from "react";
import {readPreference, writePreference} from './preferenceDatabase';

const row = readPreference('show_activity');
let showActivity = row === "1";
const listeners = new Set<() => void>();

export function setShowActivity(value: boolean) {
  writePreference('show_activity', value ? '1' : '0');
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
const monitorRow = readPreference('monitor_mode');
let monitorMode: MonitorMode = monitorRow === 'always' || monitorRow === 'whileturnruns' ? monitorRow : 'off';
const monitorListeners = new Set<() => void>();
export function getMonitorMode() { return monitorMode; }
export function subscribeMonitorMode(listener: () => void) { monitorListeners.add(listener); return () => { monitorListeners.delete(listener); }; }
export function setMonitorMode(value: MonitorMode) { writePreference('monitor_mode', value); monitorMode = value; monitorListeners.forEach(listener => listener()); }
export function useMonitorMode() { return useSyncExternalStore(subscribeMonitorMode, getMonitorMode, () => 'off' as MonitorMode); }

// Unset retains the pre-existing behavior: voice replies spoken, typed replies silent.
const speakRow = readPreference('speak_replies');
let speakReplies:boolean|null = speakRow === '1' ? true : speakRow === '0' ? false : null;
const speakListeners = new Set<() => void>();
export function getSpeakReplies(){return speakReplies;}
export function subscribeSpeakReplies(listener:()=>void){speakListeners.add(listener);return()=>{speakListeners.delete(listener);};}
export function setSpeakReplies(value:boolean){writePreference('speak_replies',value?'1':'0');speakReplies=value;speakListeners.forEach(listener=>listener());}
export function useSpeakReplies(){return useSyncExternalStore(subscribeSpeakReplies,getSpeakReplies,()=>null);}
