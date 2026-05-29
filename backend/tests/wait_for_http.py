from __future__ import annotations

import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


def main() -> int:
    url = sys.argv[1]
    deadline = time.time() + 60
    last_error = None

    while time.time() < deadline:
        try:
            with urlopen(url) as response:
                if 200 <= response.status < 500:
                    return 0
        except URLError as exc:
            last_error = exc
            time.sleep(1)

    raise SystemExit(f"timed out waiting for {url}: {last_error}")


if __name__ == "__main__":
    raise SystemExit(main())