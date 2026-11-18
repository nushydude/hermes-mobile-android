export type MonitorStatus =
  "off" | "starting" | "running" | "finishing" | "waiting" | "setup" | "background" | "error";
export function monitorStatus(input: {
  mode: string;
  started: boolean;
  starting: boolean;
  idle: boolean;
  configured: boolean;
  active: boolean;
  failed: boolean;
}): MonitorStatus {
  if (input.started) return input.idle ? "finishing" : "running";
  if (input.starting) return "starting";
  if (input.mode === "off") return "off";
  if (!input.configured) return "setup";
  if (input.failed) return "error";
  if (!input.active) return "background";
  return "waiting";
}
export const monitorStatusText: Record<MonitorStatus, string> = {
  off: "Monitor off",
  starting: "Starting monitor…",
  running: "Monitor running",
  finishing: "Monitor running · stopping after idle",
  waiting: "Waiting for a turn or request",
  setup: "Connection setup required",
  background: "Waiting until the app is opened",
  error: "Monitor could not start",
};
