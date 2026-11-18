"""Select only the existing Hermes public URL for the local pairing launcher."""
import sys
from pathlib import Path

import yaml


def main():
    try:
        config = yaml.safe_load((Path(sys.argv[1]) / "config.yaml").read_text(encoding="utf-8"))
        origin = config.get("webapp", {}).get("public_url")
        if not isinstance(origin, str) or not origin.strip():
            return 1
        print(origin.strip())
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    sys.exit(main())
