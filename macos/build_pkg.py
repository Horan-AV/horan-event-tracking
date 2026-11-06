#!/usr/bin/env python3
"""
Build the Mac installer (Horan-Event-Tracking-<version>.pkg).

Works on macOS (uses Apple's pkgbuild/productbuild) or on Linux (uses mkbom from bomutils and xar).

    python3 macos/build_pkg.py [--out DIR] [--mkbom PATH] [--xar PATH] [--sign "Developer ID Installer: ..."]

Publisher: Horan AV (James Horan)
"""
import argparse
import gzip
import io
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
APP_NAME = "Horan Event Tracking"
PKG_ID = "com.horanav.eventtracking"
BUNDLE_ID = "com.horanav.eventtracking.launcher"


def version():
    with open(os.path.join(SRC, "server.py"), encoding="utf-8") as f:
        return re.search(r'^VERSION = "([^"]+)"', f.read(), re.M).group(1)


def build_bundle(dest_dir, ver):
    """Create "Horan Event Tracking.app" inside dest_dir. Returns its path."""
    app = os.path.join(dest_dir, f"{APP_NAME}.app")
    contents = os.path.join(app, "Contents")
    os.makedirs(os.path.join(contents, "MacOS"))
    os.makedirs(os.path.join(contents, "Resources", "app", "static"))
    shutil.copyfile(os.path.join(HERE, "launcher"), os.path.join(contents, "MacOS", "launcher"))
    shutil.copyfile(os.path.join(HERE, "icon.icns"), os.path.join(contents, "Resources", "icon.icns"))
    shutil.copyfile(os.path.join(SRC, "server.py"), os.path.join(contents, "Resources", "app", "server.py"))
    for name in sorted(os.listdir(os.path.join(SRC, "static"))):
        shutil.copyfile(os.path.join(SRC, "static", name), os.path.join(contents, "Resources", "app", "static", name))
    with open(os.path.join(contents, "Info.plist"), "w", encoding="utf-8") as f:
        f.write(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>{APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>{APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>{BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>{ver}</string>
  <key>CFBundleVersion</key><string>{ver}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>© Horan AV (James Horan)</string>
</dict>
</plist>
""")
    with open(os.path.join(contents, "PkgInfo"), "w") as f:
        f.write("APPL????")
    # Permissions: folders 755, files 644, the launcher 755.
    for root, dirs, files in os.walk(app):
        os.chmod(root, 0o755)
        for n in files:
            os.chmod(os.path.join(root, n), 0o644)
    os.chmod(os.path.join(contents, "MacOS", "launcher"), 0o755)
    return app


# ------------------------------------------------------------------ Linux build helpers

def cpio_odc(root, out_path, uid=0, gid=80):
    """Write a gzip-compressed 'odc' cpio archive of root (paths start with '.'), as Apple's Installer expects."""
    entries = ["."]
    for base, dirs, files in os.walk(root):
        dirs.sort()
        rel = os.path.relpath(base, root)
        for n in sorted(dirs) + sorted(files):
            entries.append("./" + (n if rel == "." else os.path.join(rel, n)))
    buf = io.BytesIO()
    ino = 1
    for name in entries:
        full = os.path.join(root, name[2:]) if name != "." else root
        st = os.lstat(full)
        data = b""
        if stat.S_ISREG(st.st_mode):
            with open(full, "rb") as f:
                data = f.read()
        bname = name.encode("utf-8") + b"\0"
        header = "070707%06o%06o%06o%06o%06o%06o%06o%011o%06o%011o" % (
            0, ino, st.st_mode, uid, gid, 1, 0, int(st.st_mtime), len(bname), len(data))
        buf.write(header.encode("ascii") + bname + data)
        ino += 1
    trailer = b"TRAILER!!!\0"
    buf.write(("070707%06o%06o%06o%06o%06o%06o%06o%011o%06o%011o" % (0, 0, 0, 0, 0, 1, 0, 0, len(trailer), 0))
              .encode("ascii") + trailer)
    with open(out_path, "wb") as f:
        f.write(gzip.compress(buf.getvalue(), mtime=0))
    return len(entries)


def tree_kbytes(root):
    total = 0
    for base, _dirs, files in os.walk(root):
        for n in files:
            total += os.path.getsize(os.path.join(base, n))
    return max(1, total // 1024)


def distribution(ver, kbytes):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>{APP_NAME}</title>
  <organization>com.horanav</organization>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <background file="background.png" mime-type="image/png" alignment="bottomleft" scaling="none"/>
  <background-darkAqua file="background.png" mime-type="image/png" alignment="bottomleft" scaling="none"/>
  <options customize="never" require-scripts="false" rootVolumeOnly="true" hostArchitectures="x86_64,arm64"/>
  <domains enable_localSystem="true"/>
  <volume-check>
    <allowed-os-versions><os-version min="11.0"/></allowed-os-versions>
  </volume-check>
  <choices-outline>
    <line choice="default"><line choice="{PKG_ID}"/></line>
  </choices-outline>
  <choice id="default"/>
  <choice id="{PKG_ID}" visible="false"><pkg-ref id="{PKG_ID}"/></choice>
  <pkg-ref id="{PKG_ID}" version="{ver}" onConclusion="none" installKBytes="{kbytes}">#app.pkg</pkg-ref>
</installer-gui-script>
"""


def build_linux(ver, out, mkbom, xar):
    work = tempfile.mkdtemp(prefix="het-pkg-")
    try:
        root = os.path.join(work, "root")       # installs into /Applications
        os.makedirs(root)
        build_bundle(root, ver)
        os.chmod(root, 0o775)                   # matches /Applications (root:admin, rwxrwxr-x)
        flat = os.path.join(work, "flat")
        comp = os.path.join(flat, "app.pkg")
        res = os.path.join(flat, "Resources")
        os.makedirs(comp)
        os.makedirs(res)
        count = cpio_odc(root, os.path.join(comp, "Payload"))
        subprocess.run([mkbom, "-u", "0", "-g", "80", root, os.path.join(comp, "Bom")], check=True)
        scripts = os.path.join(work, "scripts")
        os.makedirs(scripts)
        shutil.copyfile(os.path.join(HERE, "postinstall"), os.path.join(scripts, "postinstall"))
        os.chmod(scripts, 0o755)
        os.chmod(os.path.join(scripts, "postinstall"), 0o755)
        cpio_odc(scripts, os.path.join(comp, "Scripts"))
        kb = tree_kbytes(root)
        with open(os.path.join(comp, "PackageInfo"), "w", encoding="utf-8") as f:
            f.write(f"""<?xml version="1.0" encoding="utf-8"?>
<pkg-info format-version="2" identifier="{PKG_ID}" version="{ver}" install-location="/Applications" auth="root" relocatable="false" overwrite-permissions="false">
  <payload installKBytes="{kb}" numberOfFiles="{count}"/>
  <scripts>
    <postinstall file="./postinstall"/>
  </scripts>
</pkg-info>
""")
        with open(os.path.join(flat, "Distribution"), "w", encoding="utf-8") as f:
            f.write(distribution(ver, kb))
        for n in ("welcome.html", "conclusion.html", "background.png"):
            shutil.copyfile(os.path.join(HERE, n), os.path.join(res, n))
        if os.path.exists(out):
            os.remove(out)
        subprocess.run([xar, "--compression", "none", "-cf", os.path.abspath(out), "Distribution", "Resources", "app.pkg"],
                       cwd=flat, check=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build_mac(ver, out, sign):
    work = tempfile.mkdtemp(prefix="het-pkg-")
    try:
        root = os.path.join(work, "root")
        os.makedirs(root)
        build_bundle(root, ver)
        scripts = os.path.join(work, "scripts")
        os.makedirs(scripts)
        shutil.copyfile(os.path.join(HERE, "postinstall"), os.path.join(scripts, "postinstall"))
        os.chmod(os.path.join(scripts, "postinstall"), 0o755)
        comp = os.path.join(work, "app.pkg")
        subprocess.run(["pkgbuild", "--root", root, "--install-location", "/Applications", "--identifier", PKG_ID,
                        "--version", ver, "--scripts", scripts, comp], check=True)
        dist = os.path.join(work, "Distribution")
        with open(dist, "w", encoding="utf-8") as f:
            f.write(distribution(ver, tree_kbytes(root)))
        cmd = ["productbuild", "--distribution", dist, "--resources", HERE, "--package-path", work]
        if sign:
            cmd += ["--sign", sign]
        subprocess.run(cmd + [os.path.abspath(out)], check=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="Build the Horan Event Tracking Mac installer")
    ap.add_argument("--out", default=".")
    ap.add_argument("--mkbom", default=shutil.which("mkbom") or "mkbom")
    ap.add_argument("--xar", default=shutil.which("xar") or "xar")
    ap.add_argument("--sign", help='(on a Mac) "Developer ID Installer: Your Name (TEAMID)"')
    ap.add_argument("--bundle-to", help="just create the .app in this folder (used by install.sh)")
    a = ap.parse_args()
    ver = version()
    if a.bundle_to:
        target = os.path.join(a.bundle_to, f"{APP_NAME}.app")
        shutil.rmtree(target, ignore_errors=True)
        os.makedirs(a.bundle_to, exist_ok=True)
        print(build_bundle(a.bundle_to, ver))
        return
    out = os.path.join(a.out, f"Horan-Event-Tracking-{ver}.pkg")
    if sys.platform == "darwin" and shutil.which("pkgbuild"):
        build_mac(ver, out, a.sign)
    else:
        build_linux(ver, out, a.mkbom, a.xar)
    print(out)


if __name__ == "__main__":
    main()
