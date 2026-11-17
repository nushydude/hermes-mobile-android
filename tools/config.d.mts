export function httpsOrigin(value: string | undefined, name: string): string;
export function gatewayOrigin(): string;
export function ntfyOrigin(): string;
export function hermesHome(): string;
export function subscriptionUrl(value: unknown, origin: string): string;
export function tokenEntries(text: string): string[];
export function parseDeploymentToken(text: string): string;
export function readDeploymentToken(): string;
