/** Install before importing the client if the host does not expose DOMException.
 * React Native must also install a UTF-8 TextDecoder, URL and secure crypto first;
 * see README. These cannot be replaced with insecure protocol-local fallbacks. */
export function installProtocolGlobals(): void {
  if (typeof globalThis.DOMException === 'undefined') {
    class MinimalDOMException extends Error {
      readonly code = 0;
      constructor(message = '', name = 'Error') { super(message); this.name = name; }
    }
    Object.defineProperty(globalThis, 'DOMException', { value: MinimalDOMException, configurable: true });
  }
  if (typeof globalThis.TextDecoder === 'undefined') throw new Error('Install a UTF-8 TextDecoder polyfill before importing the protocol client');
  if (typeof globalThis.URL === 'undefined') throw new Error('Install a URL polyfill before importing the protocol client');
  if (!globalThis.crypto?.getRandomValues && !globalThis.crypto?.randomUUID) throw new Error('Install a secure random source before using the protocol client');
}
