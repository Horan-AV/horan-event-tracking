"""End-to-end tests: start the real server on a throwaway data folder and use its API.

Run from the project folder with:  python3 -m unittest discover -s tests -v
Uses only the Python standard library, like the app itself.
"""
import http.client
import json
import os
import re
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import zlib
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HDR = {"Content-Type": "application/json", "X-Requested-With": "horan-rms"}


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Client:
    """A browser-like client: keeps its sign-in cookie between requests."""

    def __init__(self, port):
        self.port = port
        self.cookie = ""

    def request(self, method, path, body=None, headers=None, raw=False):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = dict(HDR if headers is None else headers)
        if self.cookie:
            h["Cookie"] = self.cookie
        conn.request(method, path, json.dumps(body) if body is not None else None, h)
        r = conn.getresponse()
        data = r.read()
        sc = r.getheader("Set-Cookie")
        if sc:
            self.cookie = sc.split(";")[0]
        conn.close()
        if raw:
            return r.status, r, data
        try:
            return r.status, json.loads(data)
        except ValueError:
            return r.status, data

    def get(self, path):
        return self.request("GET", "/api" + path)

    def post(self, path, body=None):
        return self.request("POST", "/api" + path, body or {})

    def put(self, path, body=None):
        return self.request("PUT", "/api" + path, body or {})

    def delete(self, path):
        return self.request("DELETE", "/api" + path)


class ServerCase(unittest.TestCase):
    """Each test class gets its own server and its own empty data folder with the sample data."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        env = dict(os.environ, HORAN_RMS_GITHUB_API="http://127.0.0.1:9")  # never go online from tests
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py"), "--port", str(cls.port),
                                     "--data", cls.tmp.name, "--demo"], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.c = Client(cls.port)
        for _ in range(100):
            try:
                if cls.c.get("/meta")[0] == 200:
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.tmp.cleanup()

    def product(self, sku):
        return next(p for p in self.c.get("/products?flat=1")[1] if p["sku"] == sku)

    def new_job(self, **extra):
        body = dict({"name": "Test job", "start_date": "2030-01-10", "end_date": "2030-01-11"}, **extra)
        status, job = self.c.post("/jobs", body)
        self.assertEqual(status, 200, job)
        return job


class TestSecurity(ServerCase):
    def test_security_headers(self):
        status, r, _ = self.c.request("GET", "/", raw=True)
        self.assertEqual(status, 200)
        csp = r.getheader("Content-Security-Policy")
        self.assertIn("script-src 'self'", csp)
        self.assertNotIn("'unsafe-inline'", csp.split("script-src")[1].split(";")[0])
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertEqual(r.getheader("X-Frame-Options"), "DENY")
        self.assertEqual(r.getheader("X-Content-Type-Options"), "nosniff")
        self.assertEqual(r.getheader("Referrer-Policy"), "no-referrer")

    def test_pages_have_no_inline_scripts(self):
        for name in ("index.html", "login.html"):
            with open(os.path.join(ROOT, "static", name), encoding="utf-8") as f:
                html = f.read()
            self.assertFalse(re.search(r"<script(?![^>]*\bsrc=)", html), f"{name} has an inline script")
            self.assertFalse(re.search(r"\son[a-z]+\s*=", html), f"{name} has an inline event handler")

    def test_page_addresses_have_no_hash(self):
        # /jobs, /job/12 … are served the app itself, so a reload or a bookmark on any page works.
        for path in ("/jobs", "/job/12", "/settings/company", "/print/3/quote"):
            status, r, data = self.c.request("GET", path, raw=True)
            self.assertEqual(status, 200, path)
            self.assertRegex(data, rb'<script src="/static/app\.js\?v=[0-9.]+">', path)
        self.assertEqual(self.c.request("GET", "/api/nonsense")[0], 404)
        for name in ("app.js", "index.html"):
            with open(os.path.join(ROOT, "static", name), encoding="utf-8") as f:
                self.assertNotIn('href="#/', f.read(), name)

    def test_changes_need_the_app_header(self):
        # A hostile web page can't add this header to a cross-site request.
        status, body = self.c.request("POST", "/api/jobs", {"name": "x"}, headers={"Content-Type": "application/json"})
        self.assertEqual(status, 403)

    def test_unknown_host_refused(self):
        # DNS rebinding: a request that names some other website as the host is refused.
        status, _ = self.c.request("GET", "/api/meta", headers={"Host": "evil.example.com"})
        self.assertEqual(status, 403)

    def test_bad_content_length(self):
        status, _ = self.c.request("POST", "/api/jobs", headers=dict(HDR, **{"Content-Length": "-5"}))
        self.assertEqual(status, 400)

    def test_static_cannot_escape(self):
        for path in ("/static/../server.py", "/static/%2e%2e/server.py", "/static/..%2fserver.py"):
            status, _, data = self.c.request("GET", path, raw=True)
            self.assertNotIn(b"Horan Event Tracking - a local", data, path)

    @unittest.skipUnless(os.name == "posix", "file modes are POSIX only")
    def test_data_folder_is_private(self):
        self.assertEqual(stat.S_IMODE(os.stat(self.tmp.name).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.tmp.name, "rms.db")).st_mode), 0o600)

    def test_csv_formula_cells_are_text(self):
        self.c.post("/contacts", {"name": "=HYPERLINK(\"http://evil\")", "company": "+44 1234"})
        status, _, data = self.c.request("GET", "/api/export/contacts.csv", raw=True)
        text = data.decode("utf-8-sig")
        self.assertIn("'=HYPERLINK", text)
        self.assertIn("'+44 1234", text)


class TestPermissions(ServerCase):
    """With users: what someone who isn't an admin can't do."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        admin = cls.c
        assert admin.post("/users", {"name": "Admin", "password": "correct horse"})[0] == 200
        assert admin.post("/login", {"user_id": 1, "password": "correct horse"})[0] == 200
        status, sam = admin.post("/users", {"name": "Sam", "password": "battery staple", "is_admin": False})
        assert status == 200, sam
        cls.sam = Client(cls.port)
        assert cls.sam.post("/login", {"user_id": sam["id"], "password": "battery staple"})[0] == 200

    def test_signed_out_gets_nothing(self):
        anon = Client(self.port)
        for path in ("/jobs", "/products", "/settings", "/backup.db", "/users"):
            self.assertEqual(anon.get(path)[0], 401, path)
        self.assertEqual(anon.get("/meta")[1], {"version": anon.get("/meta")[1]["version"], "signed_in": False})

    def test_non_admin_is_refused(self):
        sam = self.sam
        refused = [
            sam.put("/settings", {"company_name": "Hacked"}),
            sam.get("/backup.db"),
            sam.get("/export.json"),
            sam.put("/icons", {"target": "nav:jobs", "lib": "star"}),
            sam.put("/sounds", {"kind": "ok"}),
            sam.delete("/network/devices"),
            sam.get("/zoho"),
            sam.get("/zoho/options"),
            sam.get("/tailscale"),
            sam.post("/tailscale/install"),
            sam.post("/tailscale/start"),
            sam.post("/users", {"name": "Eve", "password": "a long password", "is_admin": True}),
            sam.put("/users/1", {"password": "another long one"}),
            sam.put("/update/auto", {"mode": "install", "time": "03:00"}),
            sam.post("/update/github", {}),
            sam.post("/invoices/pdf", {"ids": [1], "doc": "quote", "layout": {"title": "x"}}),
        ]
        for status, body in refused:
            self.assertEqual(status, 403, body)
        self.assertEqual(self.c.get("/settings")[1]["company_name"], "Horan AV")

    def test_non_admin_sees_no_server_details(self):
        meta = self.sam.get("/meta")[1]
        self.assertEqual(meta["data_dir"], "")
        self.assertEqual(meta["app_backups"], [])
        self.assertNotIn("db_path", meta)
        net = self.sam.get("/network")[1]
        self.assertTrue(all(d["current"] for d in net["devices"]))

    def test_non_admin_can_still_work(self):
        self.assertEqual(self.sam.get("/jobs")[0], 200)
        self.assertEqual(self.sam.post("/jobs", {"name": "Sam's job", "start_date": "2030-02-01", "end_date": "2030-02-01"})[0], 200)

    def test_secrets_never_in_settings(self):
        keys = self.c.get("/settings")[1].keys()
        self.assertFalse([k for k in keys if k.startswith(("secret_", "zoho_")) and k != "zoho_connected"])
        users = self.c.get("/users")[1]
        self.assertFalse([u for u in users if "pin_hash" in u])


