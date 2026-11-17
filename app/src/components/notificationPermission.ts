export type PermissionState = "enabled" | "blocked" | "request";
export function notificationPermissionState(status: number): PermissionState {
  if (status === 1 || status === 2) return "enabled";
  if (status === 0) return "blocked";
  return "request";
}
