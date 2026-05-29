from __future__ import annotations

import sys
from urllib.request import urlopen


def main() -> int:
    base_url = sys.argv[1].rstrip("/")
    for path in ("/health", "/healthz"):
        with urlopen(f"{base_url}{path}") as response:
            if response.status != 200:
                raise SystemExit(f"expected 200 from {path}, got {response.status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())