class TestSignInLimit(ServerCase):
    def test_wrong_pins_are_limited(self):
        self.assertEqual(self.c.post("/users", {"name": "Admin", "password": "correct horse"})[0], 200)
        guesser = Client(self.port)
        seen = [guesser.post("/login", {"user_id": 1, "password": f"wrong guess {i}"})[0] for i in range(7)]
        self.assertEqual(seen[:5], [401] * 5)
        self.assertEqual(seen[5:], [429, 429])
        # even the right PIN is refused while locked out
        self.assertEqual(guesser.post("/login", {"user_id": 1, "password": "correct horse"})[0], 429)


class TestPasswords(ServerCase):
    def db(self):
        import sqlite3
        return sqlite3.connect(os.path.join(self.tmp.name, "rms.db"), timeout=15)

    def stored(self, uid):
        conn = self.db()
        try:
            return conn.execute("SELECT pin_hash FROM users WHERE id = ?", (uid,)).fetchone()[0]
        finally:
            conn.close()

    def test_passwords(self):
        c = self.c
        # rules for new passwords
        self.assertEqual(c.post("/users", {"name": "Admin", "password": "short"})[0], 400)
        self.assertEqual(c.post("/users", {"name": "Admin", "password": "password123"})[0], 400)
        self.assertEqual(c.post("/users", {"name": "Admin", "password": "aaaaaaaaaa"})[0], 400)
        self.assertEqual(c.post("/users", {"name": "Admin", "password": "x" * 500})[0], 400)
        self.assertEqual(c.post("/users", {"name": "Admin", "password": "correct horse"})[0], 200)
        self.assertEqual(c.post("/login", {"user_id": 1, "password": "correct horse"})[1], {"ok": True, "weak": False})

        # only a salted hash is stored, never the password, and two people with the same password differ
        h = self.stored(1)
        self.assertRegex(h, r"^pbkdf2_sha256\$600000\$[0-9a-f]{32}\$[0-9a-f]{64}$")
        self.assertNotIn("correct horse", h)
        _, sam = c.post("/users", {"name": "Sam", "password": "correct horse"})
        self.assertNotEqual(self.stored(sam["id"]), h)
        with open(os.path.join(self.tmp.name, "rms.db"), "rb") as f:
            self.assertNotIn(b"correct horse", f.read())

        # a short PIN from an older version still signs in, is re-hashed, and is flagged as weak
        import hashlib
        salt = "00112233445566778899aabbccddeeff"
        old = salt + "$" + hashlib.pbkdf2_hmac("sha256", b"4321", bytes.fromhex(salt), 200_000).hex()
        conn = self.db()
        conn.execute("UPDATE users SET pin_hash = ? WHERE id = ?", (old, sam["id"]))
        conn.commit()
        conn.close()
        s = Client(self.port)
        self.assertEqual(s.post("/login", {"user_id": sam["id"], "pin": "4321"})[1], {"ok": True, "weak": True})
        self.assertTrue(self.stored(sam["id"]).startswith("pbkdf2_sha256$600000$"))

        # changing your own password needs the current one, and signs out your other devices
        other = Client(self.port)
        self.assertEqual(other.post("/login", {"user_id": sam["id"], "password": "4321"})[0], 200)
        self.assertEqual(s.put("/me/password", {"current": "wrong", "new": "battery staple"})[0], 400)
        self.assertEqual(s.put("/me/password", {"current": "4321", "new": "tiny"})[0], 400)
        self.assertEqual(s.put("/me/password", {"current": "4321", "new": "battery staple"})[0], 200)
        self.assertEqual(s.get("/jobs")[0], 200)
        self.assertEqual(other.get("/jobs")[0], 401)
        fresh = Client(self.port)
        self.assertEqual(fresh.post("/login", {"user_id": sam["id"], "password": "4321"})[0], 401)
        self.assertEqual(fresh.post("/login", {"user_id": sam["id"], "password": "battery staple"})[0], 200)
        # an admin can't read a password, only replace it
        self.assertFalse([u for u in c.get("/users")[1] if "pin_hash" in u or "password" in u])


