#!/usr/bin/env python3
"""
Horan Event Tracking - frontend cache reliability patch.

Backs up the application before modifying static/index.html.
Does not modify databases, users, passwords or application logic.
"""

from pathlib import Path
from datetime import datetime
import hashlib
import shutil
import sys

APP = Path("/opt/horan-event-tracking")
INDEX = APP / "static" / "index.html"

def main():
    if not INDEX.is_file():
        print(f"ERROR: Cannot find {INDEX}")
        sys.exit(1)

    original = INDEX.read_text(encoding="utf-8")

    # Create a unique backup before making any changes.
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = INDEX.with_name(f"index.html.backup-{timestamp}")
    shutil.copy2(INDEX, backup)

    # Use the current HTML content as a version fingerprint.
    version = hashlib.sha256(original.encode("utf-8")).hexdigest()[:12]

    # Add a version parameter to local CSS and JavaScript references.
    import re

    def add_version(match):
        tag = match.group(0)

        if "://" in tag or tag.startswith("//"):
            return tag

        if re.search(r'(?i)(?:href|src)=["\'][^"\']*', tag):
            return re.sub(
                r'((?:href|src)=["\'])([^"\']+)(["\'])',
                lambda m: (
                    m.group(1)
                    + m.group(2)
                    + ("&" if "?" in m.group(2) else "?")
                    + "v=" + version
                    + m.group(3)
                ) if not m.group(2).startswith(("http://", "https://", "//"))
                and not re.search(r'[?&]v=', m.group(2))
                else m.group(0),
                tag,
                count=1,
                flags=re.IGNORECASE
            )

        return tag

    updated = re.sub(
        r'<(?:script|link)\b[^>]*>',
        add_version,
        original,
        flags=re.IGNORECASE
    )

    if updated == original:
        print("No changes required. Backup created at:")
        print(backup)
        return

    INDEX.write_text(updated, encoding="utf-8")

    print("SUCCESS: Frontend cache-busting added.")
    print(f"Version: {version}")
    print(f"Backup: {backup}")
    print("Database and user records were not modified.")
    print()
    print("Restart the application to apply the changes.")

if __name__ == "__main__":
    main()
