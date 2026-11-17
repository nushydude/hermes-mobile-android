"""Create private ntfy configuration without emitting credentials or topic URLs."""
import json
import re
import secrets
import subprocess
from pathlib import Path
from config import https_origin

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.artifacts' / 'notifications'
EXE = ROOT / '.toolchain' / 'ntfy' / 'ntfy_2.38.0_windows_amd64' / 'ntfy.exe'


def prepare():
    origin = https_origin("HERMES_MOBILE_NTFY_URL")
    RUNTIME.mkdir(parents=True, exist_ok=True)
    private = RUNTIME / 'runtime.json'
    if private.exists():
        state = json.loads(private.read_text(encoding='utf-8'))
    else:
        password = secrets.token_urlsafe(40)
        result = subprocess.run([str(EXE), 'user', 'hash'], input=password+'\n'+password+'\n', text=True, capture_output=True, timeout=15)
        hashed = result.stdout.strip()
        if result.returncode or not re.fullmatch(r'\$2[aby]\$\d\d\$[^\s]+', hashed):
            raise RuntimeError('Could not provision local notification credentials')
        state = {'topic': 'hm_'+secrets.token_hex(16), 'publish_token': 'tk_'+''.join(secrets.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(29)), 'password_hash': hashed}
        private.write_text(json.dumps(state), encoding='utf-8')
    topic = state['topic']
    settings = {
        'base-url': origin,
        'listen-http': '127.0.0.1:9130',
        'cache-file': str(RUNTIME / 'messages.db'),
        'cache-duration': '24h',
        'auth-file': str(RUNTIME / 'users.db'),
        'auth-default-access': 'deny-all',
        'auth-users': ['gateway:'+state['password_hash']+':user'],
        'auth-access': ['gateway:'+topic+':wo', '*:'+topic+':ro'],
        'auth-tokens': ['gateway:'+state['publish_token']+':Hermes Mobile publisher'],
        'log-level': 'ERROR',
        'web-root': 'disable',
    }
    # JSON is a YAML subset and avoids Windows-path/string escaping mistakes.
    (RUNTIME / 'server.yml').write_text(json.dumps(settings, indent=2), encoding='utf-8')
    (RUNTIME / 'plugin-config.json').write_text(json.dumps({'publish_url':'http://127.0.0.1:9130','topic':topic,'token':state['publish_token']}), encoding='utf-8')
    (RUNTIME / 'phone-subscription.json').write_text(json.dumps({'server':origin,'topic':topic,'subscription_url':'ntfy://'+origin.removeprefix('https://')+'/'+topic}), encoding='utf-8')
    print('Private notification runtime prepared; credentials and subscription URL omitted.')


if __name__ == '__main__':
    prepare()