def lan_ip():
    """An address of this machine that isn't the loopback one, if it has one."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
            sk.connect(("10.255.255.255", 1))
            ip = sk.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


@unittest.skipUnless(shutil.which("openssl"), "needs the openssl tool")
class TestHttps(unittest.TestCase):
    """HTTPS with the app's own certificate."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        base = [sys.executable, os.path.join(ROOT, "server.py"), "--port", str(cls.port), "--data", cls.tmp.name]
        out = subprocess.run(base + ["--https", "on"], capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr
        cls.cli_output = out.stdout
        env = dict(os.environ, HORAN_RMS_GITHUB_API="http://127.0.0.1:9")
        cls.proc = subprocess.Popen(base + ["--host", "0.0.0.0", "--demo"], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.tls = os.path.join(cls.tmp.name, "tls")
        cls.ctx = ssl.create_default_context(cafile=os.path.join(cls.tls, "ca.pem"))
        for _ in range(100):
            try:
                if cls.https("GET", "/api/meta")[0] == 200:
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("https server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.tmp.cleanup()

    @classmethod
    def https(cls, method, path, body=None, host="localhost", ctx=None):
        conn = http.client.HTTPSConnection(host, cls.port, context=ctx or cls.ctx, timeout=30)
        conn.request(method, path, json.dumps(body) if body is not None else None, HDR)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, r, data

    def test_trusted_once_the_certificate_is_installed(self):
        for host in ("localhost", "127.0.0.1"):
            self.assertEqual(self.https("GET", "/api/meta", host=host)[0], 200)

    def test_not_trusted_without_it(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.https("GET", "/api/meta", ctx=ssl.create_default_context())

    def test_this_computer_can_still_use_plain_http(self):
        # The launchers and the browser on the computer running the app use http://127.0.0.1.
        self.assertEqual(Client(self.port).get("/meta")[0], 200)

    def test_other_devices_are_sent_to_https(self):
        ip = lan_ip()
        if not ip:
            self.skipTest("this machine has no network address")
        conn = http.client.HTTPConnection(ip, self.port, timeout=30)
        conn.request("GET", "/jobs?x=1", headers=HDR)
        r = conn.getresponse()
        r.read()
        self.assertEqual(r.status, 301)
        self.assertEqual(r.getheader("Location"), f"https://{ip}:{self.port}/jobs?x=1")
        # and a sign-in is never accepted over plain http from another device
        conn = http.client.HTTPConnection(ip, self.port, timeout=30)
        conn.request("POST", "/api/login", json.dumps({"passcode": "x"}), HDR)
        self.assertEqual(conn.getresponse().status, 400)

    def test_keys_are_private_and_never_served(self):
        if os.name == "posix":
            for name in ("ca-key.pem", "key.pem"):
                self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.tls, name)).st_mode), 0o600, name)
            self.assertEqual(stat.S_IMODE(os.stat(self.tls).st_mode), 0o700)
        status, r, data = self.https("GET", "/ca.crt")
        self.assertEqual(status, 200)
        self.assertTrue(data.startswith(b"-----BEGIN CERTIFICATE-----"))
        self.assertNotIn(b"PRIVATE KEY", data)

    def test_the_authority_cannot_vouch_for_internet_sites(self):
        # Even with the authority's key, a certificate for a real website is refused by anything that trusts it.
        d = self.tls
        key, csr, crt, cnf = (os.path.join(self.tmp.name, n) for n in ("evil.key", "evil.csr", "evil.crt", "evil.cnf"))
        with open(cnf, "w") as f:
            f.write("[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=www.example.com\n[v3]\nsubjectAltName=DNS:www.example.com\n")
        run = lambda *a: subprocess.run(["openssl"] + list(a), capture_output=True, text=True)
        self.assertEqual(run("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", key).returncode, 0)
        self.assertEqual(run("req", "-new", "-key", key, "-config", cnf, "-out", csr).returncode, 0)
        self.assertEqual(run("x509", "-req", "-in", csr, "-CA", os.path.join(d, "ca.pem"), "-CAkey", os.path.join(d, "ca-key.pem"),
                             "-set_serial", "7", "-days", "5", "-extfile", cnf, "-extensions", "v3", "-out", crt).returncode, 0)
        bad = run("verify", "-CAfile", os.path.join(d, "ca.pem"), crt)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("permitted subtree violation", bad.stdout + bad.stderr)
        good = run("verify", "-CAfile", os.path.join(d, "ca.pem"), os.path.join(d, "cert.pem"))
        self.assertEqual(good.returncode, 0, good.stderr)

    def test_settings_show_the_fingerprint(self):
        status, r, data = self.https("GET", "/api/network")
        h = json.loads(data)["https"]
        self.assertTrue(h["enabled"] and h["active"] and h["has_ca"])
        self.assertRegex(h["fingerprint"], r"^([0-9A-F]{2}:){31}[0-9A-F]{2}$")
        self.assertIn(h["fingerprint"], self.cli_output)
        self.assertIn("localhost", h["names"])

    def test_sign_in_cookie_is_https_only_over_https(self):
        status, r, data = self.https("POST", "/api/users", {"name": "Admin", "password": "correct horse"})
        self.assertEqual(status, 200, data)
        self.assertIn("Secure", r.getheader("Set-Cookie"))
        plain = Client(self.port)
        status, r, _ = plain.request("POST", "/api/login", {"user_id": 1, "password": "correct horse"}, raw=True)
        self.assertEqual(status, 200)
        self.assertNotIn("Secure", r.getheader("Set-Cookie"))


