// The bootstrap must run before json-rpc-channel's module-level TextDecoder.
import './initialize.js';
export * from './client.js';
export * from './globals.js';
export { JsonRpcGatewayError } from './vendor/json-rpc-channel.js';
export type { GatewayEvent, GatewayEventName } from './vendor/gateway-events.js';
export type { CanonicalSnapshot, CanonicalCreateParams, CanonicalSubmitParams } from './vendor/gateway-contract.generated.js';

export { randomUUID } from './uuid.js';
