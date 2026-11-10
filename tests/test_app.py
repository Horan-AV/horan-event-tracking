"""End-to-end tests: start the real server on a throwaway data folder and use its API.

Run from the project folder with:  python3 -m unittest discover -s tests -v
Uses only the Python standard library, like the app itself.
"""
import http.client
import json
import os
import re
import socket
import stat
import subprocess
import sys
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
        assert admin.post("/users", {"name": "Admin", "pin": "1111"})[0] == 200
        assert admin.post("/login", {"user_id": 1, "pin": "1111"})[0] == 200
        status, sam = admin.post("/users", {"name": "Sam", "pin": "2222", "is_admin": False})
        assert status == 200, sam
        cls.sam = Client(cls.port)
        assert cls.sam.post("/login", {"user_id": sam["id"], "pin": "2222"})[0] == 200

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
            sam.post("/users", {"name": "Eve", "pin": "3333", "is_admin": True}),
            sam.put("/users/1", {"pin": "9999"}),
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
        self.assertEqual(self.c.post("/users", {"name": "Admin", "pin": "1111"})[0], 200)
        guesser = Client(self.port)
        seen = [guesser.post("/login", {"user_id": 1, "pin": f"000{i}"})[0] for i in range(7)]
        self.assertEqual(seen[:5], [401] * 5)
        self.assertEqual(seen[5:], [429, 429])
        # even the right PIN is refused while locked out
        self.assertEqual(guesser.post("/login", {"user_id": 1, "pin": "1111"})[0], 429)


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