class TestTailscale(unittest.TestCase):
    """The guided Tailscale setup, against stand-ins for the `tailscale` and `pkexec` programs."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        d = cls.tmp.name
        cls.bin, cls.state, cls.log = os.path.join(d, "bin"), os.path.join(d, "state.json"), os.path.join(d, "calls.log")
        os.mkdir(cls.bin)
        cls.write_state({"BackendState": "Stopped"})
        scripts = {
            "tailscale": '#!/bin/sh\ncase "$1" in status) cat "$TS_STATE";; *) echo "tailscale $*" >> "$TS_LOG";; esac\n',
            # the stand-in for the password prompt: note what would run as admin, and "start" the service
            "pkexec": '#!/bin/sh\necho "pkexec $*" >> "$TS_LOG"\n'
                      'echo \'{"BackendState": "NeedsLogin", "AuthURL": "https://login.tailscale.com/a/abc123"}\' > "$TS_STATE"\n',
        }
        for name, body in scripts.items():
            path = os.path.join(cls.bin, name)
            with open(path, "w") as f:
                f.write(body)
            os.chmod(path, 0o755)
        env = dict(os.environ, PATH=cls.bin + os.pathsep + os.environ.get("PATH", ""), TS_STATE=cls.state, TS_LOG=cls.log,
                   HORAN_RMS_GITHUB_API="http://127.0.0.1:9")
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py"), "--port", str(cls.port),
                                     "--data", os.path.join(d, "data"), "--host", "0.0.0.0"], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.c = Client(cls.port)
        for _ in range(100):
            try:
                if cls.c.get("/meta")[0] == 200:
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.tmp.cleanup()

    @classmethod
    def write_state(cls, state):
        with open(cls.state, "w") as f:
            json.dump(state, f)

    def status(self):
        return self.c.get("/tailscale?fresh=1")[1]

    @unittest.skipIf(sys.platform == "darwin", "the Mac path opens the Tailscale app instead")
    def test_setup_steps(self):
        # 1. installed but off
        t = self.status()
        self.assertEqual((t["installed"], t["state"], t["is_local"]), (True, "stopped", True))

        # 2. "Turn on": the system's password prompt is asked to start the service, then sign-in begins
        self.assertEqual(self.c.post("/tailscale/start")[0], 200)
        for _ in range(100):
            t = self.status()
            if not t["busy"]:
                break
            time.sleep(0.2)
        self.assertEqual(t["error"], "")
        self.assertEqual((t["state"], t["auth_url"]), ("needs_login", "https://login.tailscale.com/a/abc123"))
        with open(self.log) as f:
            calls = f.read()
        self.assertIn("pkexec /bin/sh -c systemctl enable --now tailscaled", calls)
        self.assertIn("tailscale up", calls)

        # a sign-in link that isn't Tailscale's is never passed on
        self.write_state({"BackendState": "NeedsLogin", "AuthURL": "https://evil.example.com/login"})
        self.assertEqual(self.status()["auth_url"], "")

        # 3. signed in: this computer's Tailscale address is offered to other devices
        self.write_state({"BackendState": "Running",
                          "Self": {"TailscaleIPs": ["100.101.102.103", "fd7a:115c:a1e0::1"], "DNSName": "office-pc.tail1234.ts.net."}})
        t = self.status()
        self.assertEqual((t["state"], t["ips"], t["name"]), ("connected", ["100.101.102.103"], "office-pc.tail1234.ts.net"))
        self.assertIn(f"http://100.101.102.103:{self.port}/", self.c.get("/network")[1]["urls"])

        # its own Tailscale name is accepted as an address; anyone else's isn't
        self.assertEqual(self.c.request("GET", "/api/meta", headers={"Host": f"office-pc.tail1234.ts.net:{self.port}"})[0], 200)
        self.assertEqual(self.c.request("GET", "/api/meta", headers={"Host": f"evil.tail9999.ts.net:{self.port}"})[0], 403)

    def test_only_the_two_official_downloads(self):
        with open(os.path.join(ROOT, "server.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertEqual(sorted(set(re.findall(r'TAILSCALE_\w+ = "(https://[^"]+)"', src))),
                         ["https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg", "https://tailscale.com/install.sh"])


@unittest.skipUnless(sys.platform.startswith("linux") and shutil.which("openssl"), "server mode is Linux only; needs openssl")
class TestPagesAfterAnUpdate(ServerCase):
    def test_script_and_style_links_carry_the_version(self):
        # so a browser can't keep an old cached app.js with a new page after an update
        version = self.c.get("/meta")[1]["version"]
        for path in ("/", "/jobs"):
            data = self.c.request("GET", path, raw=True)[2].decode()
            for f in ("theme.js", "style.css", "app.js"):
                self.assertIn(f'/static/{f}?v={version}"', data, (path, f))
        status, r, data = self.c.request("GET", "/static/app.js?v=" + version, raw=True)
        self.assertEqual(status, 200)
        self.assertEqual(r.getheader("Cache-Control"), "no-cache")
        self.assertFalse(os.path.exists(os.path.join(ROOT, "fix_frontend_cache.py")))


@unittest.skipUnless(shutil.which("openssl"), "needs the openssl tool")
class TestHttpsFromAnotherDevice(unittest.TestCase):
    """An admin turns HTTPS on from another device (a server often has no screen), and a certificate that can't
    be used is reported in Settings instead of HTTPS quietly staying off."""

    PASSCODE = "network-passcode"

    def setUp(self):  # each test gets a fresh data folder
        self.setup_server()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.stop)

    @classmethod
    def setup_server(cls):
        cls.ip = lan_ip()
        if not cls.ip:
            raise unittest.SkipTest("this machine has no network address")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        cls.env = dict(os.environ, HORAN_RMS_GITHUB_API="http://127.0.0.1:9", HORAN_RMS_PASSCODE=cls.PASSCODE)
        cls.base = [sys.executable, os.path.join(ROOT, "server.py"), "--port", str(cls.port), "--data", cls.tmp.name]
        for args in (["--set-passcode"], ["--network", "on"]):
            out = subprocess.run(cls.base + args, env=cls.env, capture_output=True, text=True, timeout=120)
            assert out.returncode == 0, out.stderr
        cls.proc = None
        cls.cookie = ""

    def sign_in_as_admin(self):
        self.assertEqual(self.call("POST", "/api/login", {"passcode": self.PASSCODE})[0], 200)
        self.assertEqual(self.call("POST", "/api/users", {"name": "Admin", "password": "correct horse"})[0], 200)

    @classmethod
    def start(cls):
        cls.proc = subprocess.Popen(cls.base, env=cls.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.wait_for("http")

    @classmethod
    def stop(cls):
        if cls.proc:
            cls.proc.terminate()
            cls.proc.wait(timeout=10)
            cls.proc = None

    @classmethod
    def wait_for(cls, scheme):
        for _ in range(150):
            try:
                if cls.call("GET", "/api/meta", scheme=scheme)[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.1)
        raise RuntimeError(f"server did not answer over {scheme}")

    @classmethod
    def call(cls, method, path, body=None, scheme="http"):
        """A request from "another device", to the machine's network address."""
        if scheme == "https":
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE   # like a device that clicked through the warning
            conn = http.client.HTTPSConnection(cls.ip, cls.port, context=ctx, timeout=30)
        else:
            conn = http.client.HTTPConnection(cls.ip, cls.port, timeout=30)
        h = dict(HDR)
        if cls.cookie:
            h["Cookie"] = cls.cookie
        conn.request(method, path, json.dumps(body) if body is not None else None, h)
        r = conn.getresponse()
        data = r.read()
        if r.getheader("Set-Cookie"):
            cls.cookie = r.getheader("Set-Cookie").split(";")[0]
        conn.close()
        try:
            return r.status, json.loads(data)
        except ValueError:
            return r.status, data

    def test_turn_on_from_another_device(self):
        self.start()
        self.sign_in_as_admin()
        n = self.call("GET", "/api/network")[1]
        self.assertEqual((n["is_local"], n["https"]["active"]), (False, False))

        status, n = self.call("PUT", "/api/network/https", {"enabled": True})
        self.assertEqual(status, 200, n)
        self.assertTrue(n["restarting"])
        time.sleep(1.5)
        self.wait_for("https")
        n = self.call("GET", "/api/network", scheme="https")[1]
        self.assertEqual((n["https"]["enabled"], n["https"]["active"], n["https"]["error"]), (True, True, ""))
        self.assertEqual(self.call("GET", "/jobs")[0], 301)   # plain http is sent to https

        # and back off again, over https
        status, n = self.call("PUT", "/api/network/https", {"enabled": False}, scheme="https")
        self.assertEqual(status, 200, n)
        time.sleep(1.5)
        self.wait_for("http")
        self.assertFalse(self.call("GET", "/api/network")[1]["https"]["active"])

    def test_a_certificate_that_cant_be_used_is_reported(self):
        out = subprocess.run(self.base + ["--https", "on"], env=self.env, capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr)
        # later, a certificate of your own that can't be used is put in the data folder
        tls = os.path.join(self.tmp.name, "tls")
        for name in ("own-cert.pem", "own-key.pem"):
            with open(os.path.join(tls, name), "w") as f:
                f.write("not a certificate\n")
        # the app still starts, on plain http, and Settings says why
        self.start()
        self.sign_in_as_admin()
        h = self.call("GET", "/api/network")[1]["https"]
        self.assertEqual((h["enabled"], h["active"]), (True, False))
        self.assertTrue(h["error"])
        # trying again from Settings says what's wrong instead of restarting into the same problem
        status, body = self.call("PUT", "/api/network/https", {"enabled": True})
        self.assertEqual(status, 400, body)
        self.assertIn("certificate", body["error"])
        # and the command line refuses too
        out = subprocess.run(self.base + ["--https", "on"], env=self.env, capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 1)


