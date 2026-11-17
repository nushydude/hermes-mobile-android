// Run only in a separate visible local terminal. Never redirect/capture the QR.
import { ntfyOrigin, subscriptionUrl } from '../config.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import qr from 'qrcode-terminal';

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error('Subscription QR must run in an interactive local terminal.');
  process.exitCode = 1;
} else {
  try {
    const origin = ntfyOrigin();
    const file = resolve('.artifacts/notifications/phone-subscription.json');
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    const url = subscriptionUrl(settings.subscription_url, origin);
    console.clear();
    console.log('Hermes Mobile notifications — scan with your phone camera to subscribe in ntfy.');
    console.log('Keep Tailscale on. Grant ntfy notification permission when Android asks.');
    qr.generate(url, { small: true });
    console.log('Private read-only subscription. Press Enter to clear this window (or wait two minutes).');
    const close = () => { console.clear(); process.exit(0); };
    process.stdin.resume(); process.stdin.once('data', close); setTimeout(close, 120_000);
  } catch {
    console.error('Could not display subscription code. Check private notification configuration.');
    process.exitCode = 1;
  }
}
