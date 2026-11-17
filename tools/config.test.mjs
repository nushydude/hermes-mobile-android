import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpsOrigin, gatewayOrigin, hermesHome, subscriptionUrl } from './config.mjs';

test('only explicit HTTPS origins are accepted without leaking invalid values', () => {
  assert.equal(httpsOrigin('https://example.test:9120/', 'URL'), 'https://example.test:9120');
  for (const value of [undefined, '', 'http://example.test', 'https://user:secret@example.test', 'https://@example.test', 'https://example.test\\path', 'https://example.test/path', 'https://example.test/a/..', 'https://example.test?secret', 'https://example.test#secret', 'https://example.test:99999']) {
    assert.throws(() => httpsOrigin(value, 'URL'), error => error.message === 'URL must be an HTTPS origin');
  }
});
test('environment controls origin and home', () => {
  const oldGateway = process.env.HERMES_MOBILE_GATEWAY_URL, oldHome = process.env.HERMES_HOME;
  try {
    delete process.env.HERMES_MOBILE_GATEWAY_URL;
    assert.throws(gatewayOrigin, /HERMES_MOBILE_GATEWAY_URL/);
    process.env.HERMES_MOBILE_GATEWAY_URL = 'https://gateway.example';
    process.env.HERMES_HOME = '/custom/home';
    assert.equal(gatewayOrigin(), 'https://gateway.example');
    assert.equal(hermesHome(), '/custom/home');
  } finally {
    if (oldGateway === undefined) delete process.env.HERMES_MOBILE_GATEWAY_URL; else process.env.HERMES_MOBILE_GATEWAY_URL = oldGateway;
    if (oldHome === undefined) delete process.env.HERMES_HOME; else process.env.HERMES_HOME = oldHome;
  }
});

test('subscription URLs match normalized HTTPS authorities and reject unsafe inputs', () => {
  const topic = 'hm_' + 'a'.repeat(32);
  assert.equal(subscriptionUrl(`ntfy://HOST.ts.net:443/${topic}`, 'https://host.ts.net'), `ntfy://HOST.ts.net:443/${topic}`);
  assert.equal(subscriptionUrl(`ntfy://HOST.ts.net:9121/${topic}`, 'https://host.ts.net:9121'), `ntfy://HOST.ts.net:9121/${topic}`);
  for (const value of [undefined, `ntfy://other.ts.net/${topic}`, `ntfy://user:secret@host.ts.net/${topic}`, `ntfy://host.ts.net/${topic}?secret`, `ntfy://host.ts.net/${topic}#secret`, `ntfy://host.ts.net/path/${topic}`, 'not a URL secret']) {
    assert.throws(() => subscriptionUrl(value, 'https://host.ts.net'), error => error.message === 'Invalid private subscription configuration');
  }
});

test('deployment token parser handles synthetic assignments without exposing values', async () => {
  const { parseDeploymentToken, tokenEntries } = await import('./config.mjs');
  const key = 'HERMES_DASHBOARD_SESSION_TOKEN';
  assert.equal(parseDeploymentToken(`export ${key} = "synthetic token"\n`), 'synthetic token');
  assert.equal(parseDeploymentToken(`${key}='synthetic'`), 'synthetic');
  assert.equal(parseDeploymentToken(`${key}=unquoted # literal`), 'unquoted # literal');
  assert.equal(tokenEntries(`${key}=\n${key}=synthetic`).length, 2);
  for (const text of ['', `${key}=`, `${key}='file:synthetic'`, `${key}=synthetic\n${key}=other`]) {
    assert.throws(() => parseDeploymentToken(text), error => error.message === 'Credential configuration unavailable');
  }
});