class TestTailscaleFromAnotherDevice(unittest.TestCase):
    """On a server with no screen, an admin sets Tailscale up from another device: over HTTPS, as a named admin,
    with the server's admin password (stand-ins for `sudo` and `tailscale` here)."""

    PASSCODE, SUDO = "network-passcode", "server-secret"

    @classmethod
    def setUpClass(cls):
        cls.ip = lan_ip()
        if not cls.ip:
            raise unittest.SkipTest("this machine has no network address")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        d = cls.tmp.name
        cls.data = os.path.join(d, "data")
        cls.bin, cls.state, cls.log = os.path.join(d, "bin"), os.path.join(d, "state.json"), os.path.join(d, "calls.log")
        os.mkdir(cls.bin)
        with open(cls.state, "w") as f:
            json.dump({"BackendState": "Stopped"}, f)
        scripts = {
            "tailscale": '#!/bin/sh\ncase "$1" in status) cat "$TS_STATE";; *) echo "tailscale $*" >> "$TS_LOG";; esac\n',
            "sudo": '#!/bin/sh\n[ "$1" = "-k" ] && [ $# -eq 1 ] && exit 0\nread pw\n'
                    'if [ "$pw" != "server-secret" ]; then echo "Sorry, try again." >&2; exit 1; fi\n'
                    'shift 5\necho "sudo $*" >> "$TS_LOG"\n[ "$1" = "true" ] && exit 0\n'
                    'echo \'{"BackendState": "NeedsLogin", "AuthURL": "https://login.tailscale.com/a/xyz"}\' > "$TS_STATE"\n',
        }
        for name, body in scripts.items():
            path = os.path.join(cls.bin, name)
            with open(path, "w") as f:
                f.write(body)
            os.chmod(path, 0o755)
        env = dict(os.environ, PATH=cls.bin + os.pathsep + os.environ.get("PATH", ""), TS_STATE=cls.state, TS_LOG=cls.log,
                   HORAN_RMS_GITHUB_API="http://127.0.0.1:9", HORAN_RMS_PASSCODE=cls.PASSCODE)
        base = [sys.executable, os.path.join(ROOT, "server.py"), "--port", str(cls.port), "--data", cls.data]
        for args in (["--set-passcode"], ["--network", "on"], ["--https", "on"]):
            out = subprocess.run(base + args, env=env, capture_output=True, text=True, timeout=120)
            assert out.returncode == 0, out.stderr
        cls.proc = subprocess.Popen(base + ["--headless"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.cookie = ""
        for _ in range(100):
            try:
                if cls.call("GET", "/api/meta")[0] == 200:
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.tmp.cleanup()

    @classmethod
    def call(cls, method, path, body=None):
        """A request from "another device": to the machine's network address, over https."""
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE   # like a device that clicked through the warning
        conn = http.client.HTTPSConnection(cls.ip, cls.port, context=ctx, timeout=30)
        h = dict(HDR)
        if cls.cookie:
            h["Cookie"] = cls.cookie
        conn.request(method, path, json.dumps(body) if body is not None else None, h)
        r = conn.getresponse()
        data = r.read()
        if r.getheader("Set-Cookie"):
            cls.cookie = r.getheader("Set-Cookie").split(";")[0]
        conn.close()
        try:
            return r.status, json.loads(data)
        except ValueError:
            return r.status, data

    def test_setup_from_another_device(self):
        call = self.call
        # signed in with only the shared passcode: not enough
        self.assertEqual(call("POST", "/api/login", {"passcode": self.PASSCODE})[0], 200)
        t = call("GET", "/api/tailscale?fresh=1")[1]
        self.assertEqual((t["is_local"], t["remote_ok"]), (False, False))
        self.assertIn("named admin", t["remote_why"])
        self.assertEqual(call("POST", "/api/tailscale/start", {"password": self.SUDO})[0], 403)

        # as a named admin, over https: allowed, with the server's admin password
        self.assertEqual(call("POST", "/api/users", {"name": "Admin", "password": "correct horse"})[0], 200)
        self.assertTrue(call("GET", "/api/tailscale?fresh=1")[1]["remote_ok"])
        self.assertEqual(call("POST", "/api/tailscale/start", {})[0], 400)
        status, body = call("POST", "/api/tailscale/start", {"password": "wrong"})
        self.assertEqual((status, body["error"]), (400, "That isn't the server's admin password"))
        self.assertFalse(os.path.exists(self.log))   # nothing was run

        self.assertEqual(call("POST", "/api/tailscale/start", {"password": self.SUDO})[0], 200)
        for _ in range(100):
            t = call("GET", "/api/tailscale?fresh=1")[1]
            if not t["busy"]:
                break
            time.sleep(0.2)
        self.assertEqual(t["error"], "")
        self.assertEqual((t["state"], t["auth_url"]), ("needs_login", "https://login.tailscale.com/a/xyz"))
        with open(self.log) as f:
            calls = f.read()
        self.assertIn("sudo /bin/sh -c systemctl enable --now tailscaled", calls)

        # the server's admin password is used once and kept nowhere
        self.assertNotIn(self.SUDO, calls)
        for base, _dirs, files in os.walk(self.data):
            for fn in files:
                with open(os.path.join(base, fn), "rb") as f:
                    self.assertNotIn(self.SUDO.encode(), f.read(), fn)
        self.assertNotIn(self.SUDO, json.dumps(call("GET", "/api/activity?limit=100")[1]))

        # and it can't be guessed through the app: five wrong tries, then a 15 minute wait
        seen = [call("POST", "/api/tailscale/start", {"password": f"guess{i}"})[0] for i in range(6)]
        self.assertEqual(seen[-1], 429)
        self.assertEqual(call("POST", "/api/tailscale/start", {"password": self.SUDO})[0], 429)


class TestJobs(ServerCase):
    def test_totals_with_and_without_vat(self):
        job = self.new_job()
        spk = self.product("AUD-LA12")
        self.c.post(f"/jobs/{job['id']}/items", {"product_id": spk["id"], "quantity": 2})
        t = self.c.get(f"/jobs/{job['id']}")[1]["totals"]
        self.assertEqual(t["net"], 2 * spk["day_rate"] * 2)
        self.assertAlmostEqual(t["vat"], round(t["net"] * 0.2, 2))
        self.assertAlmostEqual(t["total"], t["net"] + t["vat"])
        self.assertEqual(self.c.put("/settings", {"vat_registered": "0"})[0], 200)
        try:
            t = self.c.get(f"/jobs/{job['id']}")[1]["totals"]
            self.assertEqual((t["vat"], t["total"], t["vat_registered"]), (0, t["net"], False))
            status, _, data = self.c.request("POST", "/api/invoices/export", {"ids": [job["id"]], "format": "generic"}, raw=True)
            row = data.decode("utf-8-sig").splitlines()[1]
            self.assertIn(",0.00,", row)
        finally:
            self.c.put("/settings", {"vat_registered": "1"})
        self.assertGreater(self.c.get(f"/jobs/{job['id']}")[1]["totals"]["vat"], 0)

    def test_client_job_numbers(self):
        _, c = self.c.post("/contacts", {"name": "Acme", "job_prefix": "ACME-"})
        a = self.new_job(contact_id=c["id"])["number"]
        b = self.new_job(contact_id=c["id"])["number"]
        other = self.new_job()["number"]
        self.assertEqual((a, b), ("ACME-1", "ACME-2"))
        self.assertTrue(other.startswith("HAV-"))
        self.assertEqual(self.c.put(f"/contacts/{c['id']}", {"job_prefix": "A B"})[0], 400)

    def test_flight_case_packing(self):
        spk = self.product("AUD-LA12")
        _, trunk = self.c.post("/products", {"name": "Trunk", "item_type": "case", "sku": "TRUNK-T", "weight_kg": 12})
        job = self.new_job()
        jid = job["id"]
        self.c.post(f"/jobs/{jid}/items", {"product_id": spk["id"], "quantity": 2})
        _, r = self.c.post(f"/jobs/{jid}/check/scan", {"code": "TRUNK-T", "dir": "out"})
        self.assertEqual(r["result"], "case")
        _, r = self.c.post(f"/jobs/{jid}/cases", {"code": "TRUNK-T"})
        cid = r["open_case"]["id"]
        for _ in range(2):
            _, r = self.c.post(f"/jobs/{jid}/check/scan", {"code": "AUD-LA12", "dir": "out", "case_id": cid})
            self.assertEqual(r["result"], "ok")
        self.assertEqual(r["open_case"]["total_kg"], 12 + 2 * spk["weight_kg"])
        _, r = self.c.post(f"/jobs/{jid}/check/scan", {"code": "close-case", "dir": "out", "case_id": cid})
        self.assertEqual(r["result"], "case_closed")
        cases = self.c.get(f"/jobs/{jid}")[1]["cases"]
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["items"][0]["quantity"], 2)
        # the close code can't also be an item's barcode
        self.assertEqual(self.c.post("/products", {"name": "x", "sku": "CLOSE-CASE"})[0], 400)

    def test_history_is_per_job(self):
        a, b = self.new_job(name="History A"), self.new_job(name="History B")
        self.c.put(f"/jobs/{a['id']}", {"notes": "only on A"})
        self.c.put(f"/jobs/{b['id']}", {"notes": "only on B"})
        entries = self.c.get(f"/activity?job={a['id']}&limit=100")[1]
        self.assertTrue(entries)
        self.assertTrue(all(e["job_id"] == a["id"] for e in entries))

    def test_roi_history(self):
        spk = self.product("AUD-SUB18")
        job = self.new_job(start_date="2020-06-01", end_date="2020-06-03", discount_pct=10)
        self.c.post(f"/jobs/{job['id']}/items", {"product_id": spk["id"], "quantity": 4})
        self.c.put(f"/jobs/{job['id']}", {"status": "returned"})
        h = self.c.get(f"/products/{spk['id']}/roi")[1]["history"]
        self.assertEqual(h["all"]["unit_days"], 12)
        self.assertAlmostEqual(h["all"]["revenue"], 4 * 3 * spk["day_rate"] * 0.9)


class TestDiscountsAndTimes(ServerCase):
    def priced_job(self, **extra):
        job = self.new_job(**extra)
        _, job = self.c.post(f"/jobs/{job['id']}/items", {"product_id": self.product("AUD-LA12")["id"], "quantity": 2})
        self.assertGreater(job["totals"]["gross"], 0)
        return job

    def test_percentage_discount_on_the_whole_job(self):
        job = self.priced_job()
        gross = job["totals"]["gross"]
        status, job = self.c.put(f"/jobs/{job['id']}", {"discount_pct": 10, "discount_amount": 0})
        self.assertEqual(status, 200, job)
        t = job["totals"]
        self.assertEqual((t["discount"], t["discount_label"]), (round(gross * 0.1, 2), "10%"))
        self.assertEqual(t["net"], round(gross * 0.9, 2))

    def test_fixed_amount_discount_replaces_a_percentage(self):
        job = self.priced_job()
        gross = job["totals"]["gross"]
        self.c.put(f"/jobs/{job['id']}", {"discount_pct": 10})
        status, job = self.c.put(f"/jobs/{job['id']}", {"discount_amount": 25, "discount_pct": 0})
        self.assertEqual(status, 200, job)
        self.assertEqual((job["discount_pct"], job["discount_amount"]), (0, 25))
        t = job["totals"]
        self.assertEqual((t["discount"], t["discount_label"], t["net"]), (25, "", round(gross - 25, 2)))
        self.assertAlmostEqual(t["discount_share_pct"], 100 * 25 / gross, places=3)
        # never more than the job itself
        job = self.c.put(f"/jobs/{job['id']}", {"discount_amount": 10 ** 6})[1]
        self.assertEqual((job["totals"]["discount"], job["totals"]["net"]), (gross, 0))
        # and setting a percentage again clears the amount
        job = self.c.put(f"/jobs/{job['id']}", {"discount_pct": 5})[1]
        self.assertEqual((job["discount_pct"], job["discount_amount"]), (5, 0))
        # it's on the printed quote
        status, r, data = self.c.request("POST", "/api/invoices/pdf", {"ids": [job["id"]], "doc": "quote"}, raw=True)
        self.assertEqual(status, 200)
        text = b"".join(zlib.decompress(m) for m in re.findall(rb"stream\n(.*?)\nendstream", data, re.S))
        self.assertIn(rb"Discount \(5%\)", text)   # brackets are escaped in PDF text

    def test_discounts_are_checked(self):
        job = self.priced_job()
        for body in ({"discount_pct": 120}, {"discount_pct": -1}, {"discount_amount": -5},
                     {"discount_pct": 5, "discount_amount": 5}):
            self.assertEqual(self.c.put(f"/jobs/{job['id']}", body)[0], 400, body)

    def test_start_and_end_times(self):
        job = self.new_job(start_time="9:00", end_time="18:30")
        self.assertEqual((job["start_time"], job["end_time"]), ("09:00", "18:30"))
        job = self.c.put(f"/jobs/{job['id']}", {"end_time": ""})[1]
        self.assertEqual((job["start_time"], job["end_time"]), ("09:00", ""))
        self.assertEqual(self.c.put(f"/jobs/{job['id']}", {"start_time": "25:00"})[0], 400)
        # a one-day job can't end before it starts; over several days it can
        one = self.new_job(start_date="2030-02-01", end_date="2030-02-01")
        self.assertEqual(self.c.put(f"/jobs/{one['id']}", {"start_time": "19:00", "end_time": "08:00"})[0], 400)
        self.assertEqual(self.c.put(f"/jobs/{job['id']}", {"start_time": "19:00", "end_time": "08:00"})[0], 200)
        # a copy keeps the times
        status, copy = self.c.post(f"/jobs/{job['id']}/duplicate", {})
        self.assertEqual(status, 200, copy)
        self.assertEqual((copy["start_time"], copy["end_time"]), ("19:00", "08:00"))


class TestCategories(ServerCase):
    def add(self, name, category, subcategory=""):
        status, p = self.c.post("/products", {"name": name, "category": category, "subcategory": subcategory})
        self.assertEqual(status, 200, p)
        return p

    def cat_of(self, p):
        p = self.c.get(f"/products/{p['id']}")[1]
        p = p.get("product", p)
        return p["category"], p["subcategory"]

    def move(self, src, dst):
        return self.c.put("/categories", {"from": src, "to": dst})

    def test_rename_a_category_and_a_subcategory(self):
        a = self.add("Par can", "Test lights")
        b = self.add("Moving head", "Test lights", "Movers")
        status, r = self.move({"category": "test LIGHTS"}, {"category": "Test lighting"})   # any case finds it
        self.assertEqual((status, r["changed"]), (200, 2), r)
        self.assertEqual((self.cat_of(a), self.cat_of(b)), (("Test lighting", ""), ("Test lighting", "Movers")))
        self.move({"category": "Test lighting", "subcategory": "Movers"}, {"category": "Test lighting", "subcategory": "Moving heads"})
        self.assertEqual(self.cat_of(b), ("Test lighting", "Moving heads"))
        names = {c["name"]: c for c in self.c.get("/categories")[1]}
        self.assertEqual(names["Test lighting"]["count"], 2)
        self.assertEqual([s["name"] for s in names["Test lighting"]["subcategories"]], ["Moving heads"])
        self.assertIn("Renamed subcategory", self.c.get("/activity")[1][0]["summary"])

    def test_put_a_category_inside_another(self):
        a = self.add("Hazer", "Effects")
        b = self.add("Confetti cannon", "Effects", "Pyro")
        self.add("Strobe", "Lamps")
        self.assertEqual(self.move({"category": "Effects"}, {"category": "Lamps", "subcategory": "Effects"})[0], 200)
        self.assertEqual((self.cat_of(a), self.cat_of(b)), (("Lamps", "Effects"), ("Lamps", "Effects - Pyro")))
        self.assertNotIn("Effects", [c["name"] for c in self.c.get("/categories")[1]])
        # and back out: a subcategory made a main category of its own
        self.move({"category": "Lamps", "subcategory": "Effects"}, {"category": "Effects"})
        self.assertEqual(self.cat_of(a), ("Effects", ""))
        # move a subcategory to another category
        self.move({"category": "Lamps", "subcategory": "Effects - Pyro"}, {"category": "Effects", "subcategory": "Pyro"})
        self.assertEqual(self.cat_of(b), ("Effects", "Pyro"))

    def test_moves_are_checked(self):
        self.add("Thing", "Bits")
        self.assertEqual(self.move({"category": "Bits"}, {"category": ""})[0], 400)
        self.assertEqual(self.move({"category": "Bits"}, {"category": "Bits", "subcategory": "Bits"})[0], 400)
        self.assertEqual(self.move({"category": "No such category"}, {"category": "X"})[0], 404)
        self.assertEqual(self.move({"category": "Bits"}, {"category": "x" * 81})[0], 400)

    def test_the_icon_goes_with_a_renamed_category(self):
        self.add("Widget", "Gadgets")
        self.assertEqual(self.c.put("/icons", {"target": "cat:Gadgets", "lib": "star"})[0], 200)
        self.move({"category": "Gadgets"}, {"category": "Gizmos"})
        icons = self.c.get("/settings")[1]["custom_icons"]
        self.assertIn("cat:gizmos", icons)
        self.assertNotIn("cat:gadgets", icons)


class TestSettings(ServerCase):
    def test_layout_is_checked(self):
        bad = json.dumps({"logo_position": "sideways", "colour": "red;}", "title": "Estimate", "evil": 1, "show_rate": 0})
        self.assertEqual(self.c.put("/settings", {"doc_layout_quote": bad})[0], 200)
        saved = json.loads(self.c.get("/settings")[1]["doc_layout_quote"])
        self.assertEqual(saved, {"title": "Estimate", "show_rate": False})
        self.assertEqual(self.c.put("/settings", {"doc_layout_quote": "{not json"})[0], 400)

    def test_pdf_downloads(self):
        job = self.new_job()
        self.c.post(f"/jobs/{job['id']}/items", {"product_id": self.product("AUD-LA12")["id"], "quantity": 1})
        status, r, data = self.c.request("POST", "/api/invoices/pdf", {"ids": [job["id"]], "doc": "quote"}, raw=True)
        self.assertEqual(status, 200)
        self.assertTrue(data.startswith(b"%PDF-"))

    def test_uploads_are_checked(self):
        self.assertEqual(self.c.put("/sounds", {"kind": "ok", "data_url": "data:text/html;base64,PGI+"})[0], 400)
        self.assertEqual(self.c.put("/icons", {"target": "../../etc", "lib": "star"})[0], 400)
        self.assertEqual(self.c.put("/settings", {"brand_primary": "red"})[0], 400)

    def test_auto_update_setting(self):
        self.assertEqual(self.c.put("/update/auto", {"mode": "check", "time": "25:00"})[0], 400)
        self.assertEqual(self.c.put("/update/auto", {"mode": "sometimes"})[0], 400)
        self.assertEqual(self.c.put("/update/auto", {"mode": "check", "time": "04:30"})[1]["time"], "04:30")


class TestRelease(unittest.TestCase):
    """The things the release workflow relies on."""

    def test_version_has_a_changelog_entry(self):
        with open(os.path.join(ROOT, "server.py"), encoding="utf-8") as f:
            version = re.search(r'^VERSION = "([^"]+)"', f.read(), re.M).group(1)
        with open(os.path.join(ROOT, "static", "changelog.json"), encoding="utf-8") as f:
            log = json.load(f)
        self.assertEqual(log["versions"][0]["version"], version)
        with open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8") as f:
            self.assertIn(f"## {version} ", f.read())


if __name__ == "__main__":
    unittest.main()
