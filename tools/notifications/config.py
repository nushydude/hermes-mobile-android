"""Private tooling configuration; never include supplied URLs in errors."""
import os
import re
from pathlib import Path
from urllib.parse import urlsplit


def https_origin(name):
    value = os.environ.get(name, '')
    try:
        parts = urlsplit(value)
        if not re.fullmatch(r'https://[^\s/?#]+/?', value, re.IGNORECASE):
            raise ValueError()
        if parts.scheme.lower() != 'https' or not parts.hostname or '\\' in parts.netloc or '@' in parts.netloc or parts.username is not None or parts.password is not None:
            raise ValueError()
        _ = parts.port
        return 'https://' + parts.netloc
    except ValueError:
        raise ValueError(f'{name} must be an HTTPS origin') from None
