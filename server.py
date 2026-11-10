#!/usr/bin/env python3
"""
Horan Event Tracking - a local, offline rental and event management system.

Runs entirely on your own machine using only the Python standard library
(no pip installs), stores everything in a single SQLite file and serves the
interface to your browser on http://127.0.0.1:8765.

Publisher: Horan AV (James Horan)
"""
import argparse
import itertools
import math
import base64
import binascii
import zlib
import csv
import datetime as dt
import hashlib
import hmac
import ipaddress
import secrets
import socket
import io
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sqlite3
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlencode, urlparse

VERSION = "1.27.0"
# Where "Update from GitHub" looks for new releases (owner/repository). Set this to your own repository
# before publishing; it can also be changed in Settings > Software update.
GITHUB_REPO = "Horan-AV/horan-event-tracking"
APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")

DATA_DIR = ""
DB_PATH = ""
HOST = "127.0.0.1"
PORT = 8765
HOST_FROM_SETTINGS = True
HEADLESS = False  # started with --headless: a server with no screen of its own

STATUSES = ["enquiry", "quote", "provisional", "confirmed", "out",
            "returned", "invoiced", "cancelled", "lost"]
HARD = ("confirmed", "out")          # firmly reserve stock
SOFT = ("provisional",)              # shown as a warning, not a hard booking
OPEN_STATUSES = ("enquiry", "quote", "provisional", "confirmed", "out")
KINDS = ("rental", "sale", "service")
ITEM_TYPES = ("equipment", "cable", "power", "package", "case")
MAX_RANGE_DAYS = 400

# Venue power supplies the power check can plan against (amps per phase).
POWER_SUPPLIES = [
    {"key": "uk13", "label": "UK 13A wall socket", "amps": 13, "phases": 1, "plug": "UK 13A"},
    {"key": "cee16", "label": "16A CEE single-phase (blue)", "amps": 16, "phases": 1, "plug": "16A CEE"},
    {"key": "cee32", "label": "32A CEE single-phase (blue)", "amps": 32, "phases": 1, "plug": "32A CEE"},
    {"key": "cee63", "label": "63A CEE single-phase", "amps": 63, "phases": 1, "plug": "63A CEE"},
    {"key": "tp16", "label": "16A three-phase (red)", "amps": 16, "phases": 3, "plug": "16A 3-phase"},
    {"key": "tp32", "label": "32A three-phase (red)", "amps": 32, "phases": 3, "plug": "32A 3-phase"},
    {"key": "tp63", "label": "63A three-phase", "amps": 63, "phases": 3, "plug": "63A 3-phase"},
    {"key": "tp125", "label": "125A three-phase", "amps": 125, "phases": 3, "plug": "125A 3-phase"},
]
SUPPLY_BY_KEY = {x["key"]: x for x in POWER_SUPPLIES}

DEFAULT_SETTINGS = {
    "company_name": "Horan AV",
    "company_address": "",
    "company_email": "",
    "company_phone": "",
    "company_website": "",
    "vat_number": "",
    "company_number": "",
    "vat_rate": "20",
    "vat_registered": "1",   # 0 = not VAT registered: no VAT is added to quotes, invoices or exports
    "currency": "£",
    "job_prefix": "HAV-",
    "next_job_number": "1001",
    "quote_terms": "This quotation is valid for 30 days. All equipment remains the property of "
                   "Horan AV. The hirer is responsible for loss of or damage to equipment from "
                   "delivery until collection.",
    "mains_voltage": "230",
    "default_supply": "uk13",
    "cable_run_preference": "excess",
    "safe_load_pct": "80",
    "default_plug_type": "UK 13A",
    "brand_primary": "#1f5c3d",
    "brand_accent": "#c9a227",
    "brand_grey": "#55595e",
    "show_included_accessories": "0",
    "network_access": "0",   # 1 = other devices on the network can use the app (with the passcode)
    # Look: light/dark mode and their colours, and fonts ("" = default, "stack:serif", "local:Name", "upload:<id>")
    "theme_default": "system",
    "light_bg": "#f3f4f1", "light_surface": "#ffffff", "light_text": "#1b201e",
    "light_sidebar": "#ffffff", "light_sidebar_text": "#1b201e",
    "dark_bg": "#121514", "dark_surface": "#1b1f1d", "dark_text": "#e8ebe9",
    "dark_sidebar": "#0e1311", "dark_sidebar_text": "#e8ebe9",
    "font_body": "", "font_heading": "",
    "overdue_grace_days": "0",   # days after the return date before a hire with kit still out counts as overdue
    "me_alias": "", "me_company": "",  # optional "your details" when there are no users (for request credits)
    "app_name": "Horan Event Tracking",   # what the app is called on screen (sidebar, tab, sign-in)
    # invoices
    "invoice_prefix": "", "payment_terms_days": "30", "payment_details": "",
    "invoice_terms": "Payment is due within 30 days of the invoice date. Please quote the invoice number with your payment.",
    # accounting software exports
    "accounting_software": "",   # quickbooks | xero | zoho | sage50 | sagecloud
    "acc_tax_code": "", "acc_sales_account": "", "acc_item_names": "kind",
    "update_repo": "",   # GitHub owner/repository for updates ("" = the one built into this version)
    "case_close_code": "CLOSE-CASE",   # scanning this at check-out closes the flight case being packed
    # automatic updates: none | check (look at a set time, offer it on the next page load) | install (at a set time)
    "auto_update_mode": "none", "auto_update_time": "03:00",
    # {"nav:jobs": {"lib": "speaker"} | {"file": 1, "tint": true}, "cat:audio": ...} - set with /api/icons
    "custom_icons": "{}",
    "custom_sounds": "{}",   # {"ok": {"name": "ding.mp3", "v": 123}, ...} - set with /api/sounds
    # quote / invoice layouts (JSON): one shared, or one each - see DOC_LAYOUT_DEFAULT
    "doc_layout_shared": "1", "doc_layout_quote": "", "doc_layout_invoice": "",
}
# Settings only the computer running the app may change (never from a phone or another computer).
LOCAL_ONLY_SETTINGS = {"network_access", "auto_update_mode", "auto_update_time", "custom_icons", "custom_sounds"}  # set elsewhere  # auto-update: /api/update/auto

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    ctype      TEXT NOT NULL,
    data       BLOB NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_images (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ctype      TEXT NOT NULL,
    data       BLOB NOT NULL,
    thumb      BLOB,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_images ON product_images(product_id, sort);
CREATE TABLE IF NOT EXISTS vendors (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    phone        TEXT NOT NULL DEFAULT '',
    address      TEXT NOT NULL DEFAULT '',
    website      TEXT NOT NULL DEFAULT '',
    account_ref  TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    archived     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS requests (
    id           INTEGER PRIMARY KEY,
    ref          TEXT NOT NULL UNIQUE,
    kind         TEXT NOT NULL DEFAULT 'feature',
    title        TEXT NOT NULL,
    details      TEXT NOT NULL DEFAULT '',
    submitted_by TEXT NOT NULL DEFAULT '',
    user_id      INTEGER,
    alias        TEXT NOT NULL DEFAULT '',
    company      TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    app_version  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'open',
    done_version TEXT NOT NULL DEFAULT '',
    done_at      TEXT
);
CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    pin_hash   TEXT NOT NULL DEFAULT '',
    is_admin   INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    last_seen  TEXT
);
CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY,
    at         TEXT NOT NULL,
    user_id    INTEGER,
    user_name  TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL,
    summary    TEXT NOT NULL,
    job_id     INTEGER,
    product_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_job ON activity(job_id, id);
CREATE INDEX IF NOT EXISTS idx_activity_product ON activity(product_id, id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, id);
CREATE TABLE IF NOT EXISTS package_items (
    id         INTEGER PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity   REAL NOT NULL DEFAULT 1,
    sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_package_items ON package_items(package_id, sort);
CREATE TABLE IF NOT EXISTS package_excludes (
    package_item_id INTEGER NOT NULL REFERENCES package_items(id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (package_item_id, product_id)
);
CREATE TABLE IF NOT EXISTS room_plans (
    job_id     INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS product_alternatives (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    alt_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sort       INTEGER NOT NULL DEFAULT 0,
    UNIQUE(product_id, alt_id)
);
CREATE TABLE IF NOT EXISTS check_notes (
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    direction  TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    note       TEXT NOT NULL DEFAULT '',
    user_name  TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (job_id, direction, product_id)
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen  TEXT NOT NULL,
    ip         TEXT NOT NULL DEFAULT '',
    agent      TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS products (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL,
    category          TEXT NOT NULL DEFAULT '',
    sku               TEXT NOT NULL DEFAULT '',
    quantity          INTEGER NOT NULL DEFAULT 0,
    day_rate          REAL NOT NULL DEFAULT 0,
    replacement_value REAL NOT NULL DEFAULT 0,
    weight_kg         REAL NOT NULL DEFAULT 0,
    notes             TEXT NOT NULL DEFAULT '',
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    company    TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    address    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS jobs (
    id             INTEGER PRIMARY KEY,
    number         TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    contact_id     INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    venue          TEXT NOT NULL DEFAULT '',
    reference      TEXT NOT NULL DEFAULT '',
    start_date     TEXT NOT NULL,
    end_date       TEXT NOT NULL,
    charge_days    REAL,
    status         TEXT NOT NULL DEFAULT 'enquiry',
    discount_pct   REAL NOT NULL DEFAULT 0,
    notes          TEXT NOT NULL DEFAULT '',
    internal_notes TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS job_items (
    id           INTEGER PRIMARY KEY,
    job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL DEFAULT 'rental',
    description  TEXT NOT NULL DEFAULT '',
    quantity     REAL NOT NULL DEFAULT 1,
    unit_price   REAL NOT NULL DEFAULT 0,
    days         REAL,
    discount_pct REAL NOT NULL DEFAULT 0,
    sort         INTEGER NOT NULL DEFAULT 0,
    parent_item_id INTEGER REFERENCES job_items(id) ON DELETE CASCADE,
    accessory_qty  REAL
);
CREATE TABLE IF NOT EXISTS product_accessories (
    id           INTEGER PRIMARY KEY,
    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    accessory_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity     REAL NOT NULL DEFAULT 1,
    charged      INTEGER NOT NULL DEFAULT 0,
    sort         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (product_id, accessory_id)
);
CREATE TABLE IF NOT EXISTS assets (
    id            INTEGER PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    asset_number  TEXT NOT NULL UNIQUE,
    serial_number TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'ok',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quarantine (
    id          INTEGER PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    asset_id    INTEGER REFERENCES assets(id) ON DELETE CASCADE,
    quantity    REAL NOT NULL DEFAULT 1,
    reason      TEXT NOT NULL DEFAULT '',
    started_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TEXT
);
CREATE TABLE IF NOT EXISTS job_sections (
    id        INTEGER PRIMARY KEY,
    job_id    INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES job_sections(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    notes     TEXT NOT NULL DEFAULT '',
    sort      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS job_checks (
    id         INTEGER PRIMARY KEY,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    direction  TEXT NOT NULL DEFAULT 'out',
    quantity   REAL NOT NULL DEFAULT 1,
    asset_id   INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS job_cases (
    id         INTEGER PRIMARY KEY,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    asset_id   INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    code       TEXT NOT NULL DEFAULT '',
    label      TEXT NOT NULL DEFAULT '',
    room       TEXT NOT NULL DEFAULT '',
    opened_by  TEXT NOT NULL DEFAULT '',
    opened_at  TEXT NOT NULL,
    closed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_job ON job_cases(job_id);
CREATE INDEX IF NOT EXISTS idx_sections_job ON job_sections(job_id);
CREATE INDEX IF NOT EXISTS idx_checks_job ON job_checks(job_id, direction);
CREATE INDEX IF NOT EXISTS idx_assets_product ON assets(product_id);
CREATE INDEX IF NOT EXISTS idx_quarantine_product ON quarantine(product_id, released_at);
CREATE INDEX IF NOT EXISTS idx_items_job ON job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON job_items(product_id);
CREATE INDEX IF NOT EXISTS idx_jobs_dates ON jobs(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
"""


# ---------------------------------------------------------------- helpers

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class Raw:
    """A non-JSON response (file downloads, images, HTML)."""
    def __init__(self, body, content_type, filename=None, extra_headers=None):
        self.body = body if isinstance(body, bytes) else body.encode("utf-8")
        self.content_type = content_type
        self.filename = filename
        self.extra_headers = extra_headers or {}


def now_iso():
    return dt.datetime.now().isoformat(timespec="seconds")


def parse_date(value, field="date"):
    if not isinstance(value, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        raise ApiError(400, f"{field} must be a date in YYYY-MM-DD format")
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise ApiError(400, f"{field} is not a valid date")


def inclusive_days(start, end):
    return (parse_date(end) - parse_date(start)).days + 1


def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def rows(cursor):
    return [dict(r) for r in cursor.fetchall()]


def one(cursor):
    r = cursor.fetchone()
    return dict(r) if r else None


def get_settings(conn):
    s = dict(DEFAULT_SETTINGS)
    for r in conn.execute("SELECT key, value FROM settings WHERE key NOT LIKE 'zoho\\_%' ESCAPE '\\' "
                          "AND key NOT LIKE 'secret\\_%' ESCAPE '\\'"):
        s[r["key"]] = r["value"]
    s["has_logo"] = file_has(conn, "logo_light")
    s["has_logo_dark"] = file_has(conn, "logo_dark")
    s["has_icon"] = file_has(conn, "icon_512")
    s["zoho_connected"] = bool(get_secret(conn, "zoho_refresh_token"))
    return s


def as_float(v, field, allow_none=False):
    if v is None or v == "":
        if allow_none:
            return None
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        raise ApiError(400, f"{field} must be a number")


def as_int(v, field, allow_none=False):
    if v is None or v == "":
        if allow_none:
            return None
        return 0
    try:
        return int(float(v))
    except (TypeError, ValueError):
        raise ApiError(400, f"{field} must be a whole number")


def as_str(v, field):
    if v is None:
        return ""
    return str(v).strip()


def clean(data, spec, partial=False):
    """Validate and coerce incoming fields against a {field: coercer} spec."""
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object")
    out = {}
    for field, coerce in spec.items():
        if field in data:
            out[field] = coerce(data[field], field)
        elif not partial and getattr(coerce, "required", False):
            raise ApiError(400, f"{field} is required")
    return out


def required(fn):
    def wrapper(v, field):
        val = fn(v, field)
        if val in ("", None):
            raise ApiError(400, f"{field} is required")
        return val
    wrapper.required = True
    return wrapper


def date_field(v, field):
    parse_date(v, field)
    return v


date_field_req = required(date_field)


def status_field(v, field):
    if v not in STATUSES:
        raise ApiError(400, f"status must be one of: {', '.join(STATUSES)}")
    return v


def kind_field(v, field):
    if v not in KINDS:
        raise ApiError(400, f"kind must be one of: {', '.join(KINDS)}")
    return v


def float_or_none(v, field):
    return as_float(v, field, allow_none=True)


def type_field(v, field):
    v = as_str(v, field) or "equipment"
    if v not in ITEM_TYPES:
        raise ApiError(400, "Stock type must be equipment, cable, power, package or flight case")
    return v


def supply_field(v, field):
    v = as_str(v, field)
    if v and v not in SUPPLY_BY_KEY:
        raise ApiError(400, "Unknown power supply")
    return v


def int_or_none(v, field):
    return as_int(v, field, allow_none=True)


def bool_int(v, field):
    return 1 if v in (True, 1, "1", "true", "yes", "on") else 0


PRODUCT_SPEC = {
    "name": required(as_str), "category": as_str, "subcategory": as_str, "sku": as_str, "brand": as_str,
    "sub_hire": bool_int, "vendor_id": int_or_none, "sub_hire_cost": as_float,
    "quantity": as_int, "day_rate": as_float, "replacement_value": as_float,
    "weight_kg": as_float, "notes": as_str, "archived": bool_int,
    "cable_type": as_str, "length_m": float_or_none, "joiner_product_id": int_or_none,
    "power_watts": as_float, "plug_type": as_str, "sockets": as_int, "socket_type": as_str,
    "power_rating_a": as_float, "item_type": lambda v, f: type_field(v, f),
    "plugs_in": bool_int, "power_cable": bool_int, "deck_w": float_or_none, "deck_d": float_or_none,
    "skirt_len": float_or_none, "skirt_height": float_or_none, "skirt_style": as_str, "skirt_colour": as_str,
    "equip_kind": as_str, "stand_height_mode": as_str, "stand_h": float_or_none, "stand_h_min": float_or_none,
    "stand_h_max": float_or_none, "stand_h_steps": as_str, "stand_load_kg": float_or_none,
    "size_w": float_or_none, "size_d": float_or_none, "size_h": float_or_none, "plan_shape": as_str,
    "inner_w": float_or_none, "inner_d": float_or_none, "inner_h": float_or_none, "case_for_id": int_or_none,
}
CASE_FIELDS = {"inner_w", "inner_d", "inner_h", "case_for_id"}
SIZE_FIELDS = {"size_w", "size_d", "size_h", "plan_shape"}
# Equipment comes in kinds; each kind only keeps the fields that make sense for it.
EQUIP_KINDS = {
    "powered": ("Powered equipment", "Speakers, lighting, video, mixers - anything that plugs in", {"power_watts", "plugs_in"}),
    "stand": ("Stand, truss or rigging", "Speaker and lighting stands, T-bars, truss, lifts",
              {"stand_height_mode", "stand_h", "stand_h_min", "stand_h_max", "stand_h_steps", "stand_load_kg"}),
    "deck": ("Stage deck", "Used by the stage calculator", {"deck_w", "deck_d"}),
    "skirt": ("Stage skirt", "Used by the stage calculator", {"skirt_len", "skirt_height", "skirt_style", "skirt_colour"}),
    "staging": ("Staging accessory", "Legs, clamps, steps, handrails", set()),
    "general": ("Other equipment", "Cases, drape, furniture - nothing that plugs in", set()),
}
KIND_FIELDS = set().union(*(v[2] for v in EQUIP_KINDS.values()))


def fill_equip_kinds(conn):
    """Equipment from older versions or a CSV import has no kind yet: work out a sensible one."""
    for r in conn.execute("SELECT id, name, category, deck_w, skirt_len, plugs_in, power_watts FROM products "
                          "WHERE item_type = 'equipment' AND (equip_kind = '' OR equip_kind IS NULL)").fetchall():
        conn.execute("UPDATE products SET equip_kind = ? WHERE id = ?", (guess_kind(r), r["id"]))


def guess_kind(p):
    text = f"{p['name']} {p['category']}".lower()
    if (p["deck_w"] or 0) > 0:
        return "deck"
    if (p["skirt_len"] or 0) > 0:
        return "skirt"
    if p["plugs_in"] or (p["power_watts"] or 0) > 0:
        return "powered"
    if re.search(r"\bstand|truss|tripod|t-?bar|lift|wind-?up|boom", text):
        return "stand"
    if re.search(r"\bleg|clamp|step|stair|handrail|riser|stage", text):
        return "staging"
    if re.search(r"speaker|sub|mixer|desk|mic|receiver|projector|screen|display|led|light|wash|spot|amp|processor|camera", text):
        return "powered"
    return "general"


def parse_steps(text):
    vals = []
    for part in re.split(r"[,;/\s]+", str(text or "")):
        part = part.strip().lower().rstrip("m")
        if not part:
            continue
        try:
            v = float(part)
        except ValueError:
            raise ApiError(400, "Stepped heights should be numbers in metres, e.g. 1.2, 1.6, 2.0")
        if v <= 0 or v > 30:
            raise ApiError(400, "Heights are in metres, e.g. 1.2")
        vals.append(v)
    return sorted(set(vals))


def check_size(data):
    for k in ("size_w", "size_d", "size_h", "inner_w", "inner_d", "inner_h"):
        v = data.get(k)
        if v is not None and (v < 0 or v > 5000):
            raise ApiError(400, "Sizes are in centimetres, e.g. 43")
    if data.get("plan_shape") not in (None, "", "box", "round"):
        raise ApiError(400, "Shape must be box or round")


def check_stand(data):
    mode = data.get("stand_height_mode")
    if mode not in (None, "", "fixed", "range", "stepped"):
        raise ApiError(400, "Height must be fixed, a range or stepped")
    for k in ("stand_h", "stand_h_min", "stand_h_max"):
        v = data.get(k)
        if v is not None and (v < 0 or v > 30):
            raise ApiError(400, "Stand heights are in metres, e.g. 1.2")
    if mode == "range":
        lo, hi = data.get("stand_h_min"), data.get("stand_h_max")
        if lo is None or hi is None:
            raise ApiError(400, "Enter the lowest and highest height")
        if lo > hi:
            raise ApiError(400, "The lowest height is more than the highest")
    if mode == "stepped":
        steps = parse_steps(data.get("stand_h_steps"))
        if not steps:
            raise ApiError(400, "Enter the heights it can be set to, e.g. 1.2, 1.6, 2.0")
        data["stand_h_steps"] = ", ".join(fmt_num(v) for v in steps)
    if mode == "fixed" and data.get("stand_h") is None:
        raise ApiError(400, "Enter the stand's height")
    lk = data.get("stand_load_kg")
    if lk is not None and lk < 0:
        raise ApiError(400, "Maximum load can't be negative")
    # only keep the height fields for the chosen mode
    keep = {"fixed": {"stand_h"}, "range": {"stand_h_min", "stand_h_max"}, "stepped": {"stand_h_steps"}}.get(mode or "", set())
    if mode is not None:
        for k in ("stand_h", "stand_h_min", "stand_h_max", "stand_h_steps"):
            if k not in keep:
                data[k] = "" if k == "stand_h_steps" else None
# Which fields belong to which kind of stock - anything else is cleared on save.
POWER_CABLE_FIELDS = {"sockets", "socket_type", "power_rating_a", "plug_type"}
TYPE_FIELDS = {
    "equipment": {"power_watts", "plugs_in", "deck_w", "deck_d", "skirt_len", "skirt_height", "skirt_style",
                  "skirt_colour", "sub_hire", "vendor_id", "sub_hire_cost", "equip_kind", "stand_height_mode", "stand_h",
                  "stand_h_min", "stand_h_max", "stand_h_steps", "stand_load_kg"} | SIZE_FIELDS,
    "cable": {"cable_type", "length_m", "joiner_product_id", "power_cable"} | POWER_CABLE_FIELDS,
    "power": {"sockets", "socket_type", "power_rating_a", "plug_type", "sub_hire", "vendor_id", "sub_hire_cost"} | SIZE_FIELDS,
    "package": set(),
    "case": SIZE_FIELDS | CASE_FIELDS,
}
TYPE_RESET = {"power_watts": 0, "cable_type": "", "length_m": None, "joiner_product_id": None,
              "sockets": 0, "socket_type": "", "power_rating_a": 0, "plug_type": "",
              "plugs_in": 0, "power_cable": 0, "deck_w": None, "deck_d": None,
              "skirt_len": None, "skirt_height": None, "skirt_style": "", "skirt_colour": "",
              "sub_hire": 0, "vendor_id": None, "sub_hire_cost": 0, "equip_kind": "",
              "stand_height_mode": "", "stand_h": None, "stand_h_min": None, "stand_h_max": None, "stand_h_steps": "",
              "stand_load_kg": None, "size_w": None, "size_d": None, "size_h": None, "plan_shape": "",
              "inner_w": None, "inner_d": None, "inner_h": None, "case_for_id": None}
CONTACT_SPEC = {
    "name": required(as_str), "company": as_str, "email": as_str, "phone": as_str,
    "address": as_str, "notes": as_str, "archived": bool_int, "account_ref": as_str,
    "job_prefix": as_str, "next_job_number": int_or_none,
}


def check_contact_numbering(data):
    if "job_prefix" in data:
        data["job_prefix"] = data["job_prefix"].strip()
        if len(data["job_prefix"]) > 20 or re.search(r"[\s/\\]", data["job_prefix"]):
            raise ApiError(400, "A job number prefix is up to 20 characters, with no spaces or slashes — e.g. ACME-")
    n = data.get("next_job_number")
    if n is not None and not 1 <= n <= 10 ** 9:
        raise ApiError(400, "The client's next job number must be 1 or more")
JOB_SPEC = {
    "name": required(as_str), "contact_id": int_or_none, "venue": as_str,
    "reference": as_str, "start_date": date_field_req, "end_date": date_field_req,
    "charge_days": float_or_none, "status": status_field, "discount_pct": as_float,
    "notes": as_str, "internal_notes": as_str, "power_supply": lambda v, f: supply_field(v, f),
}
ITEM_SPEC = {
    "section_id": int_or_none,
    "product_id": int_or_none, "kind": kind_field, "description": as_str,
    "quantity": as_float, "unit_price": as_float, "days": float_or_none,
    "discount_pct": as_float, "sort": as_int,
}


AUTO_BY = {"jobs": ("created_by", "created_by_id"), "job_items": ("added_by",), "job_checks": ("user_name", "user_id")}


def insert(conn, table, data):
    for col in AUTO_BY.get(table, ()):  # remember who did it
        if col not in data and actor_name():
            data = dict(data, **{col: actor_id() if col in ("user_id", "created_by_id") else actor_name()})
    cols = ", ".join(data.keys())
    marks = ", ".join("?" for _ in data)
    cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(data.values()))
    return cur.lastrowid


def update(conn, table, row_id, data):
    if not data:
        return
    sets = ", ".join(f"{k} = ?" for k in data)
    conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", list(data.values()) + [row_id])


def get_secret(conn, key, default=""):
    r = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return r["value"] if r and r["value"] is not None else default


def set_secret(conn, key, value):
    conn.execute("INSERT INTO settings(key, value) VALUES(?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, "" if value is None else str(value)))


# ---------------------------------------------------------------- pricing

def charge_days(job):
    if job.get("charge_days") not in (None, ""):
        return float(job["charge_days"])
    return float(inclusive_days(job["start_date"], job["end_date"]))


def price_items(job, items):
    cdays = charge_days(job)
    for it in items:
        if it["kind"] == "rental":
            days = it["days"] if it["days"] is not None else cdays
        else:
            days = 1.0
        it["effective_days"] = days
        it["line_total"] = round(
            (it["quantity"] or 0) * (it["unit_price"] or 0) * days * (1 - (it["discount_pct"] or 0) / 100.0), 2)
    return items


def totals(job, items, vat_rate, registered=True):
    by_kind = {k: 0.0 for k in KINDS}
    for it in items:
        by_kind[it["kind"]] = by_kind.get(it["kind"], 0.0) + it["line_total"]
    gross = sum(by_kind.values())
    discount = gross * (job.get("discount_pct") or 0) / 100.0
    net = gross - discount
    vat = net * vat_rate / 100.0
    return {
        "rental": round(by_kind["rental"], 2),
        "sale": round(by_kind["sale"], 2),
        "service": round(by_kind["service"], 2),
        "gross": round(gross, 2),
        "discount": round(discount, 2),
        "net": round(net, 2),
        "vat_rate": vat_rate,
        "vat_registered": bool(registered),
        "vat": round(vat, 2),
        "total": round(net + vat, 2),
        "charge_days": charge_days(job),
    }


def vat_registered(conn):
    return get_settings(conn).get("vat_registered", "1") != "0"


def vat_rate_of(conn):
    """The VAT rate to charge: 0 when the business isn't VAT registered."""
    if not vat_registered(conn):
        return 0.0
    try:
        return float(get_settings(conn).get("vat_rate") or 0)
    except ValueError:
        return 0.0


def load_items(conn, job_ids):
    if not job_ids:
        return {}
    marks = ",".join("?" for _ in job_ids)
    res = {jid: [] for jid in job_ids}
    for r in conn.execute(
            f"""SELECT ji.*, p.name AS product_name, p.category AS product_category, p.subcategory AS product_subcategory,
                       p.quantity AS product_quantity, p.weight_kg AS product_weight, p.brand AS product_brand,
                       p.sku AS product_sku, p.sub_hire AS product_sub_hire, p.vendor_id AS product_vendor_id,
                       v.name AS vendor_name, p.sub_hire_cost AS product_sub_hire_cost,
                       COALESCE(sv.name, CASE WHEN ji.sub_vendor_id IS NULL THEN v.name END) AS sub_vendor_name
                FROM job_items ji LEFT JOIN products p ON p.id = ji.product_id
                LEFT JOIN vendors v ON v.id = p.vendor_id
                LEFT JOIN vendors sv ON sv.id = ji.sub_vendor_id
                WHERE ji.job_id IN ({marks}) ORDER BY ji.sort, ji.id""", job_ids):
        res[r["job_id"]].append(dict(r))
    return res


# ---------------------------------------------------------------- availability

def usage_by_day(conn, start, end, exclude_job=None):
    """Return {product_id: {iso_date: [hard_qty, soft_qty]}} for the range."""
    s0, e0 = parse_date(start, "start"), parse_date(end, "end")
    if e0 < s0:
        raise ApiError(400, "end must be on or after start")
    if (e0 - s0).days > MAX_RANGE_DAYS:
        raise ApiError(400, f"Date range is limited to {MAX_RANGE_DAYS} days")
    sql = """SELECT ji.product_id AS pid, MAX(ji.quantity - COALESCE(ji.sub_qty, 0), 0) AS qty, j.start_date AS s,
                    j.end_date AS e, j.status AS st
             FROM job_items ji JOIN jobs j ON j.id = ji.job_id
             WHERE ji.product_id IS NOT NULL AND ji.kind = 'rental'
               AND j.status IN ('provisional', 'confirmed', 'out')
               AND j.start_date <= ? AND j.end_date >= ?"""
    params = [end, start]
    if exclude_job is not None:
        sql += " AND j.id != ?"
        params.append(exclude_job)
    use = {}
    one_day = dt.timedelta(days=1)
    for r in conn.execute(sql, params):
        a = max(dt.date.fromisoformat(r["s"]), s0)
        b = min(dt.date.fromisoformat(r["e"]), e0)
        idx = 0 if r["st"] in HARD else 1
        day = a
        while day <= b:
            slot = use.setdefault(r["pid"], {}).setdefault(day.isoformat(), [0.0, 0.0])
            slot[idx] += r["qty"] or 0
            day += one_day
    return use


def peaks(day_map):
    if not day_map:
        return 0.0, 0.0
    hard = max(v[0] for v in day_map.values())
    both = max(v[0] + v[1] for v in day_map.values())
    return hard, both


def quarantined_map(conn):
    """Units currently out of service, per product."""
    return {r["product_id"]: r["q"] or 0 for r in conn.execute(
        "SELECT product_id, SUM(quantity) AS q FROM quarantine WHERE released_at IS NULL GROUP BY product_id")}


SUB_HIRE_UNLIMITED = 9999


def sub_units_by_day(conn, start, end):
    """Sub-hired units you've added to stock: {product_id: {iso_date: count}} for the days they're with you."""
    s0, e0 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    out = {}
    one_day = dt.timedelta(days=1)
    for r in conn.execute("SELECT product_id, hire_from, hire_to FROM assets WHERE sub_hire = 1 "
                          "AND (hire_to IS NULL OR hire_to >= ?) AND (hire_from IS NULL OR hire_from <= ?)", (start, end)):
        a = max(dt.date.fromisoformat(r["hire_from"]), s0) if r["hire_from"] else s0
        b = min(dt.date.fromisoformat(r["hire_to"]), e0) if r["hire_to"] else e0
        while a <= b:
            m = out.setdefault(r["product_id"], {})
            k = a.isoformat()
            m[k] = m.get(k, 0) + 1
            a += one_day
    return out


def free_over(base, day_use, day_sub, start, end):
    """Free (firm, and if provisionals confirm) on the tightest day of the range.
    base = owned minus quarantined; sub-hired units only count on the days you have them."""
    if not day_sub:
        hard, both = peaks(day_use)
        return base - hard, base - both
    d, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    fh = fb = None
    while d <= e:
        k = d.isoformat()
        u = day_use.get(k, (0, 0))
        have = base + day_sub.get(k, 0)
        fh = have - u[0] if fh is None else min(fh, have - u[0])
        fb = have - u[0] - u[1] if fb is None else min(fb, have - u[0] - u[1])
        d += dt.timedelta(days=1)
    return fh, fb


def availability_summary(conn, start, end, exclude_job=None):
    use = usage_by_day(conn, start, end, exclude_job)
    subs = sub_units_by_day(conn, start, end)
    qmap = quarantined_map(conn)
    out = []
    for p in conn.execute("SELECT id, name, brand, category, subcategory, quantity, day_rate, sku, cable_type, length_m, item_type, "
                          "sub_hire, (SELECT name FROM vendors v WHERE v.id = products.vendor_id) AS vendor_name, "
                          "(SELECT i.id FROM product_images i WHERE i.product_id = products.id ORDER BY i.sort, i.id LIMIT 1) AS image_id, "
                          "(SELECT COUNT(*) FROM product_accessories a WHERE a.product_id = products.id) AS acc "
                          "FROM products WHERE archived = 0 AND NOT (item_type = 'cable' AND parent_id IS NULL) "
                          "ORDER BY category, subcategory, name, length_m"):
        hard, both = peaks(use.get(p["id"], {}))
        usable = p["quantity"] - qmap.get(p["id"], 0)
        day_sub = subs.get(p["id"], {})
        free_h, free_b = free_over(usable, use.get(p["id"], {}), day_sub, start, end)
        sub_n = max(day_sub.values(), default=0)
        if p["sub_hire"] or p["item_type"] == "package":  # hired in as needed / just a set of other items: never "short"
            usable = SUB_HIRE_UNLIMITED + hard + both
            free_h, free_b = usable - hard, usable - both
        out.append({
            "product_id": p["id"], "name": p["name"], "brand": p["brand"], "category": p["category"],
            "subcategory": p["subcategory"], "sku": p["sku"],
            "day_rate": p["day_rate"], "quantity": p["quantity"], "quarantined": qmap.get(p["id"], 0),
            "usable": usable, "peak_booked": hard, "peak_with_provisional": both,
            "available": free_h,
            "available_after_provisional": free_b, "sub_units": sub_n,
            "accessory_count": p["acc"], "cable_type": p["cable_type"], "length_m": p["length_m"],
            "item_type": p["item_type"], "sub_hire": bool(p["sub_hire"]), "vendor_name": p["vendor_name"],
            "image_id": p["image_id"],
        })
    return out


def job_availability(conn, job, items):
    """Shortage check for every product on a job against all other jobs."""
    use = usage_by_day(conn, job["start_date"], job["end_date"], exclude_job=job["id"])
    subs = sub_units_by_day(conn, job["start_date"], job["end_date"])
    demand, subbed = {}, {}
    for it in items:
        if it["kind"] == "rental" and it["product_id"]:
            q = it["quantity"] or 0
            sq = min(q, it.get("sub_qty") or 0)
            demand[it["product_id"]] = demand.get(it["product_id"], 0) + q - sq
            subbed[it["product_id"]] = subbed.get(it["product_id"], 0) + sq
    res = {}
    qmap = quarantined_map(conn)
    alt_n = {r[0]: r[1] for r in conn.execute("SELECT product_id, COUNT(*) FROM product_alternatives GROUP BY product_id")}
    for pid, need in demand.items():
        p = conn.execute("SELECT quantity, sub_hire, (SELECT name FROM vendors v WHERE v.id = products.vendor_id) AS vendor "
                         "FROM products WHERE id = ?", (pid,)).fetchone()
        owned = p["quantity"] if p else 0
        if p and conn.execute("SELECT 1 FROM products WHERE id = ? AND item_type = 'package'", (pid,)).fetchone():
            continue  # a package isn't stock itself - its contents are checked line by line
        if p and p["sub_hire"]:
            res[pid] = {"sub_hire": True, "vendor": p["vendor"], "this_job": need, "owned": 0, "quarantined": 0,
                        "booked_elsewhere": 0, "provisional_elsewhere": 0, "remaining": 0,
                        "remaining_after_provisional": 0, "shortage": 0, "provisional_shortage": 0}
            continue
        quar = qmap.get(pid, 0)
        usable = owned - quar
        hard, both = peaks(use.get(pid, {}))
        day_sub = subs.get(pid, {})
        free_h, free_b = free_over(usable, use.get(pid, {}), day_sub, job["start_date"], job["end_date"])
        res[pid] = {
            "owned": owned, "quarantined": quar, "booked_elsewhere": hard,
            "provisional_elsewhere": both - hard, "this_job": need,
            "sub_units": max(day_sub.values(), default=0),
            "remaining": free_h - need,
            "remaining_after_provisional": free_b - need,
            # never more than this job needs from your own stock (other jobs may be over-booked too)
            "shortage": min(need, max(0, need - free_h)),
            "provisional_shortage": min(need, max(0, need - free_b)),
            "alternatives": alt_n.get(pid, 0),
            "sub_hired": subbed.get(pid, 0),
        }
    return res


# ---------------------------------------------------------------- routing

ROUTES = []


def route(method, pattern):
    regex = re.compile("^" + pattern + "$")

    def deco(fn):
        ROUTES.append((method, regex, fn))
        return fn
    return deco


# ---- requests (ideas and problems to send in), your details, and the change log

REQUEST_KINDS = {"feature": "New feature", "change": "Change to something", "problem": "Problem / bug"}
_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I


def new_instance_id():
    return "".join(secrets.choice(_ID_CHARS) for _ in range(6))


def instance_id(conn):
    return get_secret(conn, "instance_id") or "UNKNOWN"


def load_changelog():
    try:
        with open(os.path.join(STATIC_DIR, "changelog.json"), encoding="utf-8") as f:
            return json.load(f).get("versions", [])
    except (OSError, ValueError):
        return []


def apply_fulfilled(conn):
    """Requests that an installed version delivers are marked done (and leave the open list)."""
    for v in load_changelog():
        if version_tuple(v.get("version", "0")) > version_tuple(VERSION):
            continue
        refs = list(v.get("fulfils") or []) + [c["request"] for c in v.get("changes", []) if isinstance(c, dict) and c.get("request")]
        for ref in refs:
            conn.execute("UPDATE requests SET status = 'done', done_version = ?, done_at = ? WHERE ref = ? COLLATE NOCASE "
                         "AND status = 'open'", (v["version"], now_iso(), str(ref).strip()))


def my_identity(conn, req):
    u = current_user(conn, req)
    if u:
        r = conn.execute("SELECT alias, company FROM users WHERE id = ?", (u["id"],)).fetchone()
        return {"who": u["name"], "user_id": u["id"], "alias": r["alias"] if r else "", "company": r["company"] if r else ""}
    st = get_settings(conn)
    return {"who": "This computer" if not req.remote else "This device", "user_id": None,
            "alias": st.get("me_alias", ""), "company": st.get("me_company", "")}


@route("GET", "/api/me/identity")
def api_identity(req, conn):
    return my_identity(conn, req)


@route("PUT", "/api/me/identity")
def api_identity_put(req, conn):
    d = req.json() or {}
    alias = as_str(d.get("alias"), "alias")[:80]
    company = as_str(d.get("company"), "company")[:120]
    u = current_user(conn, req)
    if u:
        conn.execute("UPDATE users SET alias = ?, company = ? WHERE id = ?", (alias, company, u["id"]))
    else:
        for k, v in (("me_alias", alias), ("me_company", company)):
            conn.execute("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, v))
    conn.commit()
    return my_identity(conn, req)


def request_rows(conn, status):
    return rows(conn.execute("SELECT * FROM requests WHERE status = ? ORDER BY id DESC", (status,)))


@route("GET", "/api/requests")
def api_requests(req, conn):
    apply_fulfilled(conn)
    conn.commit()
    return {"instance_id": instance_id(conn), "kinds": REQUEST_KINDS, "me": my_identity(conn, req),
            "open": request_rows(conn, "open"), "done": request_rows(conn, "done")[:50]}


@route("POST", "/api/requests")
def api_requests_post(req, conn):
    d = req.json() or {}
    title = as_str(d.get("title"), "title")[:200]
    details = as_str(d.get("details"), "details")[:5000]
    kind = d.get("kind") if d.get("kind") in REQUEST_KINDS else "feature"
    if not title:
        raise ApiError(400, "Give the request a short title")
    me = my_identity(conn, req)
    n = int(get_secret(conn, "next_request_number") or "1")
    while conn.execute("SELECT 1 FROM requests WHERE ref = ?", (f"{instance_id(conn)}-{n:04d}",)).fetchone():
        n += 1
    ref = f"{instance_id(conn)}-{n:04d}"
    conn.execute("INSERT INTO settings(key, value) VALUES('next_request_number', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(n + 1),))
    insert(conn, "requests", {"ref": ref, "kind": kind, "title": title, "details": details, "submitted_by": me["who"],
                              "user_id": me["user_id"], "alias": me["alias"], "company": me["company"],
                              "created_at": now_iso(), "app_version": VERSION})
    conn.commit()
    out = api_requests(req, conn)
    out["added"] = ref
    return out


def own_request(conn, req, rid):
    r = one(conn.execute("SELECT * FROM requests WHERE id = ?", (rid,)))
    if not r:
        raise ApiError(404, "Request not found")
    u = current_user(conn, req)
    if users_exist(conn) and not (u and (u["is_admin"] or u["id"] == r["user_id"])):
        raise ApiError(403, "Only the person who made a request, or an admin, can change it")
    return r


@route("PUT", r"/api/requests/(\d+)")
def api_request_put(req, conn, rid):
    own_request(conn, req, rid)
    d = req.json() or {}
    data = {}
    if "title" in d:
        data["title"] = as_str(d["title"], "title")[:200]
        if not data["title"]:
            raise ApiError(400, "Give the request a short title")
    if "details" in d:
        data["details"] = as_str(d["details"], "details")[:5000]
    if d.get("kind") in REQUEST_KINDS:
        data["kind"] = d["kind"]
    update(conn, "requests", rid, data)
    conn.commit()
    return api_requests(req, conn)


@route("DELETE", r"/api/requests/(\d+)")
def api_request_delete(req, conn, rid):
    own_request(conn, req, rid)
    conn.execute("DELETE FROM requests WHERE id = ?", (rid,))
    conn.commit()
    return api_requests(req, conn)


@route("GET", "/api/export/requests.csv")
def export_requests(req, conn):
    apply_fulfilled(conn)
    conn.commit()
    status = "done" if req.q("status") == "done" else "open"
    st = get_settings(conn)
    data = request_rows(conn, status)
    for r in data:
        r.update({"request_id": r["ref"], "instance_id": instance_id(conn), "install_name": st.get("company_name", ""),
                  "server": socket.gethostname(), "type": REQUEST_KINDS.get(r["kind"], r["kind"]),
                  "name_alias": r["alias"], "submitted_at": r["created_at"], "current_version": VERSION})
    return csv_response(f"horan-event-tracking-requests-{instance_id(conn)}-{dt.date.today().isoformat()}.csv",
                        ["request_id", "instance_id", "install_name", "server", "status", "type", "title", "details",
                         "submitted_by", "name_alias", "company", "submitted_at", "app_version", "current_version",
                         "done_version"], data)


@route("GET", "/api/changelog")
def api_changelog(req, conn):
    return {"current": VERSION, "versions": load_changelog()}


# ---- meta / settings

@route("GET", "/api/meta")
def api_meta(req, conn):
    if not req.signed_in:  # before signing in: just enough for the launchers to see it's running
        return {"version": VERSION, "signed_in": False}
    u = current_user(conn, req)
    admin = (not users_exist(conn)) or bool(u and u["is_admin"])
    return {"version": VERSION, "data_dir": DATA_DIR if admin else "", "signed_in": True,
            "remote": req.remote, "server_name": socket.gethostname(), "users_enabled": users_exist(conn),
            "user": u and {"id": u["id"], "name": u["name"], "is_admin": bool(u["is_admin"])},
            "is_admin": (not users_exist(conn)) or bool(u and u["is_admin"]),
            "headless": HEADLESS, "can_update": (not req.remote) or HEADLESS,
            "github_repo": GITHUB_REPO,
            "app_backups": list_app_backups() if admin else [],
            "statuses": STATUSES, "kinds": list(KINDS), "power_supplies": POWER_SUPPLIES,
            "today": dt.date.today().isoformat()}


@route("GET", "/api/settings")
def api_settings(req, conn):
    return get_settings(conn)


@route("PUT", "/api/settings")
def api_settings_put(req, conn):
    require_admin(req, conn)
    data = req.json()
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object")
    for k, v in data.items():
        if k not in DEFAULT_SETTINGS or k in LOCAL_ONLY_SETTINGS:
            continue
        v = "" if v is None else str(v)
        if k == "vat_rate":
            as_float(v, "VAT rate")
        if k == "next_job_number":
            as_int(v, "Next job number")
        if k in ("doc_layout_quote", "doc_layout_invoice"):
            v = json.dumps(clean_doc_layout(v)) if v.strip() else ""
        if k == "doc_layout_shared" and v not in ("0", "1"):
            raise ApiError(400, "Document layout must be shared or separate")
        if k == "case_close_code":
            v = v.strip()
            if not v:
                raise ApiError(400, "The flight case close code can't be empty")
            if conn.execute("SELECT 1 FROM assets WHERE asset_number = ? COLLATE NOCASE", (v,)).fetchone() or \
                    conn.execute("SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE AND sku != ''", (v,)).fetchone():
                raise ApiError(400, f"{v} is already a barcode on your stock — choose a different close code")
        if k == "cable_run_preference" and v not in ("excess", "joins"):
            raise ApiError(400, "Cable run preference must be 'excess' or 'joins'")
        if k.startswith(("brand_", "light_", "dark_")) and v and not re.match(r"^#[0-9a-fA-F]{6}$", v):
            raise ApiError(400, f"{k} must be a hex colour like #1f5c3d")
        if k == "theme_default" and v not in ("system", "light", "dark"):
            raise ApiError(400, "Theme must be system, light or dark")
        if k == "overdue_grace_days":
            g = as_int(v or 0, "Days before overdue")
            if not 0 <= g <= 60:
                raise ApiError(400, "Days before overdue must be between 0 and 60")
            v = str(g)
        if k in ("me_alias", "me_company"):
            continue  # set with /api/me/identity
        if k == "payment_terms_days":
            g = as_int(v or 0, "Payment terms (days)")
            if not 0 <= g <= 365:
                raise ApiError(400, "Payment terms must be between 0 and 365 days")
            v = str(g)
        if k == "accounting_software" and v and v not in ACCOUNTING:
            raise ApiError(400, "Choose QuickBooks, Xero, Zoho Books or Sage")
        if k == "acc_item_names" and v not in ("kind", "item"):
            raise ApiError(400, "Item names must be 'kind' or 'item'")
        if k == "update_repo":
            v = v.strip()
            if v != (get_settings(conn).get("update_repo") or "") and req.remote and not HEADLESS:
                raise ApiError(403, "Where updates come from can only be changed on the computer running this app")
            if v.startswith("https://github.com/"):
                v = v[len("https://github.com/"):].strip("/")
            if v.endswith(".git"):
                v = v[:-4]
            if v and not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", v):
                raise ApiError(400, "The GitHub repository should look like owner/name, e.g. horanav/horan-event-tracking")
        if k == "app_name":
            v = v.strip()[:60] or DEFAULT_SETTINGS["app_name"]
        if k.startswith("font_"):
            if len(v) > 120 or not re.match(r"^(|stack:[a-z]+|upload:\d+|local:[^;{}<>\"\\]+)$", v):
                raise ApiError(400, "That font choice isn't valid")
        conn.execute("INSERT INTO settings(key, value) VALUES(?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, v))
    conn.commit()
    if "app_name" in data and not req.remote:
        rename_desktop_entry(app_name(conn))
    return get_settings(conn)


def rename_desktop_entry(name):
    """Best effort (Linux): the app-menu entry takes the app's name too."""
    try:
        desk = os.path.join(os.path.expanduser("~"), ".local", "share", "applications", "horan-rms.desktop")
        if not sys.platform.startswith("linux") or not os.path.exists(desk):
            return
        clean_name = re.sub(r"[\r\n]+", " ", name).strip()
        with open(desk, encoding="utf-8") as f:
            text = f.read()
        new = re.sub(r"(?m)^Name=.*$", lambda m: "Name=" + clean_name, text, count=1)
        if new != text:
            with open(desk, "w", encoding="utf-8") as f:
                f.write(new)
    except OSError:
        pass


# ---------------------------------------------------------------- network access (other devices)

SESSION_COOKIE = "het_session"
SESSION_DAYS = 180
LOGIN_FAILS = {}            # ip -> [timestamps of failed passcode attempts]
LOGIN_LOCK = threading.Lock()


def hash_passcode(passcode, salt=None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", passcode.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return f"{salt}${dk.hex()}"


def check_passcode(conn, passcode):
    stored = get_secret(conn, "secret_passcode")
    if not stored or "$" not in stored:
        return False
    salt = stored.split("$", 1)[0]
    return hmac.compare_digest(hash_passcode(passcode, salt), stored)


def is_loopback(ip):
    try:
        a = ipaddress.ip_address(ip)
        return a.is_loopback or (a.version == 6 and a.ipv4_mapped is not None and a.ipv4_mapped.is_loopback)
    except ValueError:
        return False


def lan_addresses():
    """This computer's addresses that other devices on the network can reach."""
    ips = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
            sk.connect(("10.255.255.255", 1))  # no packet is sent; just picks the outgoing interface
            ips.append(sk.getsockname()[0])
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return [ip for ip in ips if not ip.startswith("127.") and not ip.startswith("169.254.")]


def session_for(conn, token):
    if not token:
        return None
    th = hashlib.sha256(token.encode()).hexdigest()
    row = one(conn.execute("SELECT * FROM sessions WHERE token_hash = ?", (th,)))
    if not row:
        return None
    seen = dt.datetime.fromisoformat(row["last_seen"])
    if dt.datetime.now() - seen > dt.timedelta(days=SESSION_DAYS):
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))
        conn.commit()
        return None
    if dt.datetime.now() - seen > dt.timedelta(minutes=10):
        conn.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now_iso(), th))
        conn.commit()
    return row


def network_info(conn, req):
    enabled = get_settings(conn)["network_access"] == "1"
    listening = HOST not in ("127.0.0.1", "localhost", "::1")
    hostname = socket.gethostname().split(".")[0]
    urls = [f"http://{ip}:{PORT}/" for ip in lan_addresses()]
    if hostname:
        urls.append(f"http://{hostname}.local:{PORT}/")
    sess = rows(conn.execute("SELECT s.token_hash, s.created_at, s.last_seen, s.ip, s.agent, u.name AS user_name FROM sessions s "
                             "LEFT JOIN users u ON u.id = s.user_id ORDER BY s.last_seen DESC"))
    mine = req.session["token_hash"] if req.session else None
    return {
        "enabled": enabled, "listening": listening, "port": PORT, "urls": urls if listening else [],
        "has_passcode": bool(get_secret(conn, "secret_passcode")), "is_local": not req.remote,
        "can_enable": bool(get_secret(conn, "secret_passcode")) or users_exist(conn),
        "restart_needed": enabled != listening and HOST_FROM_SETTINGS,
        "fixed_host": not HOST_FROM_SETTINGS,
        "devices": [{"id": x["token_hash"][:12], "created_at": x["created_at"], "last_seen": x["last_seen"],
                     "ip": x["ip"], "agent": x["agent"], "user_name": x["user_name"],
                     "current": x["token_hash"] == mine} for x in sess],
        "users": users_exist(conn),
    }


def local_only(req, headless_ok=False):
    """Some things can only be done on the computer running the app. A headless server has no screen of its own,
    so there (headless_ok) an admin can do them from any signed-in device instead."""
    if req.remote and not (headless_ok and HEADLESS):
        raise ApiError(403, "That can only be done on the computer running this app")


@route("GET", "/api/network")
def api_network(req, conn):
    info = network_info(conn, req)
    if not is_admin(conn, req):  # who's signed in, and from where, is for admins
        info["devices"] = [d for d in info["devices"] if d["current"]]
        info["urls"] = []
    return info


@route("PUT", "/api/network")
def api_network_put(req, conn):
    require_admin(req, conn)
    local_only(req)
    d = req.json() or {}
    enabled = bool(d.get("enabled"))
    passcode = str(d.get("passcode") or "")
    if passcode:
        if len(passcode) < 6:
            raise ApiError(400, "Use a passcode of at least 6 characters")
        set_secret(conn, "secret_passcode", hash_passcode(passcode))
        conn.execute("DELETE FROM sessions")  # new passcode: every device signs in again
    if enabled and not get_secret(conn, "secret_passcode") and not users_exist(conn):
        raise ApiError(400, "Set a passcode first — other devices need it to sign in")
    set_secret(conn, "network_access", "1" if enabled else "0")
    conn.commit()
    info = network_info(conn, req)
    if HOST_FROM_SETTINGS and enabled != (HOST != "127.0.0.1"):
        info["restarting"] = True
        restart_soon()
    return info


@route("DELETE", "/api/network/devices")
def api_network_devices_delete(req, conn):
    """Sign out every other device."""
    require_admin(req, conn)
    mine = req.session["token_hash"] if req.session else ""
    conn.execute("DELETE FROM sessions WHERE token_hash != ?", (mine,))
    conn.commit()
    return network_info(conn, req)


@route("POST", "/api/login")
def api_login(req, conn):
    ip = req.handler.client_address[0]
    now = time.time()
    with LOGIN_LOCK:
        fails = [t for t in LOGIN_FAILS.get(ip, []) if now - t < 300]
        LOGIN_FAILS[ip] = fails
        if len(fails) >= 5:
            raise ApiError(429, "Too many wrong passcodes. Wait 5 minutes and try again.")
    d = req.json() or {}
    remote_blocked = req.remote and get_settings(conn)["network_access"] != "1"
    user = None
    target = None
    if users_exist(conn):
        uid = as_int(d.get("user_id"), "user_id", allow_none=True)
        target = f"user:{uid}"
        with LOGIN_LOCK:
            ufails = [t for t in LOGIN_FAILS.get(target, []) if now - t < 900]
            LOGIN_FAILS[target] = ufails
            if len(ufails) >= 10:
                raise ApiError(429, "Too many wrong PINs for this person. Wait 15 minutes, or ask an admin to reset the PIN.")
        user = None if remote_blocked or not uid else check_user_pin(conn, uid, str(d.get("pin") or ""))
        ok = user is not None
        msg = "That PIN isn't right"
    else:
        ok = not remote_blocked and req.remote and check_passcode(conn, str(d.get("passcode") or ""))
        msg = "That passcode isn't right"
    if not ok:
        with LOGIN_LOCK:
            LOGIN_FAILS.setdefault(ip, []).append(now)
            if target:
                LOGIN_FAILS.setdefault(target, []).append(now)
        time.sleep(0.5)
        raise ApiError(401, msg)
    if req.session:  # switching person on this device: replace the old sign-in
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (req.session["token_hash"],))
    new_session(conn, req, user["id"] if user else None)
    if user:
        conn.execute("UPDATE users SET last_seen = ? WHERE id = ?", (now_iso(), user["id"]))
        ACTOR.user_id, ACTOR.name = user["id"], user["name"]
        log_activity(conn, "user", "Signed in" + (f" from {deviceish(req)}" if req.remote else ""))
    conn.commit()
    with LOGIN_LOCK:
        LOGIN_FAILS.pop(ip, None)
        if target:
            LOGIN_FAILS.pop(target, None)
    return {"ok": True}


def deviceish(req):
    a = req.handler.headers.get("User-Agent") or ""
    for key, label in (("iPhone", "an iPhone"), ("iPad", "an iPad"), ("Android", "an Android device"), ("Macintosh", "a Mac"),
                       ("Windows", "a Windows PC"), ("Linux", "a Linux computer")):
        if key in a:
            return label
    return "another device"


@route("POST", "/api/logout")
def api_logout(req, conn):
    if req.session:
        if req.session.get("user_id"):
            log_activity(conn, "user", "Signed out")
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (req.session["token_hash"],))
        conn.commit()
    req.set_cookie = f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
    return {"ok": True}


# ---------------------------------------------------------------- users & activity

ACTOR = threading.local()   # who is making the current request: .user_id, .name (set per request)


def actor_name():
    return getattr(ACTOR, "name", None) or ""


def actor_id():
    return getattr(ACTOR, "user_id", None)


def users_exist(conn):
    return bool(conn.execute("SELECT 1 FROM users WHERE active = 1 LIMIT 1").fetchone())


def check_user_pin(conn, uid, pin):
    u = one(conn.execute("SELECT * FROM users WHERE id = ? AND active = 1", (uid,)))
    if not u or not u["pin_hash"] or "$" not in u["pin_hash"]:
        return None
    salt = u["pin_hash"].split("$", 1)[0]
    return u if hmac.compare_digest(hash_passcode(pin, salt), u["pin_hash"]) else None


def current_user(conn, req):
    """The signed-in person for this request (None when nobody needs to sign in)."""
    if req.session and req.session.get("user_id"):
        return one(conn.execute("SELECT id, name, is_admin FROM users WHERE id = ? AND active = 1",
                                (req.session["user_id"],)))
    return None


def job_editors(job):
    try:
        return [int(x) for x in json.loads(job.get("editors") or "[]")]
    except (ValueError, TypeError):
        return []


def can_edit_job(conn, req, job):
    """A locked job can only be changed by the people chosen for it, its creator and admins."""
    if not job or not job.get("edit_lock") or not users_exist(conn):
        return True
    u = current_user(conn, req)
    if not u:
        return False
    return bool(u["is_admin"]) or u["id"] == job.get("created_by_id") or u["id"] in job_editors(job)


def require_job_edit(conn, req, job_id):
    job = one(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)))
    if job and not can_edit_job(conn, req, job):
        names = [r[0] for r in conn.execute(
            f"SELECT name FROM users WHERE id IN ({','.join('?' * len(job_editors(job))) or 'NULL'})", job_editors(job))]
        who = ", ".join(names + ([job["created_by"]] if job.get("created_by") else []))
        raise ApiError(403, f"{job['number']} is locked — only {who or 'its editors'} or an admin can change it")


def job_of(conn, fn_name, groups):
    """Which job a request changes (for the per-job lock)."""
    g = groups[0] if groups else None
    if not g:
        return None
    if fn_name in ("api_job_put", "api_job_delete", "api_section_post", "api_cable_run", "api_stage", "api_items_post",
                   "api_job_zoho", "api_job_zoho_unlink", "api_plan_put"):
        return int(g)
    if fn_name in ("api_item_put", "api_item_delete", "api_stage_put", "api_item_swap", "api_item_subhire"):
        r = conn.execute("SELECT job_id FROM job_items WHERE id = ?", (g,)).fetchone()
        return r and r[0]
    if fn_name in ("api_section_put", "api_section_move", "api_section_delete"):
        r = conn.execute("SELECT job_id FROM job_sections WHERE id = ?", (g,)).fetchone()
        return r and r[0]
    return None


@route("PUT", r"/api/jobs/(\d+)/lock")
def api_job_lock(req, conn, jid):
    job = one(conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)))
    if not job:
        raise ApiError(404, "Job not found")
    if not users_exist(conn):
        raise ApiError(400, "Add users first (Settings → Users) — then you can choose who may edit each job")
    if not can_edit_job(conn, req, job):
        raise ApiError(403, "Only this job's editors or an admin can change who edits it")
    d = req.json() or {}
    editors = sorted({int(x) for x in (d.get("editors") or [])})
    if editors:
        known = {r[0] for r in conn.execute(f"SELECT id FROM users WHERE id IN ({','.join('?' * len(editors))})", editors)}
        if set(editors) - known:
            raise ApiError(400, "One of those people doesn't exist")
    locked = 1 if d.get("locked") else 0
    me = current_user(conn, req)
    if locked and me and not me["is_admin"] and me["id"] != job.get("created_by_id") and me["id"] not in editors:
        editors.append(me["id"])  # don't lock yourself out
    conn.execute("UPDATE jobs SET edit_lock = ?, editors = ? WHERE id = ?", (locked, json.dumps(editors), jid))
    conn.commit()
    return job_detail(conn, int(jid))


def is_admin(conn, req):
    if not users_exist(conn):
        return True
    u = current_user(conn, req)
    return bool(u and u["is_admin"])


def require_admin(req, conn):
    if users_exist(conn):
        u = current_user(conn, req)
        if not u or not u["is_admin"]:
            raise ApiError(403, "Only an admin can change that — ask someone with admin access")


def new_session(conn, req, user_id=None):
    token = secrets.token_urlsafe(32)
    insert(conn, "sessions", {"token_hash": hashlib.sha256(token.encode()).hexdigest(), "created_at": now_iso(),
                              "last_seen": now_iso(), "ip": req.handler.client_address[0],
                              "agent": (req.handler.headers.get("User-Agent") or "")[:300], "user_id": user_id})
    req.set_cookie = f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_DAYS * 86400}; HttpOnly; SameSite=Strict"


USER_PIN_MIN = 4


def clean_pin(pin, required):
    pin = str(pin or "")
    if not pin:
        if required:
            raise ApiError(400, f"Choose a PIN of at least {USER_PIN_MIN} characters")
        return None
    if len(pin) < USER_PIN_MIN:
        raise ApiError(400, f"PINs need at least {USER_PIN_MIN} characters")
    return hash_passcode(pin)


def user_row(u):
    return {k: u[k] for k in ("id", "name", "is_admin", "active", "created_at", "last_seen") if k in u}


@route("GET", "/api/users")
def api_users(req, conn):
    out = [user_row(u) for u in rows(conn.execute("SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE"))]
    for u in out:
        last = one(conn.execute("SELECT at, summary FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 1", (u["id"],)))
        u["last_activity"] = last
    return out


@route("POST", "/api/users")
def api_users_post(req, conn):
    first = not users_exist(conn)
    if not first:
        require_admin(req, conn)
    d = req.json() or {}
    name = as_str(d.get("name"), "name")
    if not name:
        raise ApiError(400, "Enter their name")
    if conn.execute("SELECT 1 FROM users WHERE name = ? COLLATE NOCASE", (name,)).fetchone():
        raise ApiError(400, f"There's already someone called {name}")
    uid = insert(conn, "users", {"name": name, "pin_hash": clean_pin(d.get("pin"), True),
                                 "is_admin": 1 if (first or d.get("is_admin")) else 0, "active": 1, "created_at": now_iso()})
    conn.commit()
    if first:
        # The first person becomes an admin and is signed in on this device straight away.
        if req.session:
            conn.execute("UPDATE sessions SET user_id = ? WHERE token_hash = ?", (uid, req.session["token_hash"]))
        else:
            new_session(conn, req, uid)
        conn.commit()
        ACTOR.user_id, ACTOR.name = uid, name
    return user_row(one(conn.execute("SELECT * FROM users WHERE id = ?", (uid,))))


@route("PUT", r"/api/users/(\d+)")
def api_user_put(req, conn, uid):
    require_admin(req, conn)
    u = one(conn.execute("SELECT * FROM users WHERE id = ?", (uid,)))
    if not u:
        raise ApiError(404, "User not found")
    d = req.json() or {}
    data = {}
    if "name" in d:
        data["name"] = as_str(d["name"], "name")
        if not data["name"]:
            raise ApiError(400, "Enter their name")
        if conn.execute("SELECT 1 FROM users WHERE name = ? COLLATE NOCASE AND id != ?", (data["name"], uid)).fetchone():
            raise ApiError(400, f"There's already someone called {data['name']}")
    if d.get("pin"):
        data["pin_hash"] = clean_pin(d["pin"], True)
    if "is_admin" in d:
        data["is_admin"] = 1 if d["is_admin"] else 0
    if "active" in d:
        data["active"] = 1 if d["active"] else 0
    after = dict(u, **data)
    if (not after["is_admin"] or not after["active"]) and not conn.execute(
            "SELECT 1 FROM users WHERE is_admin = 1 AND active = 1 AND id != ?", (uid,)).fetchone():
        raise ApiError(400, "Keep at least one active admin, or nobody could change settings")
    update(conn, "users", uid, data)
    if "pin_hash" in data or data.get("active") == 0:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))  # sign them out everywhere
    conn.commit()
    return user_row(one(conn.execute("SELECT * FROM users WHERE id = ?", (uid,))))


@route("GET", "/api/login-options")
def api_login_options(req, conn):
    """What the sign-in page should ask for. Public: lists first names only, no other details."""
    name = app_name(conn)
    extra = {"app_name": name, "default_name": name == DEFAULT_SETTINGS["app_name"], "has_logo": file_has(conn, "logo_light")}
    if users_exist(conn):
        return {"mode": "users", **extra, "users": rows(conn.execute(
            "SELECT id, name FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE"))}
    return {"mode": "passcode", **extra}


def app_name(conn):
    """What the app is called on screen (Settings → app name)."""
    return (get_settings(conn).get("app_name") or "").strip() or DEFAULT_SETTINGS["app_name"]


ACTIVITY_KINDS = ("job", "item", "scan", "stock", "contact", "vendor", "settings", "user")


def log_activity(conn, kind, summary, job_id=None, product_id=None):
    conn.execute("INSERT INTO activity(at, user_id, user_name, kind, summary, job_id, product_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                 (now_iso(), actor_id(), actor_name(), kind, summary[:500], job_id, product_id))


@route("GET", "/api/activity")
def api_activity(req, conn):
    where, params = [], []
    for col, key in (("job_id", "job"), ("product_id", "product"), ("user_id", "user")):
        if req.q(key):
            where.append(f"a.{col} = ?")
            params.append(as_int(req.q(key), key))
    if req.q("kind"):
        where.append("a.kind = ?")
        params.append(req.q("kind"))
    if req.q("before"):
        where.append("a.id < ?")
        params.append(as_int(req.q("before"), "before"))
    if req.q("q"):
        where.append("(a.summary LIKE ? OR a.user_name LIKE ?)")
        params += [f"%{req.q('q')}%"] * 2
    limit = max(1, min(as_int(req.q("limit") or 100, "limit"), 500))
    sql = ("SELECT a.*, j.number AS job_number, j.name AS job_name FROM activity a LEFT JOIN jobs j ON j.id = a.job_id"
           + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY a.id DESC LIMIT ?")
    return rows(conn.execute(sql, params + [limit]))


# ---- what each change looks like in the activity log
# PRE_* runs before the change (to remember names of things about to change or go); DESCRIBE_* after it.

def _job_label(conn, jid):
    j = one(conn.execute("SELECT number, name FROM jobs WHERE id = ?", (jid,)))
    return f"{j['number']} {j['name']}" if j else f"job {jid}"


def _prod_name(conn, pid):
    p = one(conn.execute("SELECT name FROM products WHERE id = ?", (pid,)))
    return p["name"] if p else "an item"


def _item(conn, iid):
    return one(conn.execute("SELECT ji.*, p.name AS product_name FROM job_items ji LEFT JOIN products p ON p.id = ji.product_id "
                            "WHERE ji.id = ?", (iid,)))


def _changed_fields(body, labels):
    names = [labels.get(k, k.replace("_", " ")) for k in body if k in labels]
    return ", ".join(names) if names else "details"


JOB_FIELD_LABELS = {"name": "name", "contact_id": "client", "start_date": "dates", "end_date": "dates", "venue": "venue",
                    "reference": "reference", "notes": "notes", "discount_pct": "discount", "charge_days": "charged days",
                    "power_supply": "power supply", "status": "status"}


def _status_label(s):
    return {"enquiry": "Enquiry", "quote": "Quote", "provisional": "Provisional", "confirmed": "Confirmed", "out": "Out",
            "returned": "Returned", "invoiced": "Invoiced", "cancelled": "Cancelled", "lost": "Lost"}.get(s, s)


def describe(fn_name, conn, req, groups, body, result, pre):
    """Returns (kind, summary, job_id, product_id) for the activity log, or None to skip."""
    g = [int(x) if x and x.isdigit() else x for x in groups]
    r = result if isinstance(result, dict) else {}
    if fn_name == "api_jobs_post":
        return ("job", f"Created job {r.get('number', '')} {r.get('name', '')}".strip(), r.get("id"), None)
    if fn_name == "api_job_put":
        if "status" in body and pre and pre.get("status") != body["status"]:
            return ("job", f"Changed status {_status_label(pre['status'])} → {_status_label(body['status'])}", g[0], None)
        rest = {k: v for k, v in body.items() if k != "status"}
        if not rest:
            return None
        return ("job", f"Edited job {_changed_fields(rest, JOB_FIELD_LABELS)}", g[0], None)
    if fn_name == "api_job_delete":
        return ("job", f"Deleted job {pre or ''}", None, None)
    if fn_name == "api_job_duplicate":
        return ("job", f"Duplicated {_job_label(conn, g[0])} as {r.get('number', '')}", r.get("id"), None)
    if fn_name == "api_jobs_items_post" or fn_name == "api_items_post":
        if body.get("product_id"):
            return ("item", f"Added {fmt_num(as_float(body.get('quantity') or 1, 'quantity'))} × {_prod_name(conn, body['product_id'])}",
                    g[0], body["product_id"])
        return ("item", f"Added {body.get('kind') or 'line'}: {body.get('description', '')}", g[0], None)
    if fn_name == "api_item_put" and pre:
        bits = []
        if "quantity" in body and float(body["quantity"] or 0) != float(pre["quantity"] or 0):
            bits.append(f"quantity {fmt_num(pre['quantity'])} → {fmt_num(float(body['quantity'] or 0))}")
        if "unit_price" in body:
            bits.append("price")
        if "discount_pct" in body:
            bits.append("discount")
        if "days" in body:
            bits.append("days")
        if "description" in body and body["description"] != pre["description"]:
            bits.append("description")
        if "section_id" in body:
            bits.append("moved to another section")
        if not bits:
            return None
        return ("item", f"Changed {pre['description']}: {', '.join(bits)}", pre["job_id"], pre["product_id"])
    if fn_name == "api_item_delete" and pre:
        return ("item", f"Removed {fmt_num(pre['quantity'])} × {pre['description']}", pre["job_id"], pre["product_id"])
    if fn_name == "api_cable_run":
        runs = as_int(body.get("runs") or 1, "runs")
        return ("item", f"Added {runs} × {fmt_num(as_float(body.get('length'), 'length'))}m {body.get('cable_type', '')} cable run{'s' if runs != 1 else ''}", g[0], None)
    if fn_name == "api_stage" and not body.get("dry_run"):
        return ("item", f"Added stage {fmt_num(as_float(body.get('width'), 'width'))} × {fmt_num(as_float(body.get('depth'), 'depth'))}m", g[0], None)
    if fn_name == "api_stage_put" and pre:
        n = len(body.get("clamp_points") or [])
        return ("item", f"Updated {pre['description']}: {n} clamp{'s' if n != 1 else ''}, skirts on {', '.join(body.get('skirt_sides') or []) or 'no sides'}",
                pre["job_id"], None)
    if fn_name in ("api_section_post", "api_section_put", "api_section_move", "api_section_delete"):
        verb = {"api_section_post": "Added section", "api_section_put": "Renamed / edited section",
                "api_section_move": "Moved section", "api_section_delete": "Removed section"}[fn_name]
        jid = g[0] if fn_name == "api_section_post" else (pre or {}).get("job_id")
        name = body.get("name") or (pre or {}).get("name") or ""
        return ("job", f"{verb} {name}".strip(), jid, None)
    if fn_name == "api_plan_put":
        rooms = (body.get("plan") or {}).get("rooms") or []
        n = sum(len(r_.get("objects") or []) for r_ in rooms)
        if body.get("quiet"):
            return None
        return ("job", f"Updated the room plan ({len(rooms)} room{'s' if len(rooms) != 1 else ''}, {n} thing{'s' if n != 1 else ''})", g[0], None)
    if fn_name in ("api_components_post", "api_component_put", "api_component_delete"):
        if fn_name == "api_component_put" and "exclude" in body:
            return ("stock", f"{'Took' if body.get('excluded', True) else 'Put'} {_prod_name(conn, body['exclude'])} {'out of' if body.get('excluded', True) else 'back in'} package {r.get('name', '')}", None, r.get("id"))
        return ("stock", {"api_components_post": "Added to package", "api_component_put": "Changed quantity in package",
                          "api_component_delete": "Removed from package"}[fn_name] + f" {r.get('name', '')}", None, r.get("id"))
    if fn_name == "api_scan":
        if r.get("result") != "ok" or not r.get("job"):
            return None
        return ("scan", f"Checked in from the Scan page: {r.get('message', '')}", r["job"]["id"], r.get("product", {}).get("id"))
    if fn_name == "api_check_note":
        word = "out" if body.get("dir", "out") == "out" else "in"
        note = (body.get("note") or "").strip()
        what = _prod_name(conn, body.get("product_id"))
        return ("scan", f"{'Noted' if note else 'Cleared the note'} on {what} (check {word}){': ' + note[:120] if note else ''}", g[0], body.get("product_id"))
    if fn_name == "api_update_github_install" and r.get("restarting"):
        return ("settings", f"Updated to {r.get('new')} from {r.get('from')}", None, None)
    if fn_name == "api_requests_post" and r.get("added"):
        return ("settings", f"Made request {r['added']}: {body.get('title', '')[:120]}", None, None)
    if fn_name == "api_identity_put":
        return ("settings", "Updated their details (name / alias, company)", None, None)
    if fn_name == "api_item_subhire" and r.get("subhired"):
        sh = r["subhired"]
        if not sh["quantity"]:
            return ("item", f"Stopped sub-hiring {sh['name']} — all from own stock", r.get("id"), sh["product_id"])
        return ("item", f"Sub-hiring {fmt_num(sh['quantity'])} × {sh['name']}{' from ' + sh['vendor'] if sh['vendor'] else ''} "
                        f"({fmt_num(sh['own'])} from own stock)", r.get("id"), sh["product_id"])
    if fn_name == "api_item_swap" and r.get("swapped"):
        sw = r["swapped"]
        return ("item", f"Swapped {fmt_num(sw['quantity'])} × {sw['from']} for {sw['to']} (alternative)", r.get("id"), None)
    if fn_name == "api_job_lock":
        if r.get("edit_lock"):
            return ("job", f"Locked editing to {', '.join(r.get('editor_names') or []) or 'its creator'} (and admins)", g[0], None)
        return ("job", "Unlocked editing — anyone can change it", g[0], None)
    if fn_name in ("api_alternatives_post", "api_alternative_delete"):
        return ("stock", "Added a suitable alternative" if fn_name == "api_alternatives_post" else "Removed a suitable alternative",
                None, g[0] if fn_name == "api_alternatives_post" else None)
    if fn_name == "api_check_scan":
        if r.get("result") == "free":
            word = "out" if body.get("dir", "out") == "out" else "in"
            return ("scan", f"Free scan (check {word}): {r.get('message', '')}", g[0], r.get("product_id"))
        if r.get("result") != "ok":
            return None
        word = "Checked out" if body.get("dir", "out") == "out" else "Checked in"
        return ("scan", f"{word}: {r.get('message', '')} (scanned)", g[0], r.get("product_id"))
    if fn_name == "api_check_adjust":
        word = "out" if body.get("dir", "out") == "out" else "in"
        what = _prod_name(conn, body["product_id"]) if body.get("product_id") else "everything"
        if body.get("clear"):
            return ("scan", f"Cleared check-{word} ticks for {what}", g[0], body.get("product_id"))
        if body.get("all"):
            return ("scan", f"Ticked all of {what} as checked {word}", g[0], body.get("product_id"))
        delta = float(body.get("delta") or 0)
        return ("scan", f"{'Ticked' if delta > 0 else 'Unticked'} {fmt_num(abs(delta))} × {what} (check {word})", g[0], body.get("product_id"))
    if fn_name == "api_check_delete" and pre:
        return ("scan", f"Undid check-{pre['direction']} of {pre['label']}", pre["job_id"], pre["product_id"])
    if fn_name == "api_job_zoho":
        return ("job", f"Sent to Zoho Books{(' as ' + r['zoho_invoice_number']) if r.get('zoho_invoice_number') else ''}", g[0], None)
    # stock
    if fn_name == "api_products_post":
        return ("stock", f"Added stock item {r.get('name', '')}", None, r.get("id"))
    if fn_name == "api_product_put" and pre:
        if body.get("archived") == 0 and len(body) == 1:
            return ("stock", f"Restored {pre}", None, g[0])
        return ("stock", f"Edited {pre}", None, g[0])
    if fn_name == "api_product_delete" and pre:
        return ("stock", f"{'Archived' if r.get('archived') else 'Deleted'} {pre}", None, None if not r.get("archived") else g[0])
    if fn_name == "api_lengths_post":
        return ("stock", f"Added {fmt_num(as_float(body.get('length_m'), 'length'))}m lengths to {_prod_name(conn, g[0])}", None, g[0])
    if fn_name == "api_images_post":
        return ("stock", f"Added an image to {_prod_name(conn, g[0])}", None, g[0])
    if fn_name == "api_image_delete" and pre:
        return ("stock", f"Removed an image from {pre['name']}", None, pre["id"])
    if fn_name == "api_assets_post":
        if body.get("sub_hire"):
            n = len(body.get("codes") or []) or (1 if body.get("asset_number") else as_int(body.get("count") or 1, "count"))
            v = conn.execute("SELECT name FROM vendors WHERE id = ?", (body.get("vendor_id"),)).fetchone()
            when = f" ({body.get('hire_from') or '…'} to {body.get('hire_to') or '…'})" if body.get("hire_from") or body.get("hire_to") else ""
            return ("stock", f"Added {fmt_num(n)} sub-hired unit{'s' if n != 1 else ''} of {_prod_name(conn, g[0])}"
                             f"{' from ' + v[0] if v else ''}{when}", None, g[0])
        if body.get("asset_number"):
            return ("stock", f"Added unit {body['asset_number']} to {_prod_name(conn, g[0])}", None, g[0])
        n = len(body.get("codes") or []) or as_int(body.get("count") or 1, "count")
        return ("stock", f"Added {fmt_num(n)} unit{'' if n == 1 else 's'} to {_prod_name(conn, g[0])}", None, g[0])
    if fn_name == "api_asset_put" and pre:
        if "asset_number" in body and body["asset_number"] != pre["asset_number"]:
            return ("stock", f"Re-labelled {pre['asset_number']} as {body['asset_number']} ({pre['name']})", None, pre["product_id"])
        return ("stock", f"Edited unit {pre['asset_number']} ({pre['name']})", None, pre["product_id"])
    if fn_name == "api_asset_delete" and pre:
        if pre.get("sub_hire"):
            return ("stock", f"Removed sub-hired unit {pre['asset_number']} ({pre['name']}) — gone back", None, pre["product_id"])
        return ("stock", f"Removed unit {pre['asset_number']} ({pre['name']})", None, pre["product_id"])
    if fn_name == "api_quarantine_post":
        reason = body.get("reason") or ""
        return ("stock", f"Quarantined {_prod_name(conn, g[0])}{(': ' + reason) if reason else ''}", None, g[0])
    if fn_name == "api_quarantine_release" and pre:
        return ("stock", f"Returned {pre['name']} to service", None, pre["product_id"])
    if fn_name in ("api_accessory_post", "api_accessory_put", "api_accessory_delete"):
        return ("stock", {"api_accessory_post": "Linked an accessory", "api_accessory_put": "Changed a linked accessory",
                          "api_accessory_delete": "Unlinked an accessory"}[fn_name], None, (pre or {}).get("product_id") or (g[0] if fn_name == "api_accessory_post" else None))
    if fn_name in ("api_import_products", "api_import_contacts"):
        return ("stock" if fn_name == "api_import_products" else "contact",
                f"Imported {'stock' if fn_name == 'api_import_products' else 'clients'} from CSV ({r.get('added', 0)} added, {r.get('updated', 0)} updated)", None, None)
    # clients & vendors
    if fn_name == "api_contacts_post":
        return ("contact", f"Added client {r.get('name', '')}", None, None)
    if fn_name == "api_contact_put":
        return ("contact", f"Edited client {pre or ''}", None, None)
    if fn_name == "api_contact_delete":
        return ("contact", f"{'Archived' if r.get('archived') else 'Deleted'} client {pre or ''}", None, None)
    if fn_name == "api_vendors_post":
        return ("vendor", f"Added vendor {r.get('name', '')}", None, None)
    if fn_name == "api_vendor_put":
        return ("vendor", f"Edited vendor {pre or ''}", None, None)
    if fn_name == "api_vendor_delete":
        return ("vendor", f"{'Archived' if r.get('archived') else 'Deleted'} vendor {pre or ''}", None, None)
    # settings & people
    simple = {"api_settings_put": "Changed settings", "api_restore": "Restored a backup", "api_zoho_put": "Changed Zoho Books settings", "api_logo_post": "Changed the logo", "api_logo_delete": "Removed a logo",
              "api_icon_post": "Changed the app icon", "api_icon_delete": "Went back to the standard app icon",
              "api_fonts_post": "Added a font", "api_fonts_delete": "Removed a font", "api_network_put": "Changed network access",
              "api_network_devices_delete": "Signed out other devices", "api_update": "Installed a software update",
              "api_rollback": "Rolled back the software", "api_zoho_connect": "Connected Zoho Books",
              "api_zoho_disconnect": "Disconnected Zoho Books"}
    if fn_name in simple:
        if fn_name == "api_update" and body.get("dry_run"):
            return None
        return ("settings", simple[fn_name], None, None)
    if fn_name == "api_users_post":
        return ("user", f"Added user {r.get('name', '')}{' (admin)' if r.get('is_admin') else ''}", None, None)
    if fn_name == "api_user_put" and pre:
        bits = []
        if "name" in body and body["name"] != pre["name"]:
            bits.append(f"renamed to {body['name']}")
        if body.get("pin"):
            bits.append("new PIN")
        if "is_admin" in body and bool(body["is_admin"]) != bool(pre["is_admin"]):
            bits.append("made admin" if body["is_admin"] else "removed admin")
        if "active" in body and bool(body["active"]) != bool(pre["active"]):
            bits.append("re-enabled" if body["active"] else "disabled")
        return ("user", f"Changed user {pre['name']}: {', '.join(bits) or 'details'}", None, None)
    return None


def pre_describe(fn_name, conn, groups):
    g = [int(x) if x and x.isdigit() else x for x in groups]
    if not g:
        return None
    if fn_name == "api_job_put":
        return one(conn.execute("SELECT status FROM jobs WHERE id = ?", (g[0],)))
    if fn_name == "api_job_delete":
        return _job_label(conn, g[0])
    if fn_name in ("api_item_put", "api_item_delete", "api_stage_put"):
        return _item(conn, g[0])
    if fn_name in ("api_section_put", "api_section_move", "api_section_delete"):
        return one(conn.execute("SELECT job_id, name FROM job_sections WHERE id = ?", (g[0],)))
    if fn_name == "api_check_delete":
        c = one(conn.execute("SELECT c.*, p.name, x.asset_number FROM job_checks c JOIN products p ON p.id = c.product_id "
                             "LEFT JOIN assets x ON x.id = c.asset_id WHERE c.id = ?", (g[0],)))
        if c:
            c["label"] = c["asset_number"] and f"{c['asset_number']} ({c['name']})" or f"{fmt_num(c['quantity'])} × {c['name']}"
        return c
    if fn_name in ("api_product_put", "api_product_delete"):
        return _prod_name(conn, g[0])
    if fn_name == "api_image_delete":
        return one(conn.execute("SELECT p.id, p.name FROM product_images i JOIN products p ON p.id = i.product_id WHERE i.id = ?", (g[0],)))
    if fn_name in ("api_asset_put", "api_asset_delete"):
        return one(conn.execute("SELECT x.*, p.name FROM assets x JOIN products p ON p.id = x.product_id WHERE x.id = ?", (g[0],)))
    if fn_name == "api_quarantine_release":
        return one(conn.execute("SELECT q.product_id, p.name FROM quarantine q JOIN products p ON p.id = q.product_id WHERE q.id = ?", (g[0],)))
    if fn_name in ("api_accessory_put", "api_accessory_delete"):
        return one(conn.execute("SELECT product_id FROM product_accessories WHERE id = ?", (g[0],)))
    if fn_name in ("api_contact_put", "api_contact_delete"):
        c = one(conn.execute("SELECT name FROM contacts WHERE id = ?", (g[0],)))
        return c and c["name"]
    if fn_name in ("api_vendor_put", "api_vendor_delete"):
        v = one(conn.execute("SELECT name FROM vendors WHERE id = ?", (g[0],)))
        return v and v["name"]
    if fn_name == "api_user_put":
        return one(conn.execute("SELECT * FROM users WHERE id = ?", (g[0],)))
    return None


LOGO_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp"}


DATA_URL_RE = re.compile(r"^data:([\w/+.-]+);base64,(.*)$", re.S)


def decode_data_url(value, allowed, what, limit_mb):
    m = DATA_URL_RE.match(value or "")
    if not m or m.group(1) not in allowed:
        raise ApiError(400, f"{what} must be one of: " + ", ".join(sorted(set(allowed.values() if isinstance(allowed, dict) else allowed))))
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except ValueError:
        raise ApiError(400, f"That {what.lower()} file couldn't be read")
    if len(raw) > limit_mb * 1024 * 1024:
        raise ApiError(400, f"{what} must be under {limit_mb} MB")
    return m.group(1), raw


def file_get(conn, key):
    return one(conn.execute("SELECT key, name, ctype, data, updated_at FROM files WHERE key = ?", (key,)))


def file_put(conn, key, ctype, data, name=""):
    conn.execute("INSERT INTO files(key, name, ctype, data, updated_at) VALUES(?, ?, ?, ?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET name = excluded.name, ctype = excluded.ctype, data = excluded.data, "
                 "updated_at = excluded.updated_at", (key, name, ctype, data, now_iso()))


def file_has(conn, key):
    return bool(conn.execute("SELECT 1 FROM files WHERE key = ?", (key,)).fetchone())


def find_logo():  # kept for older callers: True when a logo is set
    return None


def logo_variant(req):
    v = (req.q("variant") or "light").lower()
    if v not in ("light", "dark"):
        raise ApiError(400, "Logo variant must be light or dark")
    return v


@route("POST", "/api/logo")
def api_logo_post(req, conn):
    require_admin(req, conn)
    data = req.json() or {}
    variant = "dark" if data.get("variant") == "dark" else "light"
    ctype, raw = decode_data_url(data.get("data_url"), LOGO_TYPES, "Logo", 5)
    file_put(conn, f"logo_{variant}", ctype, raw, data.get("name") or "")
    conn.commit()
    return {"ok": True}


@route("DELETE", "/api/logo")
def api_logo_delete(req, conn):
    require_admin(req, conn)
    conn.execute("DELETE FROM files WHERE key = ?", (f"logo_{logo_variant(req)}",))
    conn.commit()
    return {"ok": True}


@route("GET", "/logo")
def logo(req, conn):
    v = logo_variant(req)
    f = file_get(conn, f"logo_{v}") or (file_get(conn, "logo_light") if v == "dark" else None)
    if not f:
        # Nothing uploaded: the app's own logo (for the sidebar and sign-in page; documents only use an uploaded one).
        with open(os.path.join(STATIC_DIR, f"logo-default-{v}.png"), "rb") as fh:
            return Raw(fh.read(), "image/png")
    return Raw(f["data"], f["ctype"], extra_headers={
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})


# ---------------------------------------------------------------- your own icons (sidebar and stock categories)

ICON_TARGET_RE = re.compile(r"^(nav:[a-z_]{2,20}|cat:[^\x00-\x1f]{1,80})$")
ICON_LIB_RE = re.compile(r"^[a-z0-9_-]{1,30}$")


def icon_target(v):
    t = str(v or "").strip()
    if t.startswith("cat:"):
        t = "cat:" + t[4:].strip().lower()
    if not ICON_TARGET_RE.match(t):
        raise ApiError(400, "Unknown icon")
    return t


def custom_icons(conn):
    try:
        v = json.loads(get_settings(conn).get("custom_icons") or "{}")
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


def save_custom_icons(conn, icons):
    conn.execute("INSERT INTO settings(key, value) VALUES('custom_icons', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(icons),))


@route("PUT", "/api/icons")
def api_icons_put(req, conn):
    """Choose a built-in icon ({target, lib}), upload one ({target, data_url, tint}), or go back to the default ({target})."""
    require_admin(req, conn)
    d = req.json() or {}
    target = icon_target(d.get("target"))
    icons = custom_icons(conn)
    fkey = f"uicon:{target}"
    if d.get("data_url"):
        ctype, raw = decode_data_url(d.get("data_url"), LOGO_TYPES, "Icon", 1)
        file_put(conn, fkey, ctype, raw, as_str(d.get("name"), "name")[:120])
        icons[target] = {"file": 1, "tint": bool(d.get("tint")), "v": int(time.time())}
    elif d.get("lib"):
        lib = str(d["lib"])
        if not ICON_LIB_RE.match(lib):
            raise ApiError(400, "Unknown icon")
        icons[target] = {"lib": lib}
        conn.execute("DELETE FROM files WHERE key = ?", (fkey,))
    elif "tint" in d and target in icons and icons[target].get("file"):
        icons[target]["tint"] = bool(d["tint"])
    else:
        icons.pop(target, None)
        conn.execute("DELETE FROM files WHERE key = ?", (fkey,))
    save_custom_icons(conn, icons)
    conn.commit()
    return {"custom_icons": icons}


@route("GET", "/uicon")
def uicon(req, conn):
    f = file_get(conn, f"uicon:{icon_target(req.q('t'))}")
    if not f:
        raise ApiError(404, "No icon uploaded")
    return Raw(f["data"], f["ctype"], extra_headers={
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, max-age=86400"})


# ---------------------------------------------------------------- scan sounds

SOUND_KINDS = ("ok", "warn", "error")
# MP3 and WAV, and the open formats browsers play: Ogg Vorbis/Opus, FLAC and WebM.
AUDIO_TYPES = {"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
               "audio/vnd.wave": "wav", "audio/ogg": "ogg", "audio/opus": "opus", "audio/flac": "flac",
               "audio/x-flac": "flac", "audio/webm": "webm"}


@route("PUT", "/api/sounds")
def api_sounds_put(req, conn):
    """Use your own sound for a scan result ({kind, data_url, name}), or go back to the beep ({kind})."""
    require_admin(req, conn)
    d = req.json() or {}
    kind = d.get("kind")
    if kind not in SOUND_KINDS:
        raise ApiError(400, "Unknown sound")
    try:
        sounds = json.loads(get_settings(conn).get("custom_sounds") or "{}")
        sounds = sounds if isinstance(sounds, dict) else {}
    except ValueError:
        sounds = {}
    if d.get("data_url"):
        ctype, raw = decode_data_url(d["data_url"], AUDIO_TYPES, "Sound", 2)
        file_put(conn, f"sound:{kind}", ctype, raw, as_str(d.get("name"), "name")[:120])
        sounds[kind] = {"name": as_str(d.get("name"), "name")[:120], "v": int(time.time())}
    else:
        conn.execute("DELETE FROM files WHERE key = ?", (f"sound:{kind}",))
        sounds.pop(kind, None)
    conn.execute("INSERT INTO settings(key, value) VALUES('custom_sounds', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(sounds),))
    conn.commit()
    return {"custom_sounds": sounds}


@route("GET", "/sound")
def scan_sound(req, conn):
    kind = req.q("k")
    f = kind in SOUND_KINDS and file_get(conn, f"sound:{kind}")
    if not f:
        raise ApiError(404, "No sound uploaded")
    return Raw(f["data"], f["ctype"], extra_headers={"Cache-Control": "private, max-age=86400",
                                                     "Content-Security-Policy": "default-src 'none'"})


# ---------------------------------------------------------------- app icon

ICON_SIZES = (512, 192, 180, 32)


@route("POST", "/api/icon")
def api_icon_post(req, conn):
    require_admin(req, conn)
    """The browser sends the icon already resized to each size as PNG."""
    data = req.json() or {}
    imgs = {}
    for size in ICON_SIZES:
        ctype, raw = decode_data_url(data.get(f"png{size}"), {"image/png": "PNG"}, "Icon", 4)
        imgs[size] = raw
    for size, raw in imgs.items():
        file_put(conn, f"icon_{size}", "image/png", raw)
    conn.commit()
    note = install_desktop_icon(imgs[512])
    return {"ok": True, "desktop": note}


@route("DELETE", "/api/icon")
def api_icon_delete(req, conn):
    require_admin(req, conn)
    conn.execute("DELETE FROM files WHERE key LIKE 'icon\\_%' ESCAPE '\\'")
    conn.commit()
    note = install_desktop_icon(None)
    return {"ok": True, "desktop": note}


def install_desktop_icon(png):
    """Best effort: use the custom icon for the app-menu / Dock icon too. Returns a short note for the user."""
    try:
        if sys.platform.startswith("linux"):
            desk = os.path.join(os.path.expanduser("~"), ".local", "share", "applications", "horan-rms.desktop")
            if not os.path.exists(desk):
                return ""
            custom = os.path.join(os.path.dirname(DATA_DIR), "custom-icon.png")
            if png:
                with open(custom, "wb") as f:
                    f.write(png)
                target = custom
            else:
                if os.path.exists(custom):
                    os.remove(custom)
                target = os.path.join(STATIC_DIR, "icon-512.png")
            with open(desk, encoding="utf-8") as f:
                text = f.read()
            text = re.sub(r"(?m)^Icon=.*$", "Icon=" + target, text)
            with open(desk, "w", encoding="utf-8") as f:
                f.write(text)
            return "App menu icon updated (it may take a moment, or a log out and in, to show)."
        if sys.platform == "darwin":
            bundle = os.environ.get("HET_BUNDLE", "")
            if not bundle or not os.path.isdir(bundle):
                return ""
            if png:
                path = os.path.join(os.path.dirname(DATA_DIR), "custom-icon.png")
                with open(path, "wb") as f:
                    f.write(png)
                script = ("ObjC.import('AppKit'); var img = $.NSImage.alloc.initWithContentsOfFile(%s); "
                          "$.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, %s, 0);" % (json.dumps(path), json.dumps(bundle)))
            else:
                script = ("ObjC.import('AppKit'); $.NSWorkspace.sharedWorkspace.setIconForFileOptions($(), %s, 0);"
                          % json.dumps(bundle))
            r = subprocess.run(["osascript", "-l", "JavaScript", "-e", script], capture_output=True, text=True, timeout=15)
            if r.returncode == 0 and "false" not in (r.stdout or ""):
                return "Dock and Finder icon updated (the Dock shows it next time the app opens)."
            return "The browser icon changed, but macOS didn't let the app change its own Finder icon."
    except Exception as e:  # noqa: BLE001
        return f"The browser icon changed, but the app-menu icon couldn't be updated ({e})."
    return ""


def icon_response(conn, size):
    f = file_get(conn, f"icon_{size}")
    if f:
        return Raw(f["data"], "image/png")
    with open(os.path.join(STATIC_DIR, "icon-512.png"), "rb") as fh:
        return Raw(fh.read(), "image/png")


@route("GET", "/favicon")
def favicon(req, conn):
    f = file_get(conn, "icon_32")
    if f:
        return Raw(f["data"], "image/png")
    with open(os.path.join(STATIC_DIR, "favicon-64.png"), "rb") as fh:
        return Raw(fh.read(), "image/png")


@route("GET", "/apple-touch-icon.png")
def apple_icon(req, conn):
    return icon_response(conn, 180)


@route("GET", r"/app-icon-(512|192)\.png")
def app_icon(req, conn, size):
    return icon_response(conn, int(size))


@route("GET", "/manifest.webmanifest")
def manifest(req, conn):
    st = get_settings(conn)
    name = st.get("app_name") or DEFAULT_SETTINGS["app_name"]
    body = {"name": name, "short_name": name if len(name) <= 14 else name.split(" ")[0][:14], "start_url": "/", "display": "standalone",
            "background_color": st["light_bg"], "theme_color": st["brand_primary"],
            "icons": [{"src": f"/app-icon-{n}.png", "sizes": f"{n}x{n}", "type": "image/png"} for n in (192, 512)]}
    return Raw(json.dumps(body), "application/manifest+json")


# ---------------------------------------------------------------- fonts

FONT_TYPES = {"font/woff2": "woff2", "font/woff": "woff", "font/ttf": "truetype", "font/otf": "opentype",
              "application/font-woff": "woff", "application/x-font-ttf": "truetype", "application/x-font-otf": "opentype",
              "application/vnd.ms-opentype": "opentype", "application/octet-stream": None}


def sniff_font(raw):
    head = raw[:4]
    if head == b"wOF2":
        return "font/woff2", "woff2"
    if head == b"wOFF":
        return "font/woff", "woff"
    if head == b"OTTO":
        return "font/otf", "opentype"
    if head in (b"\x00\x01\x00\x00", b"true"):
        return "font/ttf", "truetype"
    return None, None


@route("GET", "/api/fonts")
def api_fonts(req, conn):
    out = []
    for r in conn.execute("SELECT key, name, ctype, updated_at, LENGTH(data) AS size FROM files WHERE key LIKE 'font:%' ORDER BY name"):
        out.append({"id": int(r["key"].split(":")[1]), "name": r["name"], "ctype": r["ctype"], "size": r["size"],
                    "format": sniff_font(file_get(conn, r["key"])["data"][:4])[1]})
    return out


@route("POST", "/api/fonts")
def api_fonts_post(req, conn):
    require_admin(req, conn)
    d = req.json() or {}
    _ctype, raw = decode_data_url(d.get("data_url"), FONT_TYPES, "Font", 10)
    ctype, fmt = sniff_font(raw)
    if not ctype:
        raise ApiError(400, "That isn't a font file (use .woff2, .woff, .ttf or .otf)")
    name = re.sub(r"\.(woff2?|ttf|otf)$", "", as_str(d.get("name"), "name") or "Custom font", flags=re.I)[:80]
    n = (conn.execute("SELECT COALESCE(MAX(CAST(SUBSTR(key, 6) AS INTEGER)), 0) FROM files WHERE key LIKE 'font:%'").fetchone()[0] or 0) + 1
    file_put(conn, f"font:{n}", ctype, raw, name)
    conn.commit()
    return {"id": n, "name": name, "format": fmt}


@route("DELETE", r"/api/fonts/(\d+)")
def api_fonts_delete(req, conn, fid):
    require_admin(req, conn)
    conn.execute("DELETE FROM files WHERE key = ?", (f"font:{int(fid)}",))
    for k in ("font_body", "font_heading"):
        conn.execute("UPDATE settings SET value = '' WHERE key = ? AND value = ?", (k, f"upload:{int(fid)}"))
    conn.commit()
    return {"ok": True}


@route("GET", r"/font/(\d+)")
def font_file(req, conn, fid):
    f = file_get(conn, f"font:{int(fid)}")
    if not f:
        raise ApiError(404, "Font not found")
    return Raw(f["data"], f["ctype"], extra_headers={"Cache-Control": "max-age=86400"})


# ---- software update

UPDATE_FILES = ("server.py", "README.md", "install.sh", "uninstall.sh", "horan-rms")


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or "0")[:3])


def app_backup_dir():
    return os.path.join(DATA_DIR, "app-backups")


def list_app_backups():
    d = app_backup_dir()
    if not os.path.isdir(d):
        return []
    return sorted((x for x in os.listdir(d) if os.path.isfile(os.path.join(d, x, "server.py"))), reverse=True)


def read_update_zip(data):
    """Validate an uploaded update and return (version, {relative_path: bytes})."""
    raw = data.get("zip_base64") or ""
    if "," in raw[:100]:
        raw = raw.split(",", 1)[1]
    try:
        body = base64.b64decode(raw)
    except Exception:
        raise ApiError(400, "That file isn't a valid .zip")
    return read_update_bytes(body)


def read_update_bytes(body):
    try:
        zf = zipfile.ZipFile(io.BytesIO(body))
    except Exception:
        raise ApiError(400, "That file isn't a valid .zip")
    names = [n for n in zf.namelist() if not n.endswith("/")]
    roots = [n[:-len("server.py")] for n in names if n.endswith("server.py")
             and (n[:-len("server.py")] + "static/index.html") in names]
    if not roots:
        raise ApiError(400, "This zip doesn't look like an update for this app "
                            "(no server.py and static/index.html found)")
    root = min(roots, key=len)
    files = {}
    total = 0
    for n in names:
        if not n.startswith(root):
            continue
        rel = n[len(root):]
        if rel.startswith("/") or ".." in rel.split("/") or "\\" in rel:
            raise ApiError(400, "Update contains an unsafe file path")
        if rel in UPDATE_FILES or rel.startswith("static/"):
            body = zf.read(n)
            total += len(body)
            if total > 50 * 1024 * 1024:
                raise ApiError(400, "Update is too large")
            files[rel] = body
    src = files["server.py"].decode("utf-8", "replace")
    m = re.search(r'^VERSION = "([^"]+)"', src, re.M)
    if not m or "Horan Event Tracking" not in src:
        raise ApiError(400, "This zip isn't a release of this app")
    try:
        compile(src, "server.py", "exec")
    except SyntaxError as e:
        raise ApiError(400, f"The update's server.py is damaged ({e.msg}); nothing was changed")
    return m.group(1), files


def snapshot_app(label):
    dest = os.path.join(app_backup_dir(), f"{dt.datetime.now().strftime('%Y-%m-%d-%H%M%S')}-v{label}")
    os.makedirs(dest, exist_ok=True)
    shutil.copy2(os.path.join(APP_DIR, "server.py"), dest)
    shutil.copytree(STATIC_DIR, os.path.join(dest, "static"))
    keep = list_app_backups()
    for old in keep[5:]:
        shutil.rmtree(os.path.join(app_backup_dir(), old), ignore_errors=True)
    return dest


def install_files(files):
    staging = os.path.join(APP_DIR, ".static-new")
    shutil.rmtree(staging, ignore_errors=True)
    for rel, body in files.items():
        if rel.startswith("static/"):
            target = os.path.join(staging, rel[len("static/"):])
        else:
            target = os.path.join(APP_DIR, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target + ".tmp", "wb") as f:
            f.write(body)
        os.replace(target + ".tmp", target)
    if os.path.isdir(staging):
        old = os.path.join(APP_DIR, ".static-old")
        shutil.rmtree(old, ignore_errors=True)
        os.replace(STATIC_DIR, old)
        os.replace(staging, STATIC_DIR)
        shutil.rmtree(old, ignore_errors=True)
    os.chmod(os.path.join(APP_DIR, "server.py"), 0o755)
    # Keep the app-menu launcher in step if it's installed in the usual place.
    launcher = os.path.join(os.path.expanduser("~"), ".local", "bin", "horan-rms")
    if "horan-rms" in files and os.path.exists(launcher):
        with open(launcher, "wb") as f:
            f.write(files["horan-rms"])
        os.chmod(launcher, 0o755)


def restart_soon():
    def go():
        sys.stdout.flush()
        sys.stderr.flush()
        os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Timer(0.8, go).start()


@route("POST", "/api/update")
def api_update(req, conn):
    require_admin(req, conn)
    local_only(req, headless_ok=True)
    data = req.json() or {}
    new_version, files = read_update_zip(data)
    return install_update(conn, new_version, files, dry_run=data.get("dry_run"), force=data.get("force"))


def install_update(conn, new_version, files, dry_run=False, force=False):
    """Back up, install and restart - shared by updates from a file and from GitHub."""
    info = {"current": VERSION, "new": new_version,
            "newer": version_tuple(new_version) > version_tuple(VERSION),
            "files": len(files)}
    if dry_run:
        return info
    if not info["newer"] and not force:
        raise ApiError(400, f"Version {new_version} isn't newer than the installed {VERSION}")
    # 1) back up the database and the current version of the app
    bdir = os.path.join(DATA_DIR, "backups")
    os.makedirs(bdir, exist_ok=True)
    dest = sqlite3.connect(os.path.join(bdir, f"pre-update-{dt.datetime.now().strftime('%Y-%m-%d-%H%M%S')}.db"))
    conn.backup(dest)
    dest.close()
    snap = snapshot_app(VERSION)
    # 2) install, rolling back if anything goes wrong
    try:
        install_files(files)
    except Exception as e:
        restore_snapshot(snap)
        raise ApiError(500, f"Update failed and was rolled back: {e}")
    restart_soon()
    info["restarting"] = True
    return info


# ---- updates from GitHub releases

GITHUB_API = os.environ.get("HORAN_RMS_GITHUB_API", "https://api.github.com")  # overridable for testing
GITHUB_CACHE = {}


def update_repo(conn):
    return (get_settings(conn).get("update_repo") or "").strip() or GITHUB_REPO


def github_get(url, accept="application/vnd.github+json", limit=60 * 1024 * 1024):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": f"Horan-Event-Tracking/{VERSION}",
                                               "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read(limit + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise ApiError(404, "not found")
        if e.code == 403:
            raise ApiError(502, "GitHub is limiting requests from this network right now — try again in a while")
        raise ApiError(502, f"GitHub replied with an error ({e.code})")
    except (urllib.error.URLError, OSError) as e:
        raise ApiError(502, f"Couldn't reach GitHub — is this computer online? ({getattr(e, 'reason', e)})")
    if len(body) > limit:
        raise ApiError(400, "The download is too large")
    return body


def github_latest(conn, fresh=False):
    repo = update_repo(conn)
    if not repo:
        raise ApiError(400, "No GitHub repository is set. Add it under Settings → Software update (owner/name).")
    hit = GITHUB_CACHE.get(repo)
    if hit and not fresh and time.time() - hit[0] < 600:
        return hit[1]
    try:
        rel = json.loads(github_get(f"{GITHUB_API}/repos/{repo}/releases/latest"))
    except ApiError as e:
        if e.status == 404:
            raise ApiError(404, f"No published releases found at github.com/{repo} (or the repository is private)")
        raise
    tag = rel.get("tag_name") or ""
    version = tag[1:] if tag[:1] in "vV" else tag
    asset = next((a for a in rel.get("assets") or []
                  if re.match(r"^horan-event-tracking-[\w.\-]+\.zip$", a.get("name") or "")), None)
    out = {"repo": repo, "tag": tag, "version": version, "name": rel.get("name") or tag,
           "notes": (rel.get("body") or "")[:20000], "published_at": rel.get("published_at"),
           "url": rel.get("html_url") or f"https://github.com/{repo}/releases",
           "zip_url": asset["browser_download_url"] if asset else rel.get("zipball_url"),
           "asset": asset["name"] if asset else "source code (zip)",
           "current": VERSION, "newer": bool(version) and version_tuple(version) > version_tuple(VERSION)}
    GITHUB_CACHE[repo] = (time.time(), out)
    return out


@route("GET", "/api/update/github")
def api_update_github(req, conn):
    require_admin(req, conn)
    return github_latest(conn, fresh=req.q("fresh") == "1")


@route("POST", "/api/update/github")
def api_update_github_install(req, conn):
    require_admin(req, conn)
    local_only(req, headless_ok=True)
    d = req.json() or {}
    rel = github_latest(conn, fresh=True)
    if not rel["zip_url"]:
        raise ApiError(400, "That release has no download")
    if not rel["newer"] and not d.get("force"):
        raise ApiError(400, f"You already have the latest version ({VERSION})")
    body = github_get(rel["zip_url"], accept="application/octet-stream")
    new_version, files = read_update_bytes(body)
    out = install_update(conn, new_version, files, force=d.get("force"))
    out["from"] = f"github.com/{rel['repo']} {rel['tag']}"
    return out


# ---- automatic updates

AUTO_UPDATE_MODES = ("none", "check", "install")


def set_setting(conn, key, value):
    conn.execute("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, str(value)))


def auto_update_info(conn, req=None):
    s = get_settings(conn)
    avail = s.get("auto_update_available") or ""
    if avail and version_tuple(avail) <= version_tuple(VERSION):
        avail = ""  # already installed
    can_install = False
    if req is not None:
        try:
            require_admin(req, conn)
            local_only(req, headless_ok=True)
            can_install = True
        except ApiError:
            pass
    return {"mode": s.get("auto_update_mode") or "none", "time": s.get("auto_update_time") or "03:00",
            "available": avail, "current": VERSION, "last_run": s.get("auto_update_last_run") or "",
            "last_result": s.get("auto_update_last_result") or "", "can_install": can_install, "can_change": can_install}


def auto_update_due(s, now):
    mode = s.get("auto_update_mode") or "none"
    if mode not in ("check", "install"):
        return False
    t = s.get("auto_update_time") or "03:00"
    retry = s.get("auto_update_retry_at") or ""
    if retry:  # the last try failed (e.g. no internet): try again an hour later, even past midnight
        return now.isoformat(timespec="seconds") >= retry
    return now.strftime("%H:%M") >= t and (s.get("auto_update_last_run") or "")[:10] != now.date().isoformat()


def run_auto_update(conn, now=None):
    """Once a day at the chosen time: look for a new release, and (if chosen) install it."""
    now = now or dt.datetime.now()
    s = get_settings(conn)
    if not auto_update_due(s, now):
        return None
    mode = s["auto_update_mode"]
    set_setting(conn, "auto_update_last_run", now.isoformat(timespec="seconds"))
    set_setting(conn, "auto_update_retry_at", "")
    conn.commit()
    try:
        rel = github_latest(conn, fresh=True)
        if not rel["newer"]:
            result = f"Checked {now:%d %b %H:%M}: you're up to date ({VERSION})"
            set_setting(conn, "auto_update_available", "")
        elif mode == "check":
            result = f"Checked {now:%d %b %H:%M}: version {rel['version']} is available"
            set_setting(conn, "auto_update_available", rel["version"])
        else:
            if not rel["zip_url"]:
                raise ApiError(400, "That release has no download")
            set_setting(conn, "auto_update_available", rel["version"])
            body = github_get(rel["zip_url"], accept="application/octet-stream")
            new_version, files = read_update_bytes(body)
            set_setting(conn, "auto_update_last_result", f"Installed {new_version} automatically on {now:%d %b %H:%M}")
            conn.commit()
            install_update(conn, new_version, files)
            return "installed"
    except ApiError as e:
        result = f"Automatic update on {now:%d %b %H:%M} didn't work: {e.message}. Trying again in an hour."
        set_setting(conn, "auto_update_retry_at", (now + dt.timedelta(hours=1)).isoformat(timespec="seconds"))
    except Exception as e:  # never let the scheduler die
        result = f"Automatic update on {now:%d %b %H:%M} didn't work: {e}. Trying again in an hour."
        set_setting(conn, "auto_update_retry_at", (now + dt.timedelta(hours=1)).isoformat(timespec="seconds"))
    set_setting(conn, "auto_update_last_result", result)
    conn.commit()
    return result


def auto_update_loop():
    while True:
        time.sleep(30)
        try:
            c = db()
            try:
                if run_auto_update(c) == "installed":
                    return  # restarting
            finally:
                c.close()
        except Exception as e:
            print(f"Automatic update check failed: {e}", file=sys.stderr)


@route("GET", "/api/update/auto")
def api_update_auto(req, conn):
    return auto_update_info(conn, req)


@route("PUT", "/api/update/auto")
def api_update_auto_put(req, conn):
    require_admin(req, conn)
    local_only(req, headless_ok=True)
    d = req.json() or {}
    mode = d.get("mode", get_settings(conn).get("auto_update_mode") or "none")
    if mode not in AUTO_UPDATE_MODES:
        raise ApiError(400, "Automatic updates must be none, check or install")
    t = str(d.get("time") or get_settings(conn).get("auto_update_time") or "03:00")
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t):
        raise ApiError(400, "Choose a time like 03:00")
    now = dt.datetime.now()
    if mode == "install" and now.strftime("%H:%M") >= t:
        # Don't install the moment it's switched on in the afternoon: wait for the chosen time tomorrow.
        set_setting(conn, "auto_update_last_run", now.isoformat(timespec="seconds"))
    elif (get_settings(conn).get("auto_update_last_run") or "")[:10] == now.date().isoformat() and t > now.strftime("%H:%M"):
        set_setting(conn, "auto_update_last_run", "")  # moved to later today: run then
    set_setting(conn, "auto_update_mode", mode)
    set_setting(conn, "auto_update_time", t)
    set_setting(conn, "auto_update_retry_at", "")
    conn.commit()
    return auto_update_info(conn, req)


def restore_snapshot(path):
    files = {"server.py": open(os.path.join(path, "server.py"), "rb").read()}
    for base, _dirs, fnames in os.walk(os.path.join(path, "static")):
        for fn in fnames:
            full = os.path.join(base, fn)
            rel = os.path.relpath(full, path).replace(os.sep, "/")
            with open(full, "rb") as f:
                files[rel] = f.read()
    install_files(files)


@route("POST", "/api/restore")
def api_restore(req, conn):
    require_admin(req, conn)
    local_only(req, headless_ok=True)
    """Replace this app's data with a downloaded backup (e.g. when moving to a new computer)."""
    raw = (req.json() or {}).get("db_base64") or ""
    if "," in raw[:100]:
        raw = raw.split(",", 1)[1]
    try:
        body = base64.b64decode(raw)
    except Exception:
        raise ApiError(400, "That file couldn't be read")
    if not body.startswith(b"SQLite format 3\x00"):
        raise ApiError(400, "That isn't a backup (.db) file from this app")
    tmp = os.path.join(DATA_DIR, ".restore-upload.db")
    with open(tmp, "wb") as f:
        f.write(body)
    try:
        chk = sqlite3.connect(tmp)
        try:
            tables = {r[0] for r in chk.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if not {"products", "jobs", "settings", "contacts"} <= tables:
                raise ApiError(400, "That database isn't a backup from this app")
            if chk.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ApiError(400, "That backup file is damaged")
            counts = {t: chk.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("products", "jobs", "contacts")}
            if (req.json() or {}).get("dry_run"):
                return {"ok": True, "counts": counts}
            # Keep a copy of what's here now, then copy the backup over the live database.
            bdir = os.path.join(DATA_DIR, "backups")
            os.makedirs(bdir, exist_ok=True)
            keep = sqlite3.connect(os.path.join(bdir, f"pre-restore-{dt.datetime.now().strftime('%Y-%m-%d-%H%M%S')}.db"))
            conn.backup(keep)
            keep.close()
            chk.backup(conn)
        finally:
            chk.close()
    except sqlite3.DatabaseError:
        raise ApiError(400, "That backup file couldn't be opened")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    init_db()  # bring an older backup up to date
    restart_soon()
    return {"ok": True, "restarting": True, "counts": counts}


@route("POST", "/api/update/rollback")
def api_rollback(req, conn):
    require_admin(req, conn)
    local_only(req, headless_ok=True)
    backups = list_app_backups()
    if not backups:
        raise ApiError(400, "There's no previous version to go back to")
    name = (req.json() or {}).get("backup") or backups[0]
    if name not in backups:
        raise ApiError(404, "Backup not found")
    snapshot_app(VERSION)
    restore_snapshot(os.path.join(app_backup_dir(), name))
    restart_soon()
    return {"restarting": True, "restored": name}


# ---- Zoho Books

ZOHO_REGIONS = {
    "eu": ("Europe (zoho.eu)", "https://accounts.zoho.eu"),
    "uk": ("United Kingdom (zoho.uk)", "https://accounts.zoho.uk"),
    "com": ("United States (zoho.com)", "https://accounts.zoho.com"),
    "in": ("India (zoho.in)", "https://accounts.zoho.in"),
    "au": ("Australia (zoho.com.au)", "https://accounts.zoho.com.au"),
    "jp": ("Japan (zoho.jp)", "https://accounts.zoho.jp"),
    "ca": ("Canada (zohocloud.ca)", "https://accounts.zohocloud.ca"),
    "sa": ("Saudi Arabia (zoho.sa)", "https://accounts.zoho.sa"),
}
ZOHO_SCOPES = ("ZohoBooks.invoices.CREATE,ZohoBooks.invoices.UPDATE,ZohoBooks.invoices.READ,"
               "ZohoBooks.contacts.READ,ZohoBooks.settings.READ")


def check_accounts_url(url):
    u = urlparse((url or "").strip().rstrip("/"))
    local = u.hostname in ("127.0.0.1", "localhost")
    if not u.hostname or (u.scheme != "https" and not (local and u.scheme == "http")):
        raise ApiError(400, "Zoho accounts address must start with https://")
    if not local and not re.search(r"(^|\.)(zoho\.[a-z.]+|zohocloud\.ca)$", u.hostname):
        raise ApiError(400, "That isn't a Zoho accounts address")
    return f"{u.scheme}://{u.netloc}"


def http_json(method, url, data=None, headers=None, form=False, timeout=25):
    body = None
    hdrs = {"Accept": "application/json", "User-Agent": f"HoranEventTracking/{VERSION}"}
    hdrs.update(headers or {})
    if data is not None:
        if form:
            body = urlencode(data).encode()
            hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data).encode()
            hdrs["Content-Type"] = "application/json;charset=UTF-8"
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except (urllib.error.URLError, OSError) as e:
        raise ApiError(502, f"Couldn't reach Zoho — check your internet connection ({getattr(e, 'reason', e)})")
    try:
        return status, json.loads(raw.decode("utf-8") or "{}")
    except ValueError:
        return status, {"message": raw.decode("utf-8", "replace")[:200]}


class Zoho:
    def __init__(self, conn):
        self.conn = conn
        self.accounts = get_secret(conn, "zoho_accounts_url")
        self.client_id = get_secret(conn, "zoho_client_id")
        self.client_secret = get_secret(conn, "zoho_client_secret")
        self.refresh = get_secret(conn, "zoho_refresh_token")
        self.api_domain = get_secret(conn, "zoho_api_domain")
        self.org_id = get_secret(conn, "zoho_org_id")
        if not self.refresh:
            raise ApiError(400, "Zoho Books isn't connected yet — set it up in Settings → Zoho Books")

    def token(self, force=False):
        tok = get_secret(self.conn, "zoho_access_token")
        try:
            exp = float(get_secret(self.conn, "zoho_access_expires") or 0)
        except ValueError:
            exp = 0
        if tok and not force and exp - 120 > time.time():
            return tok
        status, d = http_json("POST", self.accounts + "/oauth/v2/token", {
            "refresh_token": self.refresh, "client_id": self.client_id,
            "client_secret": self.client_secret, "grant_type": "refresh_token"}, form=True)
        if not d.get("access_token"):
            raise ApiError(502, f"Zoho sign-in failed ({d.get('error') or d.get('message') or status}). "
                                "Try disconnecting and connecting again in Settings.")
        set_secret(self.conn, "zoho_access_token", d["access_token"])
        set_secret(self.conn, "zoho_access_expires", time.time() + float(d.get("expires_in") or 3600))
        if d.get("api_domain"):
            self.api_domain = d["api_domain"]
            set_secret(self.conn, "zoho_api_domain", self.api_domain)
        self.conn.commit()
        return d["access_token"]

    def call(self, method, path, params=None, body=None, org=True, _retry=True):
        q = dict(params or {})
        if org:
            if not self.org_id:
                raise ApiError(400, "Choose your Zoho Books organisation in Settings → Zoho Books")
            q["organization_id"] = self.org_id
        url = self.api_domain.rstrip("/") + "/books/v3" + path + ("?" + urlencode(q) if q else "")
        status, d = http_json(method, url, body, {"Authorization": "Zoho-oauthtoken " + self.token()})
        if status == 401 and _retry:
            self.token(force=True)
            return self.call(method, path, params, body, org, _retry=False)
        if status >= 400 or d.get("code", 0) != 0:
            raise ApiError(502, f"Zoho Books: {d.get('message') or f'error {status}'}")
        return d

    def books_url(self, path):
        host = urlparse(self.accounts).netloc.replace("accounts.", "books.", 1)
        return f"https://{host}/app/{self.org_id}#/{path}"


def zoho_status(conn):
    connected = bool(get_secret(conn, "zoho_refresh_token"))
    return {
        "connected": connected,
        "accounts_url": get_secret(conn, "zoho_accounts_url"),
        "client_id": get_secret(conn, "zoho_client_id"),
        "org_id": get_secret(conn, "zoho_org_id"),
        "org_name": get_secret(conn, "zoho_org_name"),
        "tax_id": get_secret(conn, "zoho_tax_id"),
        "tax_name": get_secret(conn, "zoho_tax_name"),
        "mark_invoiced": get_secret(conn, "zoho_mark_invoiced", "1") == "1",
        "regions": [{"key": k, "label": v[0], "url": v[1]} for k, v in ZOHO_REGIONS.items()],
        "scopes": ZOHO_SCOPES,
    }


@route("GET", "/api/zoho")
def api_zoho(req, conn):
    require_admin(req, conn)
    return zoho_status(conn)


@route("POST", "/api/zoho/connect")
def api_zoho_connect(req, conn):
    require_admin(req, conn)
    d = req.json() or {}
    accounts = check_accounts_url(d.get("accounts_url"))
    cid, secret, code = (as_str(d.get(k), k) for k in ("client_id", "client_secret", "code"))
    if not (cid and secret and code):
        raise ApiError(400, "Fill in the Client ID, Client Secret and the code")
    status, tok = http_json("POST", accounts + "/oauth/v2/token", {
        "code": code, "client_id": cid, "client_secret": secret, "grant_type": "authorization_code"}, form=True)
    if not tok.get("refresh_token"):
        err = tok.get("error") or tok.get("message") or f"HTTP {status}"
        hint = {"invalid_code": "The code is wrong or has expired (they only last a few minutes) — generate a new one.",
                "invalid_client": "The Client ID or region is wrong — check it matches your Zoho account's region.",
                "invalid_client_secret": "The Client Secret is wrong."}.get(err, "")
        raise ApiError(400, f"Zoho didn't accept that ({err}). {hint}".strip())
    for k, v in (("zoho_accounts_url", accounts), ("zoho_client_id", cid), ("zoho_client_secret", secret),
                 ("zoho_refresh_token", tok["refresh_token"]), ("zoho_access_token", tok.get("access_token", "")),
                 ("zoho_access_expires", time.time() + float(tok.get("expires_in") or 3600)),
                 ("zoho_api_domain", tok.get("api_domain") or accounts.replace("accounts.", "www.zohoapis.", 1))):
        set_secret(conn, k, v)
    conn.commit()
    z = Zoho(conn)
    orgs = z.call("GET", "/organizations", org=False).get("organizations", [])
    if len(orgs) == 1 or orgs:
        default = next((o for o in orgs if o.get("is_default_org")), orgs[0]) if orgs else None
        if default:
            set_secret(conn, "zoho_org_id", default["organization_id"])
            set_secret(conn, "zoho_org_name", default.get("name", ""))
    conn.commit()
    return zoho_status(conn)


@route("GET", "/api/zoho/options")
def api_zoho_options(req, conn):
    require_admin(req, conn)
    z = Zoho(conn)
    orgs = [{"id": o["organization_id"], "name": o.get("name", "")}
            for o in z.call("GET", "/organizations", org=False).get("organizations", [])]
    taxes = []
    if z.org_id:
        try:
            taxes = [{"id": t["tax_id"], "name": t.get("tax_name", ""), "rate": t.get("tax_percentage")}
                     for t in z.call("GET", "/settings/taxes").get("taxes", [])]
        except ApiError:
            taxes = []
    return {"organizations": orgs, "taxes": taxes}


@route("PUT", "/api/zoho")
def api_zoho_put(req, conn):
    require_admin(req, conn)
    if not get_secret(conn, "zoho_refresh_token"):
        raise ApiError(400, "Zoho Books isn't connected")
    d = req.json() or {}
    if "org_id" in d and d["org_id"] != get_secret(conn, "zoho_org_id"):
        set_secret(conn, "zoho_org_id", as_str(d["org_id"], "org_id"))
        set_secret(conn, "zoho_org_name", as_str(d.get("org_name"), "org_name"))
        set_secret(conn, "zoho_tax_id", "")
        set_secret(conn, "zoho_tax_name", "")
        conn.execute("UPDATE contacts SET zoho_contact_id = NULL")
    if "tax_id" in d:
        set_secret(conn, "zoho_tax_id", as_str(d["tax_id"], "tax_id"))
        set_secret(conn, "zoho_tax_name", as_str(d.get("tax_name"), "tax_name"))
    if "mark_invoiced" in d:
        set_secret(conn, "zoho_mark_invoiced", "1" if d["mark_invoiced"] else "0")
    conn.commit()
    return zoho_status(conn)


@route("POST", "/api/zoho/disconnect")
def api_zoho_disconnect(req, conn):
    require_admin(req, conn)
    refresh, accounts = get_secret(conn, "zoho_refresh_token"), get_secret(conn, "zoho_accounts_url")
    if refresh and accounts:
        try:  # best effort: revoke the token at Zoho too
            http_json("POST", accounts + "/oauth/v2/token/revoke", {"token": refresh}, form=True, timeout=8)
        except ApiError:
            pass
    conn.execute("DELETE FROM settings WHERE key LIKE 'zoho\\_%' ESCAPE '\\'")
    conn.execute("UPDATE contacts SET zoho_contact_id = NULL")
    conn.commit()
    return zoho_status(conn)


def split_name(name):
    parts = (name or "").strip().split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


def zoho_customer_id(z, conn, contact):
    """Find the client in Zoho Books. Never creates customers."""
    if contact.get("zoho_contact_id"):
        try:
            z.call("GET", f"/contacts/{contact['zoho_contact_id']}")
            return contact["zoho_contact_id"]
        except ApiError:
            pass  # removed in Zoho - look it up again
    names = {n.strip().lower() for n in (contact["company"], contact["name"]) if n and n.strip()}
    found = []
    if contact["email"]:
        found = z.call("GET", "/contacts", {"email": contact["email"], "contact_type": "customer"}).get("contacts", [])
    for n in (contact["company"], contact["name"]):
        if found or not n:
            continue
        found = [c for c in z.call("GET", "/contacts", {"search_text": n, "contact_type": "customer"})
                 .get("contacts", [])
                 if (c.get("contact_name") or "").strip().lower() in names
                 or (c.get("company_name") or "").strip().lower() in names]
    if not found:
        who = contact["company"] or contact["name"]
        how = f"the email {contact['email']} or the name “{who}”" if contact["email"] else f"the name “{who}”"
        raise ApiError(400, f"“{who}” isn't a customer in Zoho Books. Add them in Zoho first (matching on {how}), "
                            "then try again. Nothing was created.")
    cid = found[0]["contact_id"]
    conn.execute("UPDATE contacts SET zoho_contact_id = ? WHERE id = ?", (cid, contact["id"]))
    conn.commit()
    return cid


def fmt_num(n):
    n = float(n or 0)
    return str(int(n)) if n == int(n) else f"{n:.2f}".rstrip("0").rstrip(".")


def zoho_invoice_body(conn, job, customer_id, tax_id):
    s = get_settings(conn)
    cur = s.get("currency", "£")
    ids = {it["id"] for it in job["items"]}
    top = [it for it in job["items"] if not (it.get("parent_item_id") and it["parent_item_id"] in ids)]
    kids = {}
    for it in job["items"]:
        if it.get("parent_item_id") in ids:
            kids.setdefault(it["parent_item_id"], []).append(it)
    ordered = []

    def walk(x):
        ordered.append(x)
        for c in kids.get(x["id"], []):
            walk(c)
    for k in ("rental", "sale", "service"):
        for t in (x for x in top if x["kind"] == k):
            walk(t)
    lines = []
    for it in ordered:
        total = it["line_total"]
        if not total and not it["unit_price"]:
            continue  # free/included accessory or cable-run heading - not billed
        qty = it["quantity"] or 0
        bits = []
        if it["kind"] == "rental":
            bits.append(f"{fmt_num(it['effective_days'])} day{'s' if it['effective_days'] != 1 else ''} "
                        f"@ {cur}{it['unit_price']:.2f}/day")
        if it["discount_pct"]:
            bits.append(f"{fmt_num(it['discount_pct'])}% discount")
        if it.get("parent_item_id"):
            bits.append("accessory")
        rate = round(total / qty, 2) if qty else total
        if qty and abs(rate * qty - total) < 0.005:
            q = qty
        else:  # can't express exactly per unit - bill the line as one
            rate, q = total, 1
            bits.insert(0, f"{fmt_num(qty)} ×")
        line = {"name": it["description"][:100] or "Item", "description": ", ".join(bits),
                "rate": round(rate, 2), "quantity": int(q) if float(q).is_integer() else q}
        if tax_id:
            line["tax_id"] = tax_id
        lines.append(line)
    if not lines:
        raise ApiError(400, "This job has nothing to invoice yet")
    ref = job["number"] + (f" / {job['reference']}" if job.get("reference") else "")
    when = fmt_range(job["start_date"], job["end_date"])
    notes = "\n".join(x for x in (f"{job['name']}" + (f" — {job['venue']}" if job.get("venue") else ""),
                                   when, job.get("notes") or "") if x)
    body = {"customer_id": customer_id, "reference_number": ref[:50], "date": dt.date.today().isoformat(),
            "line_items": lines, "notes": notes[:5000]}
    if job.get("discount_pct"):
        body.update({"discount": f"{fmt_num(job['discount_pct'])}%", "is_discount_before_tax": True,
                     "discount_type": "entity_level"})
    return body


def fmt_range(a, b):
    da, db_ = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    f = lambda d: d.strftime("%a %d %b %Y").replace(" 0", " ")
    return f(da) if a == b else f"{f(da)} – {f(db_)}"


HELV_W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500]
HELV_BOLD_W = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556]
STATUS_NAMES = {"enquiry": "Enquiry", "quote": "Quotation", "provisional": "Provisional", "confirmed": "Confirmed",
                "out": "On hire", "returned": "Returned", "invoiced": "Invoiced", "cancelled": "Cancelled", "lost": "Lost"}


def fmt_date(iso):
    return dt.date.fromisoformat(iso[:10]).strftime("%d %b %Y").lstrip("0")


# ---- invoices: numbers and dates, PDF documents, and exports for accounting software

ACCOUNTING = {
    "quickbooks": {"label": "QuickBooks Online", "tax": "20.0% S", "tax0": "No VAT", "account": ""},
    "xero": {"label": "Xero", "tax": "20% (VAT on Income)", "tax0": "No VAT", "account": "200"},
    "zoho": {"label": "Zoho Books", "tax": "Standard Rate", "tax0": "", "account": ""},
    "sage50": {"label": "Sage 50 Accounts", "tax": "T1", "tax0": "T9", "account": "4000"},
    "sagecloud": {"label": "Sage Accounting", "tax": "Standard 20%", "tax0": "No VAT", "account": ""},
    # Plain columns any program's importer can map: FreeAgent, KashFlow, Clear Books, QuickFile and other MTD software.
    "generic": {"label": "Other software (generic CSV)", "tax": "", "tax0": "", "account": ""},
}
KIND_ITEM = {"rental": "Equipment hire", "sale": "Sales", "service": "Services"}


def invoice_info(job, s):
    """The job's invoice number, date and due date. Fixed once the invoice is issued (exported or downloaded)."""
    number = job.get("invoice_number") or f"{s.get('invoice_prefix', '')}{job['number']}"
    issued = bool(job.get("invoice_date"))
    date = dt.date.fromisoformat(job["invoice_date"]) if issued else dt.date.today()
    try:
        days = max(0, int(s.get("payment_terms_days") or 0))
    except ValueError:
        days = 30
    return {"number": number, "date": date.isoformat(), "due": (date + dt.timedelta(days=days)).isoformat(),
            "terms_days": days, "issued": issued, "exported_at": job.get("exported_at"), "exported_to": job.get("exported_to")}


def issue_invoice(conn, job):
    """Fix the invoice number and date the first time a job's invoice leaves the app."""
    if job.get("invoice_date"):
        return
    s = get_settings(conn)
    number = f"{s.get('invoice_prefix', '')}{job['number']}"
    conn.execute("UPDATE jobs SET invoice_number = ?, invoice_date = ? WHERE id = ?",
                 (number, dt.date.today().isoformat(), job["id"]))
    job["invoice_number"], job["invoice_date"] = number, dt.date.today().isoformat()


def _ordered_items(job):
    ids = {it["id"] for it in job["items"]}
    kids = {}
    for it in job["items"]:
        if it.get("parent_item_id") in ids:
            kids.setdefault(it["parent_item_id"], []).append(it)
    out = []

    def walk(x, depth):
        out.append((x, depth))
        for c in kids.get(x["id"], []):
            walk(c, depth + 1)
    for k in ("rental", "sale", "service"):
        for t in (x for x in job["items"] if x["kind"] == k and not (x.get("parent_item_id") in ids)):
            walk(t, 0)
    return out


def invoice_lines(job, vat_rate, cur="£"):
    """Billable lines, with the job discount folded into each line (accounting imports don't take negative lines).
    Free included accessories and cable-run / stage headings aren't billed."""
    lines = []
    disc = job.get("discount_pct") or 0
    for it, depth in _ordered_items(job):
        total = it["line_total"]
        if not total and not it["unit_price"]:
            continue
        bits = []
        if it["kind"] == "rental":
            d = it["effective_days"]
            bits.append(f"{fmt_num(d)} day{'s' if d != 1 else ''} @ {cur}{it['unit_price']:.2f}/day")
        if it["discount_pct"]:
            bits.append(f"{fmt_num(it['discount_pct'])}% discount")
        if disc:
            bits.append(f"less {fmt_num(disc)}% job discount")
        lines.append({"name": (it["description"] or "Item")[:100], "kind": it["kind"], "qty": it["quantity"] or 0,
                      "amount": round(total * (1 - disc / 100.0), 2), "bits": bits, "sku": it.get("product_sku") or ""})
    net = job["totals"]["net"]
    if lines:
        diff = round(net - sum(x["amount"] for x in lines), 2)
        if diff:
            max(lines, key=lambda x: x["amount"])["amount"] = round(max(lines, key=lambda x: x["amount"])["amount"] + diff, 2)
    for x in lines:
        q = x["qty"]
        rate = round(x["amount"] / q, 4) if q else x["amount"]
        if q and abs(round(rate, 2) * q - x["amount"]) < 0.005:
            x["rate"] = round(rate, 2)
        else:  # can't be shown per unit - bill the line as one
            x["bits"].insert(0, f"{fmt_num(q)} ×")
            x["qty"], x["rate"] = 1, x["amount"]
        x["tax"] = round(x["amount"] * vat_rate / 100.0, 2)
        x["description"] = ", ".join(x["bits"])
    return lines


def _d(iso, fmt="dmy"):
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}" if fmt == "dmy" else iso


def _addr_lines(addr):
    parts = [p.strip() for p in re.split(r"[\n,]+", addr or "") if p.strip()]
    return (parts + ["", "", "", ""])[:4] if len(parts) <= 4 else parts[:3] + [", ".join(parts[3:])]


def account_ref(contact):
    if not contact:
        return ""
    if contact.get("account_ref"):
        return contact["account_ref"]
    base = re.sub(r"[^A-Za-z0-9]", "", (contact.get("company") or contact.get("name") or "").upper())
    return base[:8]


def accounting_rows(fmt, jobs, s, vat_rate):
    meta = ACCOUNTING[fmt]
    # Not VAT registered (rate 0): always the no-VAT code, even if a VAT code was typed in for when you were.
    tax = ((s.get("acc_tax_code") or "").strip() or meta["tax"]) if vat_rate else meta["tax0"]
    account = (s.get("acc_sales_account") or "").strip() or meta["account"]
    by_item = s.get("acc_item_names") == "item"
    cur = s.get("currency", "£")
    header, out = None, []
    for job in jobs:
        info = invoice_info(job, s)
        c = job.get("contact") or {}
        customer = c.get("company") or c.get("name") or "Customer"
        ref = job["number"] + (f" / {job['reference']}" if job.get("reference") else "")
        memo = f"{job['name']}" + (f" — {job['venue']}" if job.get("venue") else "") + f", {fmt_range(job['start_date'], job['end_date'])}"
        lines = invoice_lines(job, vat_rate, cur)
        if not lines:
            raise ApiError(400, f"{job['number']} {job['name']} has nothing to invoice")
        for x in lines:
            item = x["name"] if by_item else KIND_ITEM[x["kind"]]
            desc = x["name"] + (f" ({x['description']})" if x["description"] else "")
            if fmt == "quickbooks":
                header = ["*InvoiceNo", "*Customer", "*InvoiceDate", "*DueDate", "Terms", "Memo", "Item(Product/Service)",
                          "ItemDescription", "ItemQuantity", "ItemRate", "*ItemAmount", "*ItemTaxCode", "ItemTaxAmount"]
                out.append([info["number"], customer, _d(info["date"]), _d(info["due"]), f"Net {info['terms_days']}", memo,
                            item, desc, fmt_num(x["qty"]), f"{x['rate']:.2f}", f"{x['amount']:.2f}", tax, f"{x['tax']:.2f}"])
            elif fmt == "xero":
                header = ["*ContactName", "EmailAddress", "POAddressLine1", "POAddressLine2", "POAddressLine3", "POAddressLine4",
                          "POCity", "PORegion", "POPostalCode", "POCountry", "*InvoiceNumber", "Reference", "*InvoiceDate",
                          "*DueDate", "InventoryItemCode", "*Description", "*Quantity", "*UnitAmount", "Discount",
                          "*AccountCode", "*TaxType", "TrackingName1", "TrackingOption1", "TrackingName2", "TrackingOption2",
                          "Currency", "BrandingTheme"]
                a = _addr_lines(c.get("address"))
                out.append([customer, c.get("email", "")] + a + ["", "", "", "", info["number"], ref, _d(info["date"]),
                           _d(info["due"]), x["sku"] if by_item else "", desc, fmt_num(x["qty"]), f"{x['rate']:.2f}", "",
                           account, tax, "", "", "", "", "", ""])
            elif fmt == "zoho":
                header = ["Invoice Number", "Invoice Date", "Due Date", "Invoice Status", "Customer Name", "Payment Terms",
                          "PurchaseOrder", "Item Name", "Item Desc", "Quantity", "Item Price", "Item Tax", "Item Tax %", "Notes"]
                out.append([info["number"], info["date"], info["due"], "Draft", customer, str(info["terms_days"]),
                            job.get("reference") or "", item, desc, fmt_num(x["qty"]), f"{x['rate']:.2f}",
                            tax if vat_rate else "", fmt_num(vat_rate) if vat_rate else "", memo])
            elif fmt == "sage50":
                header = ["Type", "Account Reference", "Nominal A/C Ref", "Department Code", "Date", "Reference", "Details",
                          "Net Amount", "Tax Code", "Tax Amount", "Exchange Rate", "Extra Reference", "User Name",
                          "Project Refn", "Cost Code Refn"]
                out.append(["SI", account_ref(c), account, "", _d(info["date"]), info["number"][:30], desc[:60],
                            f"{x['amount']:.2f}", tax, f"{x['tax']:.2f}", "", job["number"][:30], "", "", ""])
            elif fmt == "generic":
                header = ["Invoice Number", "Invoice Date", "Due Date", "Customer", "Customer Email", "Customer Account Ref",
                          "Job Number", "Reference", "Item", "Description", "Quantity", "Unit Price", "Net Amount",
                          "VAT Code", "VAT Rate %", "VAT Amount", "Gross Amount", "Nominal Code", "Notes"]
                out.append([info["number"], _d(info["date"]), _d(info["due"]), customer, c.get("email", ""),
                            c.get("account_ref", ""), job["number"], job.get("reference") or "", item, desc,
                            fmt_num(x["qty"]), f"{x['rate']:.2f}", f"{x['amount']:.2f}", tax, fmt_num(vat_rate),
                            f"{x['tax']:.2f}", f"{x['amount'] + x['tax']:.2f}", account, memo])
            elif fmt == "sagecloud":
                header = ["Contact Name", "Date", "Reference", "Description", "Net Amount", "Tax Rate", "Total Amount"]
                out.append([customer, _d(info["date"]), info["number"], desc, f"{x['amount']:.2f}", tax,
                            f"{x['amount'] + x['tax']:.2f}"])
    return header, out


def jobs_for_invoicing(conn, ids):
    try:
        ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        raise ApiError(400, "Choose the jobs to include")
    if not ids:
        raise ApiError(400, "Choose at least one job")
    if len(ids) > 200:
        raise ApiError(400, "Choose up to 200 jobs at a time")
    return [job_detail(conn, i) for i in ids]


@route("POST", "/api/invoices/export")
def api_invoices_export(req, conn):
    d = req.json() or {}
    s = get_settings(conn)
    fmt = d.get("format") or s.get("accounting_software") or ""
    if fmt not in ACCOUNTING:
        raise ApiError(400, "Choose your accounting software (QuickBooks, Xero, Zoho Books, Sage or another program)")
    jobs = jobs_for_invoicing(conn, d.get("ids") or [])
    if fmt == "quickbooks" and len(jobs) > 100:
        raise ApiError(400, "QuickBooks imports up to 100 invoices at a time — choose fewer jobs")
    for j in jobs:
        issue_invoice(conn, j)
    header, out = accounting_rows(fmt, jobs, s, vat_rate_of(conn))
    if fmt == "quickbooks" and len(out) > 1000:
        raise ApiError(400, f"That's {len(out)} invoice lines; QuickBooks imports up to 1,000 rows at a time — choose fewer jobs")
    now = now_iso()
    for j in jobs:
        conn.execute("UPDATE jobs SET exported_at = ?, exported_to = ? WHERE id = ?", (now, fmt, j["id"]))
        if d.get("mark_invoiced") and j["status"] in ("confirmed", "out", "returned"):
            conn.execute("UPDATE jobs SET status = 'invoiced', updated_at = ? WHERE id = ?", (now, j["id"]))
    conn.commit()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows([[csv_safe(c) for c in row] for row in out])
    name = ACCOUNTING[fmt]["label"].replace(" ", "-").lower()
    one_ = jobs[0]["number"] if len(jobs) == 1 else f"{len(jobs)}-invoices"
    body = ("\ufeff" + buf.getvalue()).encode("utf-8") if fmt != "sage50" else buf.getvalue().encode("cp1252", "replace")
    return Raw(body, "text/csv; charset=utf-8" if fmt != "sage50" else "text/csv; charset=windows-1252",
               filename=f"{name}-{one_}-{dt.date.today().isoformat()}.csv")


# ---- PDF (written directly - no extra software needed). Helvetica, WinAnsi text.

PDF_W, PDF_H, PDF_M = 595.28, 841.89, 42.0
PDF_SUBS = {"−": "-", "→": "->", "↳": "", "≈": "~", "…": "...", " ": " ", " ": " ",
            "‑": "-", "‐": "-", "✓": "", "✗": ""}


def pdf_safe(s):
    s = "".join(PDF_SUBS.get(ch, ch) for ch in str(s or ""))
    return s.encode("cp1252", "replace").decode("cp1252")


def pdf_width(s, size, bold=False):
    table = HELV_BOLD_W if bold else HELV_W
    w = 0
    for b in pdf_safe(s).encode("cp1252", "replace"):
        w += table[b - 32] if 32 <= b < 256 else 500
    return w * size / 1000.0


def pdf_wrap(s, width, size, bold=False):
    out = []
    for para in pdf_safe(s).split("\n"):
        words, line = para.split(" "), ""
        for wd in words:
            t = (line + " " + wd).strip() if line else wd
            if pdf_width(t, size, bold) <= width or not line:
                line = t
            else:
                out.append(line)
                line = wd
        out.append(line)
    return out


def _hex_rgb(h, default=(0.12, 0.36, 0.24)):
    try:
        h = h.lstrip("#")
        return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except (ValueError, AttributeError):
        return default


class PdfDoc:
    def __init__(self, producer="Horan Event Tracking"):
        self.producer = producer
        self.pages = []
        self.images = []
        self.ops = None

    def page(self):
        self.ops = []
        self.pages.append(self.ops)

    def _esc(self, s):
        b = pdf_safe(s).encode("cp1252", "replace")
        return b.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")

    def text(self, x, y, s, size=9, bold=False, color=(0.1, 0.12, 0.11), align="left"):
        if align == "right":
            x -= pdf_width(s, size, bold)
        elif align == "center":
            x -= pdf_width(s, size, bold) / 2
        self.ops.append(b"BT /%s %.2f Tf %.3f %.3f %.3f rg %.2f %.2f Td (" % (b"F2" if bold else b"F1", size, *color, x, PDF_H - y)
                        + self._esc(s) + b") Tj ET")

    def rect(self, x, y, w, h, fill):
        self.ops.append(b"%.3f %.3f %.3f rg %.2f %.2f %.2f %.2f re f" % (*fill, x, PDF_H - y - h, w, h))

    def line(self, x1, y1, x2, y2, width=0.5, color=(0.8, 0.82, 0.8)):
        self.ops.append(b"%.3f %.3f %.3f RG %.2f w %.2f %.2f m %.2f %.2f l S" % (*color, width, x1, PDF_H - y1, x2, PDF_H - y2))

    def image(self, jpeg, px_w, px_h, x, y, w, h):
        name = b"Im%d" % len(self.images)
        self.images.append((name, jpeg, px_w, px_h))
        self.ops.append(b"q %.2f 0 0 %.2f %.2f %.2f cm /%s Do Q" % (w, h, x, PDF_H - y - h, name))

    def output(self, title=""):
        objs = []

        def add(b):
            objs.append(b)
            return len(objs)
        cat = add(None)
        pages_id = add(None)
        f1 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        f2 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
        xo = []
        for name, data, pw, ph in self.images:
            i = add(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 "
                    b"/Filter /DCTDecode /Length %d >>\nstream\n" % (pw, ph, len(data)) + data + b"\nendstream")
            xo.append(b"/%s %d 0 R" % (name, i))
        res = b"<< /Font << /F1 %d 0 R /F2 %d 0 R >> /XObject << %s >> >>" % (f1, f2, b" ".join(xo))
        kids = []
        for ops in self.pages:
            raw = zlib.compress(b"\n".join(ops))
            cs = add(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(raw) + raw + b"\nendstream")
            kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] /Resources %s /Contents %d 0 R >>"
                            % (pages_id, PDF_W, PDF_H, res, cs)))
        objs[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
        objs[cat - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id
        info = add(b"<< /Title (" + self._esc(title) + b") /Producer (" + self._esc(self.producer) + b") >>")
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offs = []
        for n, o in enumerate(objs, 1):
            offs.append(len(out))
            out += b"%d 0 obj\n" % n + o + b"\nendobj\n"
        xref = len(out)
        out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
        for o in offs:
            out += b"%010d 00000 n \n" % o
        out += b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, info, xref)
        return bytes(out)


def with_brand(it):
    """A line's description with its stock item's brand in front, unless the description already starts with it."""
    desc, brand = it.get("description") or "", (it.get("product_brand") or "").strip()
    return f"{brand} {desc}" if brand and not desc.lower().startswith(brand.lower()) else desc


DOC_LAYOUT_DEFAULT = {
    "method": "options",            # options | html
    "logo_position": "left",        # left | center | right
    "logo_size": "medium",          # small | medium | large
    "colour": "",                   # "" = the brand colour
    "font_size": "normal",          # small | normal | large
    "title": "", "header_text": "", "footer_text": "",
    "show_company_details": True, "show_client_contact": True, "show_job": True,
    "show_codes": False, "show_brand": True, "show_rate": True, "show_days": True, "show_discount": True,
    "show_line_totals": True, "show_subtotals": True,
    "show_notes": True, "show_payment": True, "show_terms": True,
    "block_order": ["notes", "payment", "terms"],
    "html": "",
}
DOC_LAYOUT_CHOICES = {"method": ("options", "html"), "logo_position": ("left", "center", "right"),
                      "logo_size": ("small", "medium", "large"), "font_size": ("small", "normal", "large")}
DOC_BLOCKS = ("notes", "payment", "terms")


def clean_doc_layout(raw):
    """A layout from Settings, checked: unknown keys dropped, wrong values back to the default."""
    try:
        v = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        raise ApiError(400, "That document layout couldn't be read")
    if not v:
        return {}
    if not isinstance(v, dict):
        raise ApiError(400, "That document layout couldn't be read")
    out = {}
    for k, default in DOC_LAYOUT_DEFAULT.items():
        if k not in v:
            continue
        x = v[k]
        if k in DOC_LAYOUT_CHOICES:
            if x in DOC_LAYOUT_CHOICES[k]:
                out[k] = x
        elif k == "colour":
            if x == "" or (isinstance(x, str) and re.match(r"^#[0-9a-fA-F]{6}$", x)):
                out[k] = x
        elif k == "block_order":
            if isinstance(x, list) and sorted(x) == sorted(DOC_BLOCKS):
                out[k] = x
        elif isinstance(default, bool):
            out[k] = bool(x)
        elif k == "html":
            out[k] = str(x)[:200000]
        else:
            out[k] = str(x)[:2000]
    return out


def doc_layout(s, doc):
    """The layout for a quote or invoice: the shared one, or the document's own."""
    key = "doc_layout_quote"
    if s.get("doc_layout_shared", "1") == "0" and doc == "invoice" and (s.get("doc_layout_invoice") or "").strip():
        key = "doc_layout_invoice"
    try:
        v = clean_doc_layout(s.get(key) or "")
    except ApiError:
        v = {}
    return dict(DOC_LAYOUT_DEFAULT, **v)


def render_invoice_pdf(pdf, job, s, doc, logo, vat_rate, layout=None):
    """One quotation or invoice, on as many pages as it needs, laid out as Settings → Customisation says."""
    lay = layout or doc_layout(s, doc)
    brand = _hex_rgb(lay["colour"] or s.get("brand_primary"))
    sc = {"small": 0.9, "normal": 1.0, "large": 1.12}[lay["font_size"]]
    grey, dark, light = (0.42, 0.45, 0.43), (0.1, 0.12, 0.11), (0.95, 0.96, 0.95)
    cur = s.get("currency", "£")
    money_ = lambda v: f"{'-' if v < 0 else ''}{cur}{abs(v):,.2f}"
    L, R = PDF_M, PDF_W - PDF_M
    info = invoice_info(job, s)
    t = job["totals"]
    company = s.get("company_name", "")
    registered = s.get("vat_registered", "1") != "0"
    foot = " · ".join(x for x in (company, f"Company no. {s['company_number']}" if s.get("company_number") else "",
                                  f"VAT no. {s['vat_number']}" if s.get("vat_number") and registered else "") if x)
    title = (lay["title"].strip() or ("Invoice" if doc == "invoice" else "Quotation")).upper()
    state = {"y": 0}

    def new_page(first=False):
        pdf.page()
        fy = PDF_H - 24
        pdf.text(L, fy, foot, 7.5, color=grey)
        if lay["footer_text"].strip():
            for i, ln in enumerate(reversed(pdf_wrap(lay["footer_text"], R - L, 7.5)[:3])):
                pdf.text(L, fy - 10 * (i + 1), ln, 7.5, color=grey)
        if not first:
            pdf.text(L, PDF_M + 10, f"{title.title()} {info['number'] if doc == 'invoice' else job['number']} (continued)", 9, True, brand)
            state["y"] = PDF_M + 30

    bottom = PDF_H - 60 - (10 * min(3, len(pdf_wrap(lay["footer_text"], R - L, 7.5))) if lay["footer_text"].strip() else 0)

    def need(h):
        if state["y"] + h > bottom:
            new_page()
            table_head()

    new_page(first=True)
    y = PDF_M
    pos = lay["logo_position"]
    max_h, max_w = {"small": (40.0, 120.0), "medium": (60.0, 170.0), "large": (90.0, 250.0)}[lay["logo_size"]]
    details = []
    if lay["show_company_details"]:
        details = [x for x in (s.get("company_address") or "").split("\n") if x.strip()] + \
            [x for x in (" · ".join(x for x in (s.get("company_phone"), s.get("company_email")) if x), s.get("company_website", "")) if x]
    # the logo (or the company name in large type when there's no logo)
    if logo:
        data, pw, ph = logo
        w = min(max_w, max_h * pw / ph)
        h = w * ph / pw
        lx = L if pos == "left" else (R - w if pos == "right" else (L + R - w) / 2)
        pdf.image(data, pw, ph, lx, y, w, h)
        top_h = h
    else:
        pdf.text({"left": L, "right": R, "center": (L + R) / 2}[pos], y + 16, company, 16 * sc, True, brand,
                 {"left": "left", "right": "right", "center": "center"}[pos])
        top_h = 20
    # the company's details opposite the logo, or under it when it's centred
    if pos == "center":
        cy = y + top_h + 4
        for ln in ([company] if logo else []) + details:
            cy += 11
            pdf.text((L + R) / 2, cy, ln, 8.5 if ln != company else 10, ln == company, dark if ln == company else grey, "center")
        y = cy + 26
    else:
        dx, align = (R, "right") if pos == "left" else (L, "left")
        cy = y + 8
        pdf.text(dx, cy, company, 10, True, dark, align)
        for ln in details:
            cy += 11
            pdf.text(dx, cy, ln, 8.5, color=grey, align=align)
        y = max(y + top_h, cy) + 26

    pdf.text(L, y, title, 20 * sc, True, brand)
    meta = ([("Invoice no.", info["number"]), ("Date", fmt_date(info["date"])), ("Due", fmt_date(info["due"])),
             ("Job", job["number"])] if doc == "invoice" else
            [("Quote no.", job["number"]), ("Date", fmt_date(dt.date.today().isoformat())), ("Status", STATUS_NAMES.get(job["status"], job["status"]))])
    if job.get("reference"):
        meta.append(("Your ref", job["reference"]))
    my = y - 12
    for k, v in meta:
        pdf.text(R - 110, my, k, 8.5 * sc, color=grey, align="right")
        pdf.text(R, my, v, 8.5 * sc, True, dark, "right")
        my += 12 * sc
    y = max(y + 14, my) + 10
    if lay["header_text"].strip():
        for ln in pdf_wrap(lay["header_text"], R - L, 9.5 * sc):
            pdf.text(L, y, ln, 9.5 * sc, False, dark)
            y += 12.5 * sc
        y += 8

    c = job.get("contact") or {}
    who = [c.get("company") or c.get("name") or "—"] + ([c["name"]] if c.get("company") and c.get("name") else [])
    if lay["show_client_contact"]:
        who += [x for x in (c.get("address") or "").split("\n") if x.strip()] + ([c["email"]] if c.get("email") else [])
    hire = (dt.date.fromisoformat(job["end_date"]) - dt.date.fromisoformat(job["start_date"])).days + 1
    jl = [job["name"]] + ([job["venue"]] if job.get("venue") else []) + \
         [fmt_range(job["start_date"], job["end_date"]), f"Hire period: {hire} day{'s' if hire != 1 else ''}"]
    pdf.text(L, y, "INVOICE TO" if doc == "invoice" else "PREPARED FOR", 7.5, True, grey)
    yy = yj = y
    for i, ln in enumerate(who):
        for part in pdf_wrap(ln, 250, 9.5 * sc, i == 0):
            yy += 12.5 * sc
            pdf.text(L, yy, part, 9.5 * sc, i == 0, dark)
    if lay["show_job"]:
        pdf.text(L + 270, y, "JOB", 7.5, True, grey)
        for i, ln in enumerate(jl):
            for part in pdf_wrap(ln, 240, 9.5 * sc, i == 0):
                yj += 12.5 * sc
                pdf.text(L + 270, yj, part, 9.5 * sc, i == 0, dark)
    state["y"] = max(yy, yj) + 22

    has_rental = any(i["kind"] == "rental" for i in job["items"])
    any_disc = any(i["discount_pct"] for i in job["items"])
    xr = R
    right_cols = []
    for name, show, w in (("Total", lay["show_line_totals"], 70), ("Disc", any_disc and lay["show_discount"], 38),
                          ("Days", has_rental and lay["show_days"], 36),
                          ("Rate" if has_rental else "Price", lay["show_rate"], 62), ("Qty", True, 36),
                          ("Code", lay["show_codes"], 70)):
        if show:
            right_cols.append((name, xr))
            xr -= w * sc
    desc_w = xr - L - 10
    fs = 9 * sc
    lh = 11.5 * sc

    def table_head():
        y0 = state["y"]
        hh = 18 * sc
        pdf.rect(L, y0, R - L, hh, brand)
        pdf.text(L + 6, y0 + hh - 5.5, "Description", 8.5 * sc, True, (1, 1, 1))
        for name, x in right_cols:
            pdf.text(x - 6, y0 + hh - 5.5, name, 8.5 * sc, True, (1, 1, 1), "right")
        state["y"] = y0 + hh

    def row(cells, desc, depth=0, bold=False, fill=None):
        lines_ = pdf_wrap(("- " if depth else "") + desc, desc_w - depth * 10, fs, bold)
        h = 6 + lh * len(lines_)
        need(h)
        y0 = state["y"]
        if fill:
            pdf.rect(L, y0, R - L, h, fill)
        for i, ln in enumerate(lines_):
            pdf.text(L + 6 + depth * 10, y0 + 3 + fs + i * lh, ln, fs, bold, dark if not depth else (0.3, 0.32, 0.31))
        for (name, x), v in zip(right_cols, cells):
            if v != "":
                pdf.text(x - 6, y0 + 3 + fs, v, fs if name != "Code" else fs * 0.85, bold, dark, "right")
        pdf.line(L, y0 + h, R, y0 + h, 0.4, (0.88, 0.89, 0.88))
        state["y"] = y0 + h

    table_head()
    show_incl = s.get("show_included_accessories") == "1"
    labels = {"rental": "Equipment hire", "sale": "Sales", "service": "Labour & services"}
    ordered = _ordered_items(job)
    for k in ("rental", "sale", "service"):
        its = [(it, d) for it, d in ordered if it["kind"] == k]
        if not its:
            continue
        row([""] * len(right_cols), labels[k], bold=True, fill=light)
        for it, depth in its:
            m = jload(it.get("meta"))
            run = m.get("type") in ("cable_run", "stage")
            included = bool(it.get("parent_item_id")) and not it["unit_price"] and not it["line_total"]
            if included and not show_incl:
                continue
            vals = {"Qty": fmt_num(it["quantity"]), "Code": it.get("product_sku") or ""}
            if run:
                desc = f"{it['description']} (each: {m.get('summary', '')})"
            else:
                desc = with_brand(it) if lay["show_brand"] else (it.get("description") or "")
                if included:
                    vals["Total"] = "Included"
                else:
                    vals.update({"Rate": money_(it["unit_price"]), "Price": money_(it["unit_price"]),
                                 "Days": fmt_num(it["effective_days"]) if k == "rental" else "",
                                 "Disc": f"{fmt_num(it['discount_pct'])}%" if it["discount_pct"] else "",
                                 "Total": money_(it["line_total"])})
            row([vals.get(n, "") for n, _ in right_cols], desc, depth)
        if lay["show_subtotals"]:
            need(18)
            y0 = state["y"]
            pdf.text(R - 110, y0 + 12, f"{labels[k]} subtotal", 8.5 * sc, False, grey, "right")
            pdf.text(R - 6, y0 + 12, money_(t[k]), fs, True, dark, "right")
            state["y"] = y0 + 18

    tot = []
    if t["discount"]:
        tot += [("Subtotal", money_(t["gross"]), False), (f"Discount ({fmt_num(job.get('discount_pct') or 0)}%)", money_(-t["discount"]), False)]
    if registered:
        tot += [("Net", money_(t["net"]), False), (f"VAT {fmt_num(t['vat_rate'])}%", money_(t["vat"]), False)]
    tot += [("Total", money_(t["total"]), True)]
    need(16 * len(tot) + 20)
    y0 = state["y"] + 10
    for label, v, big in tot:
        if big:
            pdf.line(R - 200, y0 + 2, R, y0 + 2, 1.2, brand)
            y0 += 6
        pdf.text(R - 110, y0 + 11, label, (11 if big else 9) * sc, big, dark, "right")
        pdf.text(R - 6, y0 + 11, v, (11 if big else 9) * sc, big, dark, "right")
        y0 += (16 if big else 14) * sc
    state["y"] = y0 + 12

    terms = s.get("invoice_terms") if doc == "invoice" else s.get("quote_terms")
    texts = {"notes": ("NOTES", job.get("notes") if lay["show_notes"] else ""),
             "payment": ("PAYMENT DETAILS", s.get("payment_details") if doc == "invoice" and lay["show_payment"] else ""),
             "terms": ("TERMS", terms if lay["show_terms"] else "")}
    for key in lay["block_order"]:
        head, body = texts[key]
        if not body:
            continue
        lines_ = pdf_wrap(body, R - L, 8.5 * sc)
        need(16 + 11 * min(len(lines_), 6))
        pdf.text(L, state["y"] + 10, head, 7.5, True, grey)
        state["y"] += 14
        for ln in lines_:
            need(11 * sc)
            pdf.text(L, state["y"] + 9, ln, 8.5 * sc, False, dark)
            state["y"] += 11 * sc
        state["y"] += 8


def decode_logo(data_url):
    """A JPEG of the logo made by the browser (so SVG, PNG and WebP logos all work). Returns (bytes, w, h) or None."""
    if not data_url or not isinstance(data_url, str) or not data_url.startswith("data:image/jpeg;base64,"):
        return None
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1])
    except (ValueError, binascii.Error):
        return None
    if len(raw) > 3_000_000 or raw[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(raw):
        if raw[i] != 0xFF:
            return None
        marker, seg = raw[i + 1], int.from_bytes(raw[i + 2:i + 4], "big")
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = int.from_bytes(raw[i + 5:i + 7], "big"), int.from_bytes(raw[i + 7:i + 9], "big")
            return (raw, w, h) if w and h else None
        i += 2 + seg
    return None


@route("POST", "/api/invoices/issue")
def api_invoices_issue(req, conn):
    """Printing an invoice from an HTML template layout: fix its number and date, as downloading the PDF does."""
    d = req.json() or {}
    jobs = jobs_for_invoicing(conn, d.get("ids") or [])
    for j in jobs:
        issue_invoice(conn, j)
        if d.get("mark_invoiced") and j["status"] in ("confirmed", "out", "returned"):
            conn.execute("UPDATE jobs SET status = 'invoiced', updated_at = ? WHERE id = ?", (now_iso(), j["id"]))
    conn.commit()
    return {"ok": True}


@route("POST", "/api/invoices/pdf")
def api_invoices_pdf(req, conn):
    d = req.json() or {}
    doc = "quote" if d.get("doc") == "quote" else "invoice"
    jobs = jobs_for_invoicing(conn, d.get("ids") or [])
    s = get_settings(conn)
    if doc == "invoice" and not d.get("layout"):  # a layout preview doesn't issue anything
        for j in jobs:
            issue_invoice(conn, j)
            if d.get("mark_invoiced") and j["status"] in ("confirmed", "out", "returned"):
                conn.execute("UPDATE jobs SET status = 'invoiced', updated_at = ? WHERE id = ?", (now_iso(), j["id"]))
        conn.commit()
    logo = decode_logo(d.get("logo"))
    layout = None
    if d.get("layout"):  # Settings' "Preview PDF": try a layout before saving it
        require_admin(req, conn)
        layout = dict(DOC_LAYOUT_DEFAULT, **clean_doc_layout(d["layout"]))
    pdf = PdfDoc(app_name(conn))
    for j in jobs:
        render_invoice_pdf(pdf, j, s, doc, logo, vat_rate_of(conn), layout)
    word = "Invoice" if doc == "invoice" else "Quotation"
    if len(jobs) == 1:
        j = jobs[0]
        num = invoice_info(j, s)["number"] if doc == "invoice" else j["number"]
        safe = re.sub(r"[^A-Za-z0-9 ._-]+", "", f"{word} {num} {j['name']}").strip()[:80]
    else:
        safe = f"{word}s {len(jobs)} jobs {dt.date.today().isoformat()}"
    return Raw(pdf.output(f"{word} {jobs[0]['number']}"), "application/pdf", filename=f"{safe}.pdf")


@route("POST", r"/api/jobs/(\d+)/zoho")
def api_job_zoho(req, conn, jid):
    jid = int(jid)
    job = job_detail(conn, jid)
    if not job["contact"]:
        raise ApiError(400, "Add a client to this job first — Zoho needs a customer for the invoice")
    z = Zoho(conn)
    tax_id = get_secret(conn, "zoho_tax_id") if vat_registered(conn) else ""
    cust = zoho_customer_id(z, conn, job["contact"])
    body = zoho_invoice_body(conn, job, cust, tax_id)
    if job.get("zoho_invoice_id"):
        inv = z.call("PUT", f"/invoices/{job['zoho_invoice_id']}", body=body)["invoice"]
        action = "updated"
    else:
        inv = z.call("POST", "/invoices", body=body)["invoice"]
        action = "created"
    conn.execute("UPDATE jobs SET zoho_invoice_id = ?, zoho_invoice_number = ?, zoho_synced_at = ?, updated_at = ? "
                 "WHERE id = ?", (inv["invoice_id"], inv.get("invoice_number", ""), now_iso(), now_iso(), jid))
    if action == "created" and get_secret(conn, "zoho_mark_invoiced", "1") == "1":
        conn.execute("UPDATE jobs SET status = 'invoiced' WHERE id = ?", (jid,))
    conn.commit()
    out = job_detail(conn, jid)
    out["zoho_result"] = {"action": action, "invoice_number": inv.get("invoice_number", ""),
                          "total": inv.get("total"), "url": z.books_url(f"invoices/{inv['invoice_id']}")}
    return out


@route("POST", r"/api/jobs/(\d+)/zoho/unlink")
def api_job_zoho_unlink(req, conn, jid):
    conn.execute("UPDATE jobs SET zoho_invoice_id = NULL, zoho_invoice_number = NULL, zoho_synced_at = NULL "
                 "WHERE id = ?", (jid,))
    conn.commit()
    return job_detail(conn, int(jid))


# ---- products

PRODUCT_LIST_SQL = ("SELECT p.*, (SELECT COUNT(*) FROM product_accessories a WHERE a.product_id = p.id) "
                    "AS accessory_count, (SELECT COUNT(*) FROM assets x WHERE x.product_id = p.id AND x.sub_hire = 0) AS asset_count, "
                    "(SELECT COUNT(*) FROM assets x WHERE x.product_id = p.id AND x.sub_hire = 1 "
                    "AND (x.hire_to IS NULL OR x.hire_to >= date('now', 'localtime'))) AS sub_unit_count, "
                    "(SELECT COALESCE(SUM(quantity), 0) FROM quarantine q WHERE q.product_id = p.id "
                    "AND q.released_at IS NULL) AS quarantined, "
                    "(SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_id, "
                    "(SELECT v.name FROM vendors v WHERE v.id = p.vendor_id) AS vendor_name FROM products p")


@route("GET", "/api/products")
def api_products(req, conn):
    """Stock list. Cable lengths come nested under their cable; ?flat=1 lists every bookable item instead."""
    include_archived = req.q("archived") == "1"
    where = [] if include_archived else ["p.archived = 0"]
    order = " ORDER BY p.category COLLATE NOCASE, p.subcategory COLLATE NOCASE, p.name COLLATE NOCASE, p.length_m"
    if req.q("flat") == "1":
        where.append("NOT (p.item_type = 'cable' AND p.parent_id IS NULL)")
        return rows(conn.execute(PRODUCT_LIST_SQL + (" WHERE " + " AND ".join(where) if where else "") + order))
    top = rows(conn.execute(PRODUCT_LIST_SQL + " WHERE " + " AND ".join(where + ["p.parent_id IS NULL"]) + order))
    kids = {}
    for v in rows(conn.execute(PRODUCT_LIST_SQL + " WHERE " + " AND ".join(where + ["p.parent_id IS NOT NULL"])
                               + " ORDER BY p.length_m")):
        kids.setdefault(v["parent_id"], []).append(v)
    for p in top:
        if p["item_type"] == "cable":
            p["lengths"] = kids.get(p["id"], [])
            p["quarantined"] = sum(v["quarantined"] for v in p["lengths"])
        elif p["item_type"] == "package":
            p["contents"] = rows(conn.execute("SELECT c.quantity, pr.name FROM package_items c JOIN products pr ON pr.id = c.product_id "
                                              "WHERE c.package_id = ? ORDER BY c.sort, c.id", (p["id"],)))
    return top


def check_deck(data):
    w, d = data.get("deck_w"), data.get("deck_d")
    if (w and not d) or (d and not w):
        raise ApiError(400, "A stage deck needs both a width and a depth")
    if (w is not None and w < 0) or (d is not None and d < 0):
        raise ApiError(400, "Deck sizes can't be negative")
    if w and d and (w > 10 or d > 10):
        raise ApiError(400, "Deck sizes are in metres — e.g. 2 × 1")
    sl = data.get("skirt_len")
    if sl is not None and (sl < 0 or sl > 20):
        raise ApiError(400, "Skirt length is in metres — e.g. 2")
    sh = data.get("skirt_height")
    if sh is not None and (sh < 0 or sh > 500):
        raise ApiError(400, "Skirt height is in centimetres — e.g. 40")


def check_product_links(conn, data, pid=None):
    if data.get("vendor_id") and not conn.execute("SELECT 1 FROM vendors WHERE id = ?", (data["vendor_id"],)).fetchone():
        raise ApiError(400, "That vendor doesn't exist")
    j = data.get("joiner_product_id")
    if j:
        if pid is not None and int(j) == int(pid):
            raise ApiError(400, "A cable can't be its own joiner")
        if not conn.execute("SELECT 1 FROM products WHERE id = ?", (j,)).fetchone():
            raise ApiError(400, "Joiner item not found")
    cf = data.get("case_for_id")
    if cf:
        if pid is not None and int(cf) == int(pid):
            raise ApiError(400, "A flight case can't be linked to itself")
        t = conn.execute("SELECT item_type FROM products WHERE id = ?", (cf,)).fetchone()
        if not t:
            raise ApiError(400, "The item this case is for wasn't found")
        if t[0] in ("case", "package"):
            raise ApiError(400, "Link a flight case to the item it carries, not to another case or a package")
    if data.get("length_m") is not None and data["length_m"] < 0:
        raise ApiError(400, "Length can't be negative")


def mains_volts(conn):
    try:
        return float(get_settings(conn).get("mains_voltage") or 230) or 230
    except ValueError:
        return 230.0


def apply_power_input(conn, body, data):
    """Accept power draw as watts or amps; store watts."""
    if body.get("power_amps") not in (None, "") and body.get("power_watts") in (None, ""):
        data["power_watts"] = round(as_float(body["power_amps"], "power_amps") * mains_volts(conn), 1)


def tidy_for_type(data, item_type, kind=None):
    for k, v in TYPE_RESET.items():
        if k not in TYPE_FIELDS[item_type]:
            data[k] = v
    if item_type == "equipment":
        kind = data.get("equip_kind") or kind or guess_kind({k: data.get(k) or "" if k in ("name", "category") else data.get(k)
                                                            for k in ("name", "category", "deck_w", "skirt_len", "plugs_in", "power_watts")})
        if kind not in EQUIP_KINDS:
            raise ApiError(400, "Choose what kind of item this is")
        data["equip_kind"] = kind
        for k in KIND_FIELDS - EQUIP_KINDS[kind][2]:  # e.g. a stage deck has no power draw
            data[k] = TYPE_RESET[k]
    if item_type == "cable" and not data.get("power_cable"):
        for k in POWER_CABLE_FIELDS:
            data[k] = TYPE_RESET[k]
    if item_type == "equipment" and data.get("power_watts") and "plugs_in" not in data:
        data["plugs_in"] = 1
    if item_type == "cable":
        data.pop("length_m", None)  # lengths live on the cable's length rows


def sync_case_link(conn, case_id, old_for=None):
    """A flight case made for an item goes with it: it's that item's (free) linked accessory, one case per item."""
    p = one(conn.execute("SELECT item_type, case_for_id FROM products WHERE id = ?", (case_id,)))
    new_for = p and p["item_type"] == "case" and p["case_for_id"]
    if old_for and old_for != new_for:
        conn.execute("DELETE FROM product_accessories WHERE product_id = ? AND accessory_id = ?", (old_for, case_id))
    if new_for and not links_reach(conn, case_id, new_for):
        conn.execute(
            """INSERT INTO product_accessories (product_id, accessory_id, quantity, charged, sort)
               VALUES (?, ?, 1, 0, (SELECT COALESCE(MAX(sort), 0) + 1 FROM product_accessories WHERE product_id = ?))
               ON CONFLICT (product_id, accessory_id) DO NOTHING""", (new_for, case_id, new_for))


def sync_cable(conn, parent_id):
    """Keep a cable's lengths named and configured like their cable, and the total quantity right."""
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (parent_id,)))
    if not p:
        return
    for v in rows(conn.execute("SELECT id, length_m FROM products WHERE parent_id = ?", (parent_id,))):
        conn.execute("UPDATE products SET subcategory = ? WHERE id = ?", (p["subcategory"], v["id"]))
        conn.execute("UPDATE products SET name = ?, category = ?, cable_type = ?, joiner_product_id = ?, "
                     "item_type = 'cable', power_cable = ?, sockets = ?, socket_type = ?, power_rating_a = ?, "
                     "plug_type = ?, archived = CASE WHEN ? = 1 THEN 1 ELSE archived END WHERE id = ?",
                     (f"{p['name']} {fmt_num(v['length_m'])}m", p["category"], p["cable_type"] or p["name"],
                      p["joiner_product_id"], p["power_cable"], p["sockets"], p["socket_type"],
                      p["power_rating_a"], p["plug_type"], p["archived"], v["id"]))
    total = conn.execute("SELECT COALESCE(SUM(quantity), 0) FROM products WHERE parent_id = ? AND archived = 0",
                         (parent_id,)).fetchone()[0]
    conn.execute("UPDATE products SET quantity = ?, length_m = NULL WHERE id = ?", (total, parent_id))


@route("POST", "/api/products")
def api_products_post(req, conn):
    body = req.json() or {}
    data = clean(body, PRODUCT_SPEC)
    data.setdefault("item_type", "equipment")
    apply_power_input(conn, body, data)
    tidy_for_type(data, data["item_type"])
    check_product_links(conn, data)
    check_deck(data)
    check_stand(data)
    check_size(data)
    if data["item_type"] == "cable":
        data["quantity"] = 0
        data["cable_type"] = data.get("cable_type") or data["name"]
    if data.get("sku") and barcode_in_use(conn, data["sku"]):
        raise ApiError(400, f"Code {data['sku']} is already {barcode_owner(conn, data['sku'])}")
    pid = insert(conn, "products", data)
    sync_case_link(conn, pid)
    conn.commit()
    return one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))


@route("POST", r"/api/products/(\d+)/lengths")
def api_lengths_post(req, conn, pid):
    pid = int(pid)
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not p or p["item_type"] != "cable" or p["parent_id"]:
        raise ApiError(404, "Cable not found")
    d = req.json() or {}
    length = as_float(d.get("length_m"), "length_m")
    if length <= 0:
        raise ApiError(400, "Enter the length in metres")
    qty = as_int(d.get("quantity") or 0, "quantity")
    existing = one(conn.execute("SELECT id FROM products WHERE parent_id = ? AND ABS(length_m - ?) < 0.001",
                                (pid, length)))
    if existing and qty and conn.execute("SELECT 1 FROM assets WHERE product_id = ? AND sub_hire = 0",
                                         (existing["id"],)).fetchone():
        raise ApiError(400, f"The {fmt_num(length)}m cables have barcodes — scan in or add barcodes to add more")
    if existing:
        conn.execute("UPDATE products SET quantity = quantity + ?, archived = 0 WHERE id = ?", (qty, existing["id"]))
    else:
        insert(conn, "products", {
            "name": f"{p['name']} {fmt_num(length)}m", "category": p["category"], "item_type": "cable",
            "parent_id": pid, "length_m": length, "quantity": qty,
            "sku": as_str(d.get("sku"), "sku") or (f"{p['sku']}-{fmt_num(length)}M" if p["sku"] else ""),
            "day_rate": p["day_rate"] if d.get("day_rate") in (None, "") else as_float(d["day_rate"], "day_rate"),
            "replacement_value": p["replacement_value"] if d.get("replacement_value") in (None, "")
            else as_float(d["replacement_value"], "replacement_value"),
            "weight_kg": as_float(d.get("weight_kg") or 0, "weight_kg"),
            "cable_type": p["cable_type"], "joiner_product_id": p["joiner_product_id"]})
    sync_cable(conn, pid)  # copies power-cable details to the new length
    conn.commit()
    return api_product(req, conn, pid)


# ---- return on investment and day-rate help

EARNED_STATUSES = ("confirmed", "out", "returned", "invoiced")  # firm hires that earn money


def category_rate_benchmark(conn, category, skip_id=None):
    """Day rate as a share of purchase price across your own stock: the same category first, else everything."""
    def ratios(where, params):
        return sorted(r[0] / r[1] for r in conn.execute(
            "SELECT day_rate, replacement_value FROM products WHERE archived = 0 AND sub_hire = 0 AND day_rate > 0 "
            "AND replacement_value > 0 AND item_type IN ('equipment', 'power', 'case') AND id != ? " + where,
            [skip_id or 0] + params))

    def median(v):
        n = len(v)
        return (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2) if n else None
    same = ratios("AND category = ? COLLATE NOCASE", [category]) if category else []
    if len(same) >= 2:
        return {"scope": "category", "category": category, "count": len(same), "ratio": round(median(same), 5)}
    every = ratios("", [])
    if every:
        return {"scope": "all", "category": category or "", "count": len(every), "ratio": round(median(every), 5)}
    return None


def hire_history(conn, pid):
    """What an item has earned and how often it's been out, from firm jobs (confirmed, on hire, returned, invoiced)."""
    today = dt.date.today()
    year_ago = today - dt.timedelta(days=365)
    marks = ",".join("?" * len(EARNED_STATUSES))
    jobs = rows(conn.execute(f"SELECT * FROM jobs WHERE status IN ({marks}) AND id IN "
                             "(SELECT job_id FROM job_items WHERE product_id = ? AND kind = 'rental') ORDER BY start_date",
                             list(EARNED_STATUSES) + [pid]))
    out = {k: {"revenue": 0.0, "unit_days": 0.0, "list_value": 0.0, "jobs": 0} for k in ("all", "year", "ahead")}
    out["first_hire"] = None
    items = load_items(conn, [j["id"] for j in jobs])
    for j in jobs:
        lines = [it for it in price_items(j, items[j["id"]]) if it["product_id"] == pid and it["kind"] == "rental"]
        if not lines:
            continue
        start, end = parse_date(j["start_date"]), parse_date(j["end_date"])
        job_disc = 1 - (j.get("discount_pct") or 0) / 100.0
        # The part of the hire inside the last 12 months counts towards "this year".
        days_total = (end - start).days + 1
        days_year = max(0, (min(end, today) - max(start, year_ago)).days + 1) if end >= year_ago and start <= today else 0
        if start > today:  # firm, but not started: booked ahead, not earned yet
            parts = (("ahead", 1.0),)
        else:
            out["first_hire"] = out["first_hire"] or j["start_date"]
            parts = (("all", 1.0), ("year", days_year / days_total if days_total else 0))
        for key, share in parts:
            if share <= 0:
                continue
            b = out[key]
            b["jobs"] += 1
            for it in lines:
                qty = it["quantity"] or 0
                b["unit_days"] += qty * days_total * share
                b["revenue"] += it["line_total"] * job_disc * share
                b["list_value"] += qty * (it["unit_price"] or 0) * it["effective_days"] * share
    # The "last 12 months" window is shorter for kit first hired less than a year ago.
    out["window_days"] = min(365, max(30, (today - parse_date(out["first_hire"])).days + 1)) if out["first_hire"] else 365
    for b in (out["all"], out["year"], out["ahead"]):
        # How much less than the list price was charged, on average (line and job discounts, free days).
        b["avg_discount_pct"] = round(100 * (1 - b["revenue"] / b["list_value"]), 1) if b["list_value"] > 0 else None
        for k in ("revenue", "unit_days", "list_value"):
            b[k] = round(b[k], 2)
    return out


@route("GET", r"/api/products/(\d+)/roi")
def api_product_roi(req, conn, pid):
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not p:
        raise ApiError(404, "Product not found")
    return {"product": {k: p[k] for k in ("id", "name", "brand", "category", "item_type", "quantity", "day_rate",
                                          "replacement_value", "sub_hire")},
            "history": hire_history(conn, int(pid)),
            "benchmark": category_rate_benchmark(conn, p["category"], int(pid))}


@route("GET", "/api/roi/benchmark")
def api_roi_benchmark(req, conn):
    """For the ROI calculator before you buy: what your stock in a category charges per day."""
    return {"benchmark": category_rate_benchmark(conn, (req.q("category") or "").strip())}


@route("GET", r"/api/products/(\d+)")
def api_product(req, conn, pid):
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not p:
        raise ApiError(404, "Product not found")
    today = dt.date.today().isoformat()
    p["bookings"] = rows(conn.execute(
        """SELECT j.id, j.number, j.name, j.start_date, j.end_date, j.status,
                  SUM(ji.quantity) AS quantity
           FROM job_items ji JOIN jobs j ON j.id = ji.job_id
           WHERE ji.product_id = ? AND ji.kind = 'rental' AND j.end_date >= ?
             AND j.status NOT IN ('cancelled', 'lost')
           GROUP BY j.id ORDER BY j.start_date""", (pid, today)))
    p["accessories"] = rows(conn.execute(
        """SELECT a.*, p.name, p.category, p.sku, p.day_rate, p.quantity AS owned, p.archived
           FROM product_accessories a JOIN products p ON p.id = a.accessory_id
           WHERE a.product_id = ? ORDER BY a.sort, a.id""", (pid,)))
    for a in p["accessories"]:
        a["includes"] = accessory_tree(conn, a["accessory_id"], {int(pid)})
    p["accessory_of"] = rows(conn.execute(
        """SELECT a.id, a.quantity, p.id AS product_id, p.name
           FROM product_accessories a JOIN products p ON p.id = a.product_id
           WHERE a.accessory_id = ? ORDER BY p.name""", (pid,)))
    p["assets"] = rows(conn.execute(
        """SELECT x.*, q.id AS quarantine_id, q.reason AS quarantine_reason, q.started_at AS quarantined_at
           FROM assets x LEFT JOIN quarantine q ON q.asset_id = x.id AND q.released_at IS NULL
           WHERE x.product_id = ? AND x.sub_hire = 0 ORDER BY x.asset_number""", (pid,)))
    today = dt.date.today().isoformat()
    p["sub_units"] = rows(conn.execute(
        """SELECT x.*, v.name AS vendor_name, q.id AS quarantine_id, q.reason AS quarantine_reason
           FROM assets x LEFT JOIN vendors v ON v.id = x.vendor_id
           LEFT JOIN quarantine q ON q.asset_id = x.id AND q.released_at IS NULL
           WHERE x.product_id = ? AND x.sub_hire = 1
           ORDER BY (x.hire_to IS NOT NULL AND x.hire_to < ?), COALESCE(x.hire_from, ''), x.asset_number""", (pid, today)))
    for u in p["sub_units"]:
        u["state"] = ("ended" if u["hire_to"] and u["hire_to"] < today else
                      "upcoming" if u["hire_from"] and u["hire_from"] > today else "here")
    p["quarantine"] = rows(conn.execute(
        """SELECT q.*, x.asset_number FROM quarantine q LEFT JOIN assets x ON x.id = q.asset_id
           WHERE q.product_id = ? AND q.released_at IS NULL ORDER BY q.started_at""", (pid,)))
    p["quarantined"] = sum(q["quantity"] for q in p["quarantine"])
    p["usable"] = p["quantity"] - p["quarantined"]
    p["images"] = rows(conn.execute("SELECT id, sort FROM product_images WHERE product_id = ? ORDER BY sort, id", (pid,)))
    if p["item_type"] == "package":
        p["components"] = package_components(conn, int(pid))
    p["alternatives"] = rows(conn.execute(
        "SELECT a.id, a.alt_id, p.name, p.sku, p.quantity, p.day_rate, p.archived, "
        "(SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_id "
        "FROM product_alternatives a JOIN products p ON p.id = a.alt_id WHERE a.product_id = ? ORDER BY a.sort, a.id", (pid,)))
    p["vendor"] = one(conn.execute("SELECT id, name, phone, email FROM vendors WHERE id = ?", (p["vendor_id"],))) \
        if p.get("vendor_id") else None
    p["volts"] = mains_volts(conn)
    if p["item_type"] == "cable" and not p["parent_id"]:
        today = dt.date.today().isoformat()
        avail = {a["product_id"]: a for a in availability_summary(conn, today, today)}
        p["lengths"] = rows(conn.execute(PRODUCT_LIST_SQL + " WHERE p.parent_id = ? ORDER BY p.archived, p.length_m",
                                         (p["id"],)))
        units = {}
        for u in rows(conn.execute(
                """SELECT x.id, x.product_id, x.asset_number, x.serial_number, q.id AS quarantine_id, q.reason AS quarantine_reason
                   FROM assets x JOIN products pr ON pr.id = x.product_id
                   LEFT JOIN quarantine q ON q.asset_id = x.id AND q.released_at IS NULL
                   WHERE pr.parent_id = ? AND x.sub_hire = 0 ORDER BY x.asset_number""", (p["id"],))):
            units.setdefault(u["product_id"], []).append(u)
        for v in p["lengths"]:
            v["free_today"] = avail.get(v["id"], {}).get("available")
            v["units"] = units.get(v["id"], [])
        ids = [v["id"] for v in p["lengths"]] or [0]
        marks = ",".join("?" for _ in ids)
        p["bookings"] = rows(conn.execute(
            f"""SELECT j.id, j.number, j.name, j.start_date, j.end_date, j.status, SUM(ji.quantity) AS quantity,
                       GROUP_CONCAT(ji.description, ', ') AS lines
                FROM job_items ji JOIN jobs j ON j.id = ji.job_id
                WHERE ji.product_id IN ({marks}) AND ji.kind = 'rental' AND j.end_date >= ?
                  AND j.status NOT IN ('cancelled', 'lost')
                GROUP BY j.id ORDER BY j.start_date""", ids + [today]))
        p["quarantine"] = rows(conn.execute(
            f"""SELECT q.*, pr.length_m FROM quarantine q JOIN products pr ON pr.id = q.product_id
                WHERE q.product_id IN ({marks}) AND q.released_at IS NULL ORDER BY q.started_at""", ids))
    if p.get("joiner_product_id"):
        p["joiner"] = one(conn.execute("SELECT id, name, length_m, cable_type FROM products WHERE id = ?",
                                       (p["joiner_product_id"],)))
    return p


# ---- packages (a set of stock items added together, with the linked items you don't need taken out)

def package_tree(conn, pid, seen, excluded, depth=0):
    """A component's linked items, all the way down, marked with whether this package leaves them out."""
    if depth >= MAX_LINK_DEPTH:
        return []
    out = []
    for r in conn.execute("""SELECT a.quantity, p.id, p.name FROM product_accessories a
                             JOIN products p ON p.id = a.accessory_id WHERE a.product_id = ? AND p.archived = 0
                             ORDER BY a.sort, a.id""", (pid,)):
        if r["id"] in seen:
            continue
        out.append({"product_id": r["id"], "name": r["name"], "quantity": r["quantity"], "excluded": r["id"] in excluded,
                    "includes": package_tree(conn, r["id"], seen | {r["id"]}, excluded, depth + 1)})
    return out


def package_components(conn, pkg_id):
    comps = rows(conn.execute(
        "SELECT c.id, c.product_id, c.quantity, p.name, p.sku, p.day_rate, p.archived, p.item_type, "
        "(SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_id "
        "FROM package_items c JOIN products p ON p.id = c.product_id WHERE c.package_id = ? ORDER BY c.sort, c.id", (pkg_id,)))
    for c in comps:
        ex = {r[0] for r in conn.execute("SELECT product_id FROM package_excludes WHERE package_item_id = ?", (c["id"],))}
        c["excluded_ids"] = sorted(ex)
        c["tree"] = package_tree(conn, c["product_id"], {c["product_id"]}, ex)
    return comps


@route("POST", r"/api/products/(\d+)/components")
def api_components_post(req, conn, pid):
    pkg = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not pkg or pkg["item_type"] != "package":
        raise ApiError(404, "Package not found")
    d = req.json() or {}
    item = as_int(d.get("product_id"), "product_id")
    qty = as_float(d.get("quantity") or 1, "quantity")
    p = one(conn.execute("SELECT item_type, parent_id FROM products WHERE id = ?", (item,)))
    if not p:
        raise ApiError(404, "Item not found")
    if p["item_type"] == "package":
        raise ApiError(400, "A package can't contain another package")
    if p["item_type"] == "cable" and not p["parent_id"]:
        raise ApiError(400, "Choose a length of that cable")
    if qty <= 0:
        raise ApiError(400, "Quantity must be more than 0")
    existing = one(conn.execute("SELECT id FROM package_items WHERE package_id = ? AND product_id = ?", (pid, item)))
    if existing:
        conn.execute("UPDATE package_items SET quantity = quantity + ? WHERE id = ?", (qty, existing["id"]))
    else:
        sort = (conn.execute("SELECT COALESCE(MAX(sort), 0) FROM package_items WHERE package_id = ?", (pid,)).fetchone()[0] or 0) + 1
        insert(conn, "package_items", {"package_id": int(pid), "product_id": item, "quantity": qty, "sort": sort})
    conn.commit()
    return api_product(req, conn, pid)


@route("PUT", r"/api/components/(\d+)")
def api_component_put(req, conn, cid):
    c = one(conn.execute("SELECT * FROM package_items WHERE id = ?", (cid,)))
    if not c:
        raise ApiError(404, "Not found")
    d = req.json() or {}
    if "quantity" in d:
        q = as_float(d["quantity"], "quantity")
        if q <= 0:
            raise ApiError(400, "Quantity must be more than 0")
        conn.execute("UPDATE package_items SET quantity = ? WHERE id = ?", (q, cid))
    if "exclude" in d:  # {"exclude": product_id, "excluded": true/false} - take a linked item out of (or back into) the package
        ex = as_int(d["exclude"], "exclude")
        if d.get("excluded", True):
            conn.execute("INSERT OR IGNORE INTO package_excludes(package_item_id, product_id) VALUES(?, ?)", (cid, ex))
        else:
            conn.execute("DELETE FROM package_excludes WHERE package_item_id = ? AND product_id = ?", (cid, ex))
    conn.commit()
    return api_product(req, conn, c["package_id"])


@route("DELETE", r"/api/components/(\d+)")
def api_component_delete(req, conn, cid):
    c = one(conn.execute("SELECT * FROM package_items WHERE id = ?", (cid,)))
    if not c:
        raise ApiError(404, "Not found")
    conn.execute("DELETE FROM package_items WHERE id = ?", (cid,))
    conn.commit()
    return api_product(req, conn, c["package_id"])


def add_package(conn, line_id):
    """Put a package's contents under its job line: each item, plus its linked items minus the ones the package leaves out."""
    line = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (line_id,)))
    priced = (line["unit_price"] or 0) > 0  # a package price covers everything inside it
    for c in package_components(conn, line["product_id"]):
        if c["archived"]:
            continue
        child = insert(conn, "job_items", {
            "job_id": line["job_id"], "product_id": c["product_id"], "kind": "rental", "description": c["name"],
            "quantity": linked_qty(line["quantity"], c["quantity"]), "accessory_qty": c["quantity"],
            "unit_price": 0 if priced else c["day_rate"], "days": line["days"], "sort": line["sort"],
            "parent_item_id": line_id, "section_id": line["section_id"], "meta": json.dumps({"role": "package"})})
        add_accessories(conn, child, skip=set(c["excluded_ids"]), free=priced)


# ---- room planner (one plan per job, with one or more rooms)

PLAN_MAX_BYTES = 2 * 1024 * 1024


@route("GET", r"/api/jobs/(\d+)/plan")
def api_plan(req, conn, jid):
    r = one(conn.execute("SELECT data, updated_at, updated_by FROM room_plans WHERE job_id = ?", (jid,)))
    items = rows(conn.execute(
        "SELECT ji.product_id, SUM(ji.quantity) AS quantity, p.name, p.category, p.item_type, p.equip_kind, p.size_w, p.size_d, p.size_h, "
        "p.plan_shape, p.deck_w, p.deck_d, p.stand_h, p.stand_h_max FROM job_items ji JOIN products p ON p.id = ji.product_id "
        "WHERE ji.job_id = ? AND ji.kind = 'rental' AND p.item_type IN ('equipment', 'power') GROUP BY ji.product_id ORDER BY p.category, p.name", (jid,)))
    stages = [dict(id=x["id"], description=x["description"], quantity=x["quantity"], **json.loads(x["meta"]))
              for x in rows(conn.execute("SELECT id, description, quantity, meta FROM job_items WHERE job_id = ? AND meta LIKE '%\"type\": \"stage\"%'", (jid,)))]
    return {"plan": json.loads(r["data"]) if r else None, "updated_at": r and r["updated_at"], "updated_by": r and r["updated_by"],
            "items": items, "stages": [{k: st.get(k) for k in ("id", "description", "quantity", "width", "depth", "height")} for st in stages]}


@route("PUT", r"/api/jobs/(\d+)/plan")
def api_plan_put(req, conn, jid):
    if not conn.execute("SELECT 1 FROM jobs WHERE id = ?", (jid,)).fetchone():
        raise ApiError(404, "Job not found")
    if len(req.body or b"") > PLAN_MAX_BYTES:
        raise ApiError(413, "That plan is too big")
    d = req.json() or {}
    plan = d.get("plan")
    if not isinstance(plan, dict) or not isinstance(plan.get("rooms"), list):
        raise ApiError(400, "That isn't a room plan")
    for room in plan["rooms"]:
        if not isinstance(room, dict) or not isinstance(room.get("objects", []), list):
            raise ApiError(400, "That isn't a room plan")
        for k in ("w", "d"):
            v = room.get(k)
            if not isinstance(v, (int, float)) or not 1 <= v <= 500:
                raise ApiError(400, "Room sizes are in metres, between 1 and 500")
        if len(room.get("objects", [])) > 2000:
            raise ApiError(400, "That's a lot of things in one room - split it into more rooms")
    conn.execute("INSERT INTO room_plans(job_id, data, updated_at, updated_by) VALUES(?, ?, ?, ?) "
                 "ON CONFLICT(job_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
                 (int(jid), json.dumps(plan), now_iso(), actor_name()))
    conn.commit()
    return {"ok": True, "updated_at": now_iso()}


# ---- suitable alternatives (offered when something's short on a job - never swapped without asking)

@route("POST", r"/api/products/(\d+)/alternatives")
def api_alternatives_post(req, conn, pid):
    pid = int(pid)
    d = req.json() or {}
    alt = as_int(d.get("alt_id"), "alt_id")
    if alt == pid:
        raise ApiError(400, "An item can't be its own alternative")
    for x in (pid, alt):
        if not conn.execute("SELECT 1 FROM products WHERE id = ?", (x,)).fetchone():
            raise ApiError(404, "Item not found")
    pairs = [(pid, alt)] + ([(alt, pid)] if d.get("both", True) else [])
    for a, b in pairs:
        sort = (conn.execute("SELECT COALESCE(MAX(sort), 0) FROM product_alternatives WHERE product_id = ?", (a,)).fetchone()[0] or 0) + 1
        conn.execute("INSERT OR IGNORE INTO product_alternatives(product_id, alt_id, sort) VALUES(?, ?, ?)", (a, b, sort))
    conn.commit()
    return api_product(req, conn, pid)


@route("DELETE", r"/api/alternatives/(\d+)")
def api_alternative_delete(req, conn, aid):
    a = one(conn.execute("SELECT * FROM product_alternatives WHERE id = ?", (aid,)))
    if not a:
        raise ApiError(404, "Not found")
    conn.execute("DELETE FROM product_alternatives WHERE id = ?", (aid,))
    conn.commit()
    return api_product(req, conn, a["product_id"])


def alternatives_for(conn, job, product_id):
    """Alternatives for one item, with how many are free on this job's dates (after what the job already has)."""
    alts = rows(conn.execute(
        "SELECT p.id AS product_id, p.name, p.sku, p.day_rate, p.sub_hire, "
        "(SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_id "
        "FROM product_alternatives a JOIN products p ON p.id = a.alt_id WHERE a.product_id = ? AND p.archived = 0 "
        "ORDER BY a.sort, a.id", (product_id,)))
    if not alts:
        return []
    free = {a["product_id"]: a["available"] for a in
            availability_summary(conn, job["start_date"], job["end_date"], exclude_job=job["id"])}
    on_job = {}
    for r in conn.execute("SELECT product_id, SUM(quantity) FROM job_items WHERE job_id = ? AND kind = 'rental' "
                          "AND product_id IS NOT NULL GROUP BY product_id", (job["id"],)):
        on_job[r[0]] = r[1] or 0
    for a in alts:
        a["free"] = SUB_HIRE_UNLIMITED if a["sub_hire"] else max(0, (free.get(a["product_id"], 0) or 0) - on_job.get(a["product_id"], 0))
    return alts


def line_context(conn, it):
    """Where a line sits: on its own, linked to another item, or inside a package. Also whether it can be swapped
    (lines a stage or cable run builds for itself are changed on the stage / run instead)."""
    if not it["parent_item_id"]:
        return {"kind": "line", "parent": None, "swappable": True}
    parent = one(conn.execute("SELECT id, description, product_id, meta, unit_price FROM job_items WHERE id = ?",
                              (it["parent_item_id"],)))
    pm = jload(parent["meta"]) if parent else {}
    role = (jload(it["meta"]) or {}).get("role")
    if (pm or {}).get("type") in ("stage", "cable_run") or (role and role != "package"):
        return {"kind": "built", "parent": parent and parent["description"], "swappable": False}
    # the package this line is in, if any (it may be a linked item of something in a package)
    pkg, cur = None, it
    while cur and cur["parent_item_id"]:
        if (jload(cur["meta"]) or {}).get("role") == "package":
            pkg = one(conn.execute("SELECT id, description, unit_price FROM job_items WHERE id = ?", (cur["parent_item_id"],)))
            break
        cur = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (cur["parent_item_id"],)))
    return {"kind": "package" if role == "package" else "linked", "parent": parent["description"],
            "package": pkg and pkg["description"], "priced_package": bool(pkg and (pkg["unit_price"] or 0) > 0),
            "swappable": True}


def jload(txt):
    try:
        return json.loads(txt) if txt else {}
    except (TypeError, ValueError):
        return {}


@route("GET", r"/api/items/(\d+)/alternatives")
def api_item_alternatives(req, conn, iid):
    it = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (iid,)))
    if not it or not it["product_id"]:
        raise ApiError(404, "Line not found")
    job = job_detail(conn, it["job_id"])
    av = job["availability"].get(it["product_id"]) or {}
    ctx = line_context(conn, it)
    p = one(conn.execute("SELECT sub_hire, item_type, vendor_id, sub_hire_cost FROM products WHERE id = ?", (it["product_id"],)))
    sub = {"can": bool(p) and not p["sub_hire"] and p["item_type"] != "package" and it["kind"] == "rental",
           "current": it["sub_qty"] or 0, "vendor_id": it["sub_vendor_id"] or (p and p["vendor_id"]),
           "cost": it["sub_cost"] if it["sub_cost"] is not None else (p and p["sub_hire_cost"]) or 0}
    return {"item": {"id": it["id"], "description": it["description"], "quantity": it["quantity"], "product_id": it["product_id"]},
            "sub": sub,
            "context": {k: v for k, v in ctx.items() if k != "priced_package"},
            "short": av.get("shortage", 0), "provisional_short": av.get("provisional_shortage", 0),
            "alternatives": alternatives_for(conn, job, it["product_id"]) if ctx["swappable"] else []}


@route("POST", r"/api/items/(\d+)/swap")
def api_item_swap(req, conn, iid):
    """Move some (or all) of a line to an alternative item. Only ever called after the user has confirmed."""
    it = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (iid,)))
    if not it or not it["product_id"]:
        raise ApiError(404, "Line not found")
    d = req.json() or {}
    alt = as_int(d.get("product_id"), "product_id")
    qty = as_float(d.get("quantity"), "quantity")
    if not conn.execute("SELECT 1 FROM product_alternatives WHERE product_id = ? AND alt_id = ?", (it["product_id"], alt)).fetchone():
        raise ApiError(400, "That isn't listed as an alternative for this item")
    if qty <= 0 or qty > (it["quantity"] or 0):
        raise ApiError(400, f"Choose between 1 and {fmt_num(it['quantity'])} to swap")
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (alt,)))
    left = (it["quantity"] or 0) - qty
    if it["parent_item_id"]:
        swap_child_line(conn, it, p, qty, left)
    elif left <= 0:
        for kid in [it["id"]] + descendants(conn, it["id"]):
            conn.execute("DELETE FROM job_items WHERE id = ?", (kid,))
    else:
        conn.execute("UPDATE job_items SET quantity = ? WHERE id = ?", (left, it["id"]))
        sync_accessories(conn, it["id"])
    if not it["parent_item_id"]:
        existing = one(conn.execute(
            "SELECT * FROM job_items WHERE job_id = ? AND product_id = ? AND kind = 'rental' AND parent_item_id IS NULL "
            "AND section_id IS ? AND (meta IS NULL OR meta = '') ORDER BY id LIMIT 1", (it["job_id"], alt, it["section_id"])))
        if existing:
            conn.execute("UPDATE job_items SET quantity = quantity + ? WHERE id = ?", (qty, existing["id"]))
            sync_accessories(conn, existing["id"])
        else:
            new_id = insert(conn, "job_items", {"job_id": it["job_id"], "product_id": alt, "kind": "rental",
                                                "description": p["name"], "quantity": qty, "unit_price": p["day_rate"],
                                                "days": it["days"], "sort": it["sort"], "section_id": it["section_id"]})
            add_accessories(conn, new_id)
    conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), it["job_id"]))
    conn.commit()
    out = job_detail(conn, it["job_id"])
    clamp_sub_hire(conn, it["job_id"])
    conn.commit()
    out = job_detail(conn, it["job_id"])
    out["swapped"] = {"from": it["description"], "to": p["name"], "quantity": qty}
    return out


def swap_child_line(conn, it, p, qty, left):
    """Swap a linked / package line. The new item stays under the same parent, so it keeps following the parent's
    quantity (2 racks -> 2 x the swapped PSU). Charging follows the old line: included stays included."""
    ctx = line_context(conn, it)
    if not ctx["swappable"]:
        raise ApiError(400, f"This is set on {ctx['parent'] or 'its stage'} - change it there")
    parent = one(conn.execute("SELECT quantity FROM job_items WHERE id = ?", (it["parent_item_id"],)))
    pq = (parent and parent["quantity"]) or 0
    price = 0 if not (it["unit_price"] or 0) else p["day_rate"]
    free = ctx["priced_package"] or not (it["unit_price"] or 0)
    if left <= 0:
        # replace the line in place: same parent and ratio, new item and its own linked items
        for kid in descendants(conn, it["id"]):
            conn.execute("DELETE FROM job_items WHERE id = ?", (kid,))
        conn.execute("UPDATE job_items SET product_id = ?, description = ?, unit_price = ? WHERE id = ?",
                     (p["id"], p["name"], price, it["id"]))
        target = it["id"]
        twin = one(conn.execute(
            "SELECT * FROM job_items WHERE parent_item_id = ? AND product_id = ? AND id != ? AND meta IS ? ORDER BY id LIMIT 1",
            (it["parent_item_id"], p["id"], it["id"], it["meta"])))
        if twin:  # already one of these under the parent - fold together
            conn.execute("UPDATE job_items SET quantity = quantity + ?, accessory_qty = COALESCE(accessory_qty, 0) + ? WHERE id = ?",
                         (it["quantity"], it["accessory_qty"] or 0, twin["id"]))
            conn.execute("DELETE FROM job_items WHERE id = ?", (it["id"],))
            sync_accessories(conn, twin["id"])
            return
        add_accessories(conn, target, free=free)
        return
    ratio_left = left / pq if pq else None
    ratio_new = qty / pq if pq else None
    conn.execute("UPDATE job_items SET quantity = ?, accessory_qty = ? WHERE id = ?", (left, ratio_left, it["id"]))
    sync_accessories(conn, it["id"])
    twin = one(conn.execute(
        "SELECT * FROM job_items WHERE parent_item_id = ? AND product_id = ? AND meta IS ? ORDER BY id LIMIT 1",
        (it["parent_item_id"], p["id"], it["meta"])))
    if twin:
        conn.execute("UPDATE job_items SET quantity = quantity + ?, accessory_qty = COALESCE(accessory_qty, 0) + ? WHERE id = ?",
                     (qty, ratio_new or 0, twin["id"]))
        sync_accessories(conn, twin["id"])
        return
    new_id = insert(conn, "job_items", {
        "job_id": it["job_id"], "product_id": p["id"], "kind": "rental", "description": p["name"], "quantity": qty,
        "accessory_qty": ratio_new, "unit_price": price, "days": it["days"], "sort": it["sort"],
        "parent_item_id": it["parent_item_id"], "section_id": it["section_id"], "meta": it["meta"]})
    add_accessories(conn, new_id, free=free)


# ---- sub-hiring extra units of something you own (e.g. own 2 K12s, hire in 4 more)

@route("PUT", r"/api/items/(\d+)/subhire")
def api_item_subhire(req, conn, iid):
    it = one(conn.execute("SELECT ji.*, p.name AS pname, p.sub_hire AS psub, p.item_type AS ptype, p.vendor_id AS pvendor "
                          "FROM job_items ji LEFT JOIN products p ON p.id = ji.product_id WHERE ji.id = ?", (iid,)))
    if not it or not it["product_id"] or it["kind"] != "rental":
        raise ApiError(404, "Line not found")
    if it["psub"]:
        raise ApiError(400, "This item is always sub-hired already")
    if it["ptype"] == "package":
        raise ApiError(400, "Sub-hire the items inside the package instead")
    d = req.json() or {}
    qty = as_float(d.get("quantity", 0), "quantity")
    if qty < 0 or qty > (it["quantity"] or 0):
        raise ApiError(400, f"Sub-hire between 0 and {fmt_num(it['quantity'])}")
    if qty != int(qty):
        raise ApiError(400, "Sub-hire whole units")
    vendor = int_or_none(d.get("vendor_id"), "vendor_id") if d.get("vendor_id") not in (None, "") else it["pvendor"]
    vname = None
    if vendor:
        v = conn.execute("SELECT name FROM vendors WHERE id = ?", (vendor,)).fetchone()
        if not v:
            raise ApiError(400, "Vendor not found")
        vname = v[0]
    elif qty:
        raise ApiError(400, "Choose which vendor to sub-hire from")
    cost = d.get("cost")
    cost = None if cost in (None, "") else as_float(cost, "cost")
    if cost is not None and cost < 0:
        raise ApiError(400, "Cost can't be negative")
    if qty:
        conn.execute("UPDATE job_items SET sub_qty = ?, sub_vendor_id = ?, sub_cost = ? WHERE id = ?",
                     (qty, None if vendor == it["pvendor"] else vendor, cost, iid))
    else:
        conn.execute("UPDATE job_items SET sub_qty = 0, sub_vendor_id = NULL, sub_cost = NULL WHERE id = ?", (iid,))
    conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), it["job_id"]))
    conn.commit()
    out = job_detail(conn, it["job_id"])
    out["subhired"] = {"name": it["description"] or it["pname"], "quantity": qty, "own": (it["quantity"] or 0) - qty,
                       "vendor": vname, "product_id": it["product_id"]}
    return out


def clamp_sub_hire(conn, job_id):
    """A line can't sub-hire more than its quantity (after it's been reduced)."""
    conn.execute("UPDATE job_items SET sub_qty = quantity WHERE job_id = ? AND sub_qty > quantity", (job_id,))


# ---- vendors (who you sub-hire from)

VENDOR_SPEC = {"name": required(as_str), "contact_name": as_str, "email": as_str, "phone": as_str, "address": as_str,
               "website": as_str, "account_ref": as_str, "notes": as_str, "archived": bool_int}


@route("GET", "/api/vendors")
def api_vendors(req, conn):
    where = "" if req.q("archived") == "1" else " WHERE v.archived = 0"
    return rows(conn.execute(
        "SELECT v.*, (SELECT COUNT(*) FROM products p WHERE p.vendor_id = v.id AND p.archived = 0) AS item_count "
        "FROM vendors v" + where + " ORDER BY v.archived, v.name COLLATE NOCASE"))


@route("POST", "/api/vendors")
def api_vendors_post(req, conn):
    data = clean(req.json(), VENDOR_SPEC)
    data["created_at"] = now_iso()
    vid = insert(conn, "vendors", data)
    conn.commit()
    return one(conn.execute("SELECT * FROM vendors WHERE id = ?", (vid,)))


@route("GET", r"/api/vendors/(\d+)")
def api_vendor(req, conn, vid):
    v = one(conn.execute("SELECT * FROM vendors WHERE id = ?", (vid,)))
    if not v:
        raise ApiError(404, "Vendor not found")
    v["items"] = rows(conn.execute(PRODUCT_LIST_SQL + " WHERE p.vendor_id = ? ORDER BY p.archived, p.category, p.name",
                                   (vid,)))
    today = dt.date.today().isoformat()
    v["upcoming"] = rows(conn.execute(
        """SELECT j.id, j.number, j.name, j.start_date, j.end_date, j.status, p.name AS item,
                  SUM(CASE WHEN p.sub_hire = 1 THEN ji.quantity ELSE MIN(ji.sub_qty, ji.quantity) END) AS quantity
           FROM job_items ji JOIN jobs j ON j.id = ji.job_id JOIN products p ON p.id = ji.product_id
           WHERE ji.kind = 'rental' AND j.end_date >= ? AND j.status NOT IN ('cancelled', 'lost')
             AND ((p.sub_hire = 1 AND p.vendor_id = ?)
                  OR (p.sub_hire = 0 AND ji.sub_qty > 0 AND COALESCE(ji.sub_vendor_id, p.vendor_id) = ?))
           GROUP BY j.id, p.id ORDER BY j.start_date, p.name""", (today, int(vid), int(vid))))
    return v


@route("PUT", r"/api/vendors/(\d+)")
def api_vendor_put(req, conn, vid):
    if not conn.execute("SELECT 1 FROM vendors WHERE id = ?", (vid,)).fetchone():
        raise ApiError(404, "Vendor not found")
    update(conn, "vendors", vid, clean(req.json(), VENDOR_SPEC, partial=True))
    conn.commit()
    return api_vendor(req, conn, vid)


@route("DELETE", r"/api/vendors/(\d+)")
def api_vendor_delete(req, conn, vid):
    used = conn.execute("SELECT COUNT(*) FROM products WHERE vendor_id = ?", (vid,)).fetchone()[0]
    if used:
        conn.execute("UPDATE vendors SET archived = 1 WHERE id = ?", (vid,))
        conn.commit()
        return {"archived": True}
    conn.execute("DELETE FROM vendors WHERE id = ?", (vid,))
    conn.commit()
    return {"deleted": True}


# ---- stock images (kept in the database, so they're in every backup)

IMAGE_TYPES = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP"}


@route("POST", r"/api/products/(\d+)/images")
def api_images_post(req, conn, pid):
    if not conn.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone():
        raise ApiError(404, "Product not found")
    d = req.json() or {}
    ctype, raw = decode_data_url(d.get("data_url"), IMAGE_TYPES, "Image", 8)
    thumb = None
    if d.get("thumb_url"):
        _t, thumb = decode_data_url(d.get("thumb_url"), IMAGE_TYPES, "Thumbnail", 1)
    if conn.execute("SELECT COUNT(*) FROM product_images WHERE product_id = ?", (pid,)).fetchone()[0] >= 20:
        raise ApiError(400, "An item can have up to 20 images")
    sort = (conn.execute("SELECT COALESCE(MAX(sort), 0) FROM product_images WHERE product_id = ?", (pid,)).fetchone()[0] or 0) + 1
    insert(conn, "product_images", {"product_id": int(pid), "ctype": ctype, "data": raw, "thumb": thumb,
                                    "sort": sort, "created_at": now_iso()})
    conn.commit()
    return api_product(req, conn, pid)


@route("POST", r"/api/images/(\d+)/main")
def api_image_main(req, conn, iid):
    img = one(conn.execute("SELECT product_id FROM product_images WHERE id = ?", (iid,)))
    if not img:
        raise ApiError(404, "Image not found")
    low = conn.execute("SELECT COALESCE(MIN(sort), 0) FROM product_images WHERE product_id = ?", (img["product_id"],)).fetchone()[0]
    conn.execute("UPDATE product_images SET sort = ? WHERE id = ?", (low - 1, iid))
    conn.commit()
    return api_product(req, conn, img["product_id"])


@route("DELETE", r"/api/images/(\d+)")
def api_image_delete(req, conn, iid):
    img = one(conn.execute("SELECT product_id FROM product_images WHERE id = ?", (iid,)))
    if not img:
        raise ApiError(404, "Image not found")
    conn.execute("DELETE FROM product_images WHERE id = ?", (iid,))
    conn.commit()
    return api_product(req, conn, img["product_id"])


@route("GET", r"/img/(\d+)(/thumb)?")
def image_file(req, conn, iid, thumb):
    img = one(conn.execute("SELECT ctype, data, thumb FROM product_images WHERE id = ?", (iid,)))
    if not img:
        raise ApiError(404, "Image not found")
    data = img["thumb"] if thumb and img["thumb"] else img["data"]
    return Raw(data, img["ctype"] if not (thumb and img["thumb"]) else "image/jpeg")


# ---- assets & quarantine

def sync_asset_qty(conn, pid):
    n = conn.execute("SELECT COUNT(*) FROM assets WHERE product_id = ? AND sub_hire = 0", (pid,)).fetchone()[0]
    conn.execute("UPDATE products SET quantity = ? WHERE id = ?", (n, pid))
    par = conn.execute("SELECT parent_id FROM products WHERE id = ? AND item_type = 'cable'", (pid,)).fetchone()
    if par and par[0]:
        sync_cable(conn, par[0])  # a cable's total is the sum of its lengths


def barcode_owner(conn, code, skip_asset=None, skip_product=None):
    """What already uses this barcode (a unit or an item's code), e.g. "unit of QSC K12.2 Speaker" - or None."""
    close = (get_settings(conn).get("case_close_code") or "").strip()
    if close and code.strip().lower() == close.lower():
        return "the code that closes a flight case"
    a = one(conn.execute("SELECT p.name FROM assets x JOIN products p ON p.id = x.product_id "
                         "WHERE x.asset_number = ? COLLATE NOCASE AND x.id != ?", (code, skip_asset or 0)))
    if a:
        return f"a unit of {a['name']}"
    p = one(conn.execute("SELECT name FROM products WHERE sku = ? COLLATE NOCASE AND sku != '' AND id != ?",
                         (code, skip_product or 0)))
    return f"the item code of {p['name']}" if p else None


def barcode_in_use(conn, code, skip_asset=None, skip_product=None):
    return barcode_owner(conn, code, skip_asset, skip_product) is not None


def asset_prefix(p):
    base = (p["sku"] or re.sub(r"[^A-Za-z0-9]+", "", p["name"].upper())[:8] or "ITEM").strip("-")
    return base + "-"


@route("GET", r"/api/barcodes/lookup")
def api_barcode_lookup(req, conn):
    code = (req.q("code") or "").strip()
    if not code:
        raise ApiError(400, "Nothing scanned")
    a = one(conn.execute("SELECT x.id, x.asset_number, x.product_id, p.name, p.parent_id FROM assets x "
                         "JOIN products p ON p.id = x.product_id WHERE x.asset_number = ? COLLATE NOCASE", (code,)))
    if a:
        return {"kind": "unit", "code": a["asset_number"], "product_id": a["parent_id"] or a["product_id"], "name": a["name"]}
    p = one(conn.execute("SELECT id, name, parent_id FROM products WHERE sku = ? COLLATE NOCASE AND sku != ''", (code,)))
    if p:
        return {"kind": "item", "code": code, "product_id": p["parent_id"] or p["id"], "name": p["name"]}
    raise ApiError(404, f"“{code}” doesn't match any barcode")


@route("GET", "/api/barcodes")
def api_barcodes(req, conn):
    """Codes to print as labels: each item's own code and every unit's (a cable's are on its lengths)."""
    try:
        ids = [int(x) for x in (req.q("ids") or "").split(",") if x.strip()][:2000]
    except ValueError:
        raise ApiError(400, "ids must be numbers")
    out = []
    for pid in ids:
        p = one(conn.execute("SELECT id, name, brand, sku, item_type, parent_id FROM products WHERE id = ?", (pid,)))
        if not p:
            continue
        rows_ = [p]
        if p["item_type"] == "cable" and not p["parent_id"]:
            rows_ = rows(conn.execute("SELECT id, name, brand, sku, item_type, parent_id FROM products WHERE parent_id = ? "
                                      "AND archived = 0 ORDER BY length_m", (pid,))) or [p]
        for r in rows_:
            units = [x[0] for x in conn.execute("SELECT asset_number FROM assets WHERE product_id = ? AND sub_hire = 0 "
                                                "ORDER BY asset_number", (r["id"],))]
            out.append({"product_id": r["id"], "parent_id": r["parent_id"], "name": r["name"],
                        "brand": r["brand"] or p["brand"] or "", "sku": r["sku"] or "", "units": units})
    return out


@route("POST", r"/api/products/(\d+)/make-code")
def api_make_code(req, conn, pid):
    """Give an item without a code one of its own, e.g. QSCK122-14, so it can have a barcode label."""
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not p:
        raise ApiError(404, "Product not found")
    if p["sku"]:
        return {"sku": p["sku"]}
    base = re.sub(r"[^A-Za-z0-9]+", "", f"{p['brand'] or ''}{p['name']}".upper())[:10] or "ITEM"
    n, code = 0, f"{base}-{p['id']}"
    while barcode_in_use(conn, code):
        n += 1
        code = f"{base}-{p['id']}-{n}"
    conn.execute("UPDATE products SET sku = ? WHERE id = ?", (code, p["id"]))
    conn.commit()
    return {"sku": code}


@route("POST", r"/api/products/(\d+)/assets")
def api_assets_post(req, conn, pid):
    pid = int(pid)
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not p:
        raise ApiError(404, "Product not found")
    if p["item_type"] == "cable" and not p["parent_id"]:
        raise ApiError(400, "Give barcodes to a cable's lengths (e.g. its 10m cables), not the cable itself")
    d = req.json() or {}
    serial, notes = as_str(d.get("serial_number"), "serial_number"), as_str(d.get("notes"), "notes")
    sub = sub_unit_fields(conn, d) if d.get("sub_hire") else {}
    numbers = []
    codes = [c.strip() for c in (d.get("codes") or []) if isinstance(c, str) and c.strip()]
    if codes:
        if len(codes) > 500:
            raise ApiError(400, "Add up to 500 units at a time")
        if len({c.lower() for c in codes}) != len(codes):
            raise ApiError(400, "The same barcode is in the list twice")
        numbers = codes
    elif as_str(d.get("asset_number"), "asset_number"):
        numbers = [as_str(d["asset_number"], "asset_number")]
    else:
        count = as_int(d.get("count") or 1, "count")
        if not 1 <= count <= 500:
            raise ApiError(400, "Add between 1 and 500 units at a time")
        prefix = as_str(d.get("prefix"), "prefix") or (asset_prefix(p) + ("SH-" if sub else ""))
        used = [r[0] for r in conn.execute("SELECT asset_number FROM assets WHERE asset_number LIKE ?",
                                           (prefix.replace("%", "") + "%",))]
        nums = [int(m.group(1)) for a in used if (m := re.match(re.escape(prefix) + r"(\d+)$", a))]
        n = max(nums, default=0)
        for _ in range(count):
            n += 1
            while barcode_in_use(conn, f"{prefix}{n:03d}"):
                n += 1
            numbers.append(f"{prefix}{n:03d}")
    for num in numbers:
        owner = barcode_owner(conn, num)
        if owner:
            raise ApiError(400, f"{num} is already {owner}")
        insert(conn, "assets", {"product_id": pid, "asset_number": num, "serial_number": serial,
                                "notes": notes, "created_at": now_iso(), **sub})
    if not sub:
        sync_asset_qty(conn, pid)
    conn.commit()
    return api_product(req, conn, pid)


def sub_unit_fields(conn, d):
    """Vendor and hire dates for a sub-hired unit (dates optional: no end = until you remove it)."""
    vid = int_or_none(d.get("vendor_id") or None, "vendor_id")
    if not vid or not conn.execute("SELECT 1 FROM vendors WHERE id = ?", (vid,)).fetchone():
        raise ApiError(400, "Choose which vendor it's hired from")
    f = d.get("hire_from") or None
    t = d.get("hire_to") or None
    f = parse_date(f, "hire_from").isoformat() if f else None
    t = parse_date(t, "hire_to").isoformat() if t else None
    if f and t and t < f:
        raise ApiError(400, "The return date is before the date it arrives")
    return {"sub_hire": 1, "vendor_id": vid, "hire_from": f, "hire_to": t}


@route("PUT", r"/api/assets/(\d+)")
def api_asset_put(req, conn, aid):
    a = one(conn.execute("SELECT * FROM assets WHERE id = ?", (aid,)))
    if not a:
        raise ApiError(404, "Asset not found")
    body = req.json() or {}
    if a["sub_hire"] and any(k in body for k in ("vendor_id", "hire_from", "hire_to")):
        merged = {"vendor_id": a["vendor_id"], "hire_from": a["hire_from"], "hire_to": a["hire_to"]}
        merged.update({k: body[k] for k in ("vendor_id", "hire_from", "hire_to") if k in body})
        update(conn, "assets", aid, sub_unit_fields(conn, merged))
    data = clean(body, {"asset_number": as_str, "serial_number": as_str, "notes": as_str}, partial=True)
    if "asset_number" in data:
        if not data["asset_number"]:
            raise ApiError(400, "Asset number can't be blank")
        owner = barcode_owner(conn, data["asset_number"], skip_asset=aid)
        if owner:
            raise ApiError(400, f"{data['asset_number']} is already {owner}")
    update(conn, "assets", aid, data)
    conn.commit()
    return api_product(req, conn, a["product_id"])


@route("DELETE", r"/api/assets/(\d+)")
def api_asset_delete(req, conn, aid):
    a = one(conn.execute("SELECT * FROM assets WHERE id = ?", (aid,)))
    if not a:
        raise ApiError(404, "Asset not found")
    conn.execute("DELETE FROM quarantine WHERE asset_id = ?", (aid,))
    conn.execute("DELETE FROM assets WHERE id = ?", (aid,))
    if not a["sub_hire"]:  # a sub-hired unit going back doesn't change what you own
        sync_asset_qty(conn, a["product_id"])
    conn.commit()
    return api_product(req, conn, a["product_id"])


@route("POST", r"/api/products/(\d+)/quarantine")
def api_quarantine_post(req, conn, pid):
    pid = int(pid)
    p = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not p:
        raise ApiError(404, "Product not found")
    d = req.json() or {}
    reason = as_str(d.get("reason"), "reason")
    if not reason:
        raise ApiError(400, "Say why it's being quarantined (e.g. “cracked housing”, “fails PAT”)")
    if d.get("asset_id"):
        a = one(conn.execute("SELECT * FROM assets WHERE id = ? AND product_id = ?", (d["asset_id"], pid)))
        if not a:
            raise ApiError(404, "Asset not found")
        if conn.execute("SELECT 1 FROM quarantine WHERE asset_id = ? AND released_at IS NULL", (a["id"],)).fetchone():
            raise ApiError(400, f"{a['asset_number']} is already in quarantine")
        insert(conn, "quarantine", {"product_id": pid, "asset_id": a["id"], "quantity": 1, "reason": reason,
                                    "started_at": now_iso()})
        conn.execute("UPDATE assets SET status = 'quarantine' WHERE id = ?", (a["id"],))
    else:
        if conn.execute("SELECT 1 FROM assets WHERE product_id = ? AND sub_hire = 0", (pid,)).fetchone():
            raise ApiError(400, "This item is tracked by unit — quarantine a specific unit from its asset list")
        qty = as_float(d.get("quantity") or 1, "quantity")
        current = quarantined_map(conn).get(pid, 0)
        if qty <= 0 or qty > p["quantity"] - current:
            raise ApiError(400, f"You can quarantine up to {fmt_num(p['quantity'] - current)} of these")
        insert(conn, "quarantine", {"product_id": pid, "quantity": qty, "reason": reason, "started_at": now_iso()})
    conn.commit()
    return api_product(req, conn, pid)


@route("POST", r"/api/quarantine/(\d+)/release")
def api_quarantine_release(req, conn, qid):
    q = one(conn.execute("SELECT * FROM quarantine WHERE id = ?", (qid,)))
    if not q:
        raise ApiError(404, "Quarantine record not found")
    conn.execute("UPDATE quarantine SET released_at = ? WHERE id = ?", (now_iso(), qid))
    if q["asset_id"]:
        conn.execute("UPDATE assets SET status = 'ok' WHERE id = ?", (q["asset_id"],))
    conn.commit()
    return api_product(req, conn, q["product_id"])


@route("GET", "/api/quarantine")
def api_quarantine_list(req, conn):
    base = """SELECT q.*, p.name AS product_name, p.category, p.sku, x.asset_number
              FROM quarantine q JOIN products p ON p.id = q.product_id
              LEFT JOIN assets x ON x.id = q.asset_id"""
    return {
        "active": rows(conn.execute(base + " WHERE q.released_at IS NULL ORDER BY q.started_at")),
        "recent": rows(conn.execute(base + " WHERE q.released_at IS NOT NULL ORDER BY q.released_at DESC LIMIT 20")),
    }


ACC_SPEC = {"quantity": as_float, "charged": bool_int}
MAX_LINK_DEPTH = 5


def accessory_tree(conn, pid, seen, depth=0):
    """What a stock item brings with it, all the way down: [{name, quantity, includes}]."""
    if depth >= MAX_LINK_DEPTH:
        return []
    out = []
    for r in conn.execute("""SELECT a.quantity, p.id, p.name FROM product_accessories a
                             JOIN products p ON p.id = a.accessory_id WHERE a.product_id = ? AND p.archived = 0
                             ORDER BY a.sort, a.id""", (pid,)):
        if r["id"] in seen:
            continue
        out.append({"name": r["name"], "quantity": r["quantity"],
                    "includes": accessory_tree(conn, r["id"], seen | {r["id"]}, depth + 1)})
    return out


def links_reach(conn, start, target):
    """Does following links from `start` ever reach `target`?"""
    todo, seen = [start], set()
    while todo:
        x = todo.pop()
        if x == target:
            return True
        if x in seen:
            continue
        seen.add(x)
        todo.extend(r[0] for r in conn.execute("SELECT accessory_id FROM product_accessories WHERE product_id = ?", (x,)))
    return False


@route("POST", r"/api/products/(\d+)/accessories")
def api_accessory_post(req, conn, pid):
    pid = int(pid)
    body = req.json() or {}
    aid = as_int(body.get("accessory_id"), "accessory_id")
    if aid == pid:
        raise ApiError(400, "An item can't be linked to itself")
    for x in (pid, aid):
        if not conn.execute("SELECT 1 FROM products WHERE id = ?", (x,)).fetchone():
            raise ApiError(404, "Product not found")
    qty = as_float(body.get("quantity", 1), "quantity")
    if qty <= 0:
        raise ApiError(400, "Quantity must be more than 0")
    if links_reach(conn, aid, pid):
        raise ApiError(400, "That would make a loop — the item you're linking already includes this one")
    conn.execute(
        """INSERT INTO product_accessories (product_id, accessory_id, quantity, charged, sort)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM product_accessories WHERE product_id = ?))
           ON CONFLICT (product_id, accessory_id) DO UPDATE SET quantity = excluded.quantity,
                                                               charged = excluded.charged""",
        (pid, aid, qty, bool_int(body.get("charged"), "charged"), pid))
    conn.commit()
    return api_product(req, conn, pid)


@route("PUT", r"/api/accessories/(\d+)")
def api_accessory_put(req, conn, lid):
    link = one(conn.execute("SELECT * FROM product_accessories WHERE id = ?", (lid,)))
    if not link:
        raise ApiError(404, "Link not found")
    data = clean(req.json(), ACC_SPEC, partial=True)
    if "quantity" in data and data["quantity"] <= 0:
        raise ApiError(400, "Quantity must be more than 0")
    update(conn, "product_accessories", lid, data)
    conn.commit()
    return api_product(req, conn, link["product_id"])


@route("DELETE", r"/api/accessories/(\d+)")
def api_accessory_delete(req, conn, lid):
    link = one(conn.execute("SELECT * FROM product_accessories WHERE id = ?", (lid,)))
    if not link:
        raise ApiError(404, "Link not found")
    conn.execute("DELETE FROM product_accessories WHERE id = ?", (lid,))
    conn.commit()
    return api_product(req, conn, link["product_id"])


@route("PUT", r"/api/products/(\d+)")
def api_product_put(req, conn, pid):
    cur = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not cur:
        raise ApiError(404, "Product not found")
    body = req.json() or {}
    data = clean(body, PRODUCT_SPEC, partial=True)
    apply_power_input(conn, body, data)
    if data.get("sku") and data["sku"].lower() != (cur["sku"] or "").lower() and barcode_in_use(conn, data["sku"], skip_product=cur["id"]):
        raise ApiError(400, f"Code {data['sku']} is already {barcode_owner(conn, data['sku'], skip_product=cur['id'])}")
    if cur["parent_id"]:  # a cable length: only its own stock figures can change
        data = {k: v for k, v in data.items()
                if k in ("quantity", "day_rate", "replacement_value", "weight_kg", "sku", "notes", "archived", "brand")}
    else:
        new_type = data.get("item_type", cur["item_type"])
        if new_type != cur["item_type"] and (cur["item_type"] == "cable" or new_type == "cable"):
            raise ApiError(400, "Cables can't be changed to or from other kinds of stock — add it as a new item")
        if "item_type" in data or any(k in data for k in TYPE_RESET):
            tidy_for_type(data, new_type, cur.get("equip_kind"))
        check_product_links(conn, data, pid)
        check_deck(data)
        check_stand(data)
        check_size(data)
        if (new_type == "package") != (cur["item_type"] == "package"):
            raise ApiError(400, "Packages can't be changed to or from other kinds of stock — add it as a new item")
        if new_type == "cable":
            data.pop("quantity", None)  # comes from its lengths
    if conn.execute("SELECT 1 FROM assets WHERE product_id = ? AND sub_hire = 0", (pid,)).fetchone():
        data.pop("quantity", None)  # owned quantity comes from the unit list
    update(conn, "products", pid, data)
    sync_case_link(conn, int(pid), cur.get("case_for_id"))
    if cur["item_type"] == "cable":
        sync_cable(conn, cur["parent_id"] or int(pid))
    conn.commit()
    return one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))


@route("DELETE", r"/api/products/(\d+)")
def api_product_delete(req, conn, pid):
    cur = one(conn.execute("SELECT * FROM products WHERE id = ?", (pid,)))
    if not cur:
        raise ApiError(404, "Product not found")
    ids = [int(pid)] + [r[0] for r in conn.execute("SELECT id FROM products WHERE parent_id = ?", (pid,))]
    marks = ",".join("?" for _ in ids)
    used = conn.execute(f"SELECT COUNT(*) FROM job_items WHERE product_id IN ({marks})", ids).fetchone()[0]
    if used:
        # Keep history intact: archive instead of deleting.
        conn.execute(f"UPDATE products SET archived = 1 WHERE id IN ({marks})", ids)
    else:
        conn.execute(f"DELETE FROM products WHERE id IN ({marks})", ids)
    if cur["parent_id"]:
        sync_cable(conn, cur["parent_id"])
    conn.commit()
    return {"ok": True, "archived": bool(used)}


# ---- contacts

@route("GET", "/api/contacts")
def api_contacts(req, conn):
    include_archived = req.q("archived") == "1"
    sql = """SELECT c.*, (SELECT COUNT(*) FROM jobs j WHERE j.contact_id = c.id) AS job_count
             FROM contacts c""" + ("" if include_archived else " WHERE c.archived = 0")
    return rows(conn.execute(sql + " ORDER BY c.name COLLATE NOCASE"))


@route("POST", "/api/contacts")
def api_contacts_post(req, conn):
    data = clean(req.json(), CONTACT_SPEC)
    check_contact_numbering(data)
    cid = insert(conn, "contacts", data)
    conn.commit()
    return one(conn.execute("SELECT * FROM contacts WHERE id = ?", (cid,)))


@route("GET", r"/api/contacts/(\d+)")
def api_contact(req, conn, cid):
    c = one(conn.execute("SELECT * FROM contacts WHERE id = ?", (cid,)))
    if not c:
        raise ApiError(404, "Contact not found")
    jobs = rows(conn.execute("SELECT * FROM jobs WHERE contact_id = ? ORDER BY start_date DESC", (cid,)))
    attach_totals(conn, jobs)
    c["jobs"] = jobs
    return c


@route("PUT", r"/api/contacts/(\d+)")
def api_contact_put(req, conn, cid):
    if not conn.execute("SELECT 1 FROM contacts WHERE id = ?", (cid,)).fetchone():
        raise ApiError(404, "Contact not found")
    data = clean(req.json(), CONTACT_SPEC, partial=True)
    check_contact_numbering(data)
    update(conn, "contacts", cid, data)
    conn.commit()
    return one(conn.execute("SELECT * FROM contacts WHERE id = ?", (cid,)))


@route("DELETE", r"/api/contacts/(\d+)")
def api_contact_delete(req, conn, cid):
    used = conn.execute("SELECT COUNT(*) FROM jobs WHERE contact_id = ?", (cid,)).fetchone()[0]
    if used:
        conn.execute("UPDATE contacts SET archived = 1 WHERE id = ?", (cid,))
        conn.commit()
        return {"ok": True, "archived": True}
    conn.execute("DELETE FROM contacts WHERE id = ?", (cid,))
    conn.commit()
    return {"ok": True, "archived": False}


# ---- jobs

def attach_totals(conn, jobs):
    items = load_items(conn, [j["id"] for j in jobs])
    vat, registered = vat_rate_of(conn), vat_registered(conn)
    for j in jobs:
        its = price_items(j, items.get(j["id"], []))
        j["totals"] = totals(j, its, vat, registered)
        j["item_count"] = len(its)
    return jobs


def next_job_number(conn, contact_id=None):
    """The next job number. A client with their own prefix gets their own count, e.g. ACME-1, ACME-2."""
    c = contact_id and one(conn.execute("SELECT job_prefix, next_job_number FROM contacts WHERE id = ?", (contact_id,)))
    if c and (c["job_prefix"] or "").strip():
        prefix = c["job_prefix"].strip()
        n = c["next_job_number"] or 1
        while conn.execute("SELECT 1 FROM jobs WHERE number = ?", (f"{prefix}{n}",)).fetchone():
            n += 1
        conn.execute("UPDATE contacts SET next_job_number = ? WHERE id = ?", (n + 1, contact_id))
        return f"{prefix}{n}"
    s = get_settings(conn)
    prefix = s.get("job_prefix", "")
    try:
        n = int(s.get("next_job_number") or 1)
    except ValueError:
        n = 1
    while conn.execute("SELECT 1 FROM jobs WHERE number = ?", (f"{prefix}{n}",)).fetchone():
        n += 1
    conn.execute("INSERT INTO settings(key, value) VALUES('next_job_number', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(n + 1),))
    return f"{prefix}{n}"


def validate_job_dates(data):
    if "start_date" in data and "end_date" in data:
        if parse_date(data["end_date"]) < parse_date(data["start_date"]):
            raise ApiError(400, "End date must be on or after the start date")


JOB_LIST_SQL = """SELECT j.*, c.name AS contact_name, c.company AS contact_company
                  FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id"""


def kit_out_by_job(conn, job_ids=None):
    """How many items each job has checked out and not yet checked back in."""
    sql = ("SELECT job_id, SUM(CASE WHEN direction = 'out' THEN quantity ELSE 0 END) "
           "- SUM(CASE WHEN direction = 'in' THEN quantity ELSE 0 END) FROM job_checks")
    params = []
    if job_ids is not None:
        if not job_ids:
            return {}
        sql += f" WHERE job_id IN ({','.join('?' * len(job_ids))})"
        params = list(job_ids)
    return {r[0]: max(0, r[1] or 0) for r in conn.execute(sql + " GROUP BY job_id", params)}


def attach_overdue(conn, jobs):
    """Hire period, due-back date and overdue state. A hire is overdue when kit is still out
    (status On hire, or items scanned out and not back) after its return date plus the grace days."""
    grace = int(get_settings(conn).get("overdue_grace_days") or 0)
    today = dt.date.today()
    out = kit_out_by_job(conn, [j["id"] for j in jobs])
    for j in jobs:
        s0, e0 = dt.date.fromisoformat(j["start_date"]), dt.date.fromisoformat(j["end_date"])
        j["hire_days"] = (e0 - s0).days + 1
        j["due_back"] = j["end_date"]
        j["kit_out"] = out.get(j["id"], 0)
        still_out = j["status"] == "out" or (j["status"] in ("confirmed", "provisional") and j["kit_out"] > 0)
        late = (today - e0).days
        j["days_late"] = late if still_out and late > 0 else 0
        j["overdue"] = bool(still_out and late > grace)
        j["overdue_grace"] = grace
    return jobs


@route("GET", "/api/jobs")
def api_jobs(req, conn):
    where, params = [], []
    status = req.q("status")
    if status:
        sts = [s for s in status.split(",") if s in STATUSES]
        if sts:
            where.append(f"j.status IN ({','.join('?' for _ in sts)})")
            params += sts
    if req.q("from"):
        where.append("j.end_date >= ?")
        params.append(req.q("from"))
    if req.q("to"):
        where.append("j.start_date <= ?")
        params.append(req.q("to"))
    if req.q("q"):
        like = f"%{req.q('q')}%"
        where.append("(j.name LIKE ? OR j.number LIKE ? OR j.venue LIKE ? OR j.reference LIKE ? "
                     "OR c.name LIKE ? OR c.company LIKE ?)")
        params += [like] * 6
    sql = JOB_LIST_SQL + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY j.start_date DESC, j.id DESC"
    jobs = attach_overdue(conn, attach_totals(conn, rows(conn.execute(sql, params))))
    if req.q("overdue") == "1":
        jobs = [j for j in jobs if j["overdue"]]
    return jobs


@route("POST", "/api/jobs")
def api_jobs_post(req, conn):
    data = clean(req.json(), JOB_SPEC)
    validate_job_dates(data)
    data.setdefault("status", "enquiry")
    data["number"] = next_job_number(conn, data.get("contact_id"))
    data["created_at"] = data["updated_at"] = now_iso()
    jid = insert(conn, "jobs", data)
    conn.commit()
    return job_detail(conn, jid)


def job_detail(conn, jid):
    job = one(conn.execute(JOB_LIST_SQL + " WHERE j.id = ?", (jid,)))
    if not job:
        raise ApiError(404, "Job not found")
    if job["contact_id"]:
        job["contact"] = one(conn.execute("SELECT * FROM contacts WHERE id = ?", (job["contact_id"],)))
    else:
        job["contact"] = None
    items = effective_sections(price_items(job, load_items(conn, [jid])[jid]))
    job["items"] = items
    job["sections"] = job_sections(conn, job, items)
    job["checks"] = check_summary(conn, jid)
    job["totals"] = totals(job, items, vat_rate_of(conn), vat_registered(conn))
    job["availability"] = job_availability(conn, job, items)
    if job.get("zoho_invoice_id") and get_secret(conn, "zoho_accounts_url"):
        host = urlparse(get_secret(conn, "zoho_accounts_url")).netloc.replace("accounts.", "books.", 1)
        job["zoho_invoice_url"] = f"https://{host}/app/{get_secret(conn, 'zoho_org_id')}#/invoices/{job['zoho_invoice_id']}"
    job["total_weight_kg"] = round(sum((it["product_weight"] or 0) * (it["quantity"] or 0)
                                       for it in items if it["product_id"]), 2)
    job["cases"] = job_cases(conn, jid, packed_only=True)
    on_job = {it["product_id"] for it in items if it["product_id"]}
    for c in job["cases"]:
        c["on_job"] = c["product_id"] in on_job  # already counted in the job's weight
    job["power"] = power_summary(conn, items, job.get("power_supply"))
    job["sub_hires"] = sub_hire_summary(conn, job, items)
    attach_overdue(conn, [job])
    job["invoice"] = invoice_info(job, get_settings(conn))
    ids = job_editors(job)
    job["editor_ids"] = ids
    job["editor_names"] = [r[0] for r in conn.execute(
        f"SELECT name FROM users WHERE id IN ({','.join('?' * len(ids)) or 'NULL'}) ORDER BY name", ids)]
    return job


def sub_hire_summary(conn, job, items):
    """What to order in from each vendor for this job."""
    days = charge_days(job)
    by_vendor = {}
    for it in items:
        if it["kind"] != "rental" or not it["product_id"]:
            continue
        if it.get("product_sub_hire"):
            qty, vid, vname, cost, extra = it["quantity"] or 0, it.get("product_vendor_id"), it.get("vendor_name"), None, False
        elif (it.get("sub_qty") or 0) > 0:
            qty = min(it["quantity"] or 0, it["sub_qty"])
            vid = it.get("sub_vendor_id") or it.get("product_vendor_id")
            vname, cost, extra = it.get("sub_vendor_name"), it.get("sub_cost"), True
        else:
            continue
        if cost is None:
            cost = it.get("product_sub_hire_cost") or 0
        v = by_vendor.setdefault(vid or 0, {"vendor_id": vid, "vendor_name": vname or "", "items": {}, "cost": 0.0})
        row = v["items"].setdefault((it["product_id"], cost), {"product_id": it["product_id"], "name": it["product_name"],
                                                                "quantity": 0, "cost_per_day": cost, "extra": extra})
        row["quantity"] += qty
    out = []
    for v in by_vendor.values():
        v["items"] = list(v["items"].values())
        v["cost"] = round(sum(r["quantity"] * r["cost_per_day"] * days for r in v["items"]), 2)
        out.append(v)
    out.sort(key=lambda v: (not v["vendor_name"], v["vendor_name"].lower()))
    return out


@route("GET", r"/api/jobs/(\d+)")
def api_job(req, conn, jid):
    return job_detail(conn, int(jid))


@route("PUT", r"/api/jobs/(\d+)")
def api_job_put(req, conn, jid):
    current = one(conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)))
    if not current:
        raise ApiError(404, "Job not found")
    data = clean(req.json(), JOB_SPEC, partial=True)
    merged = dict(current, **data)
    validate_job_dates(merged)
    data["updated_at"] = now_iso()
    update(conn, "jobs", jid, data)
    conn.commit()
    return job_detail(conn, int(jid))


@route("DELETE", r"/api/jobs/(\d+)")
def api_job_delete(req, conn, jid):
    conn.execute("DELETE FROM jobs WHERE id = ?", (jid,))
    conn.commit()
    return {"ok": True}


@route("POST", r"/api/jobs/(\d+)/duplicate")
def api_job_duplicate(req, conn, jid):
    src = one(conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)))
    if not src:
        raise ApiError(404, "Job not found")
    body = req.json() or {}
    new = {k: src[k] for k in ("name", "contact_id", "venue", "reference", "start_date", "end_date",
                               "charge_days", "discount_pct", "notes", "internal_notes")}
    if body.get("start_date"):
        # Shift the job to the new start date, keeping the same length.
        length = (parse_date(src["end_date"]) - parse_date(src["start_date"])).days
        start = parse_date(body["start_date"], "start_date")
        new["start_date"] = start.isoformat()
        new["end_date"] = (start + dt.timedelta(days=length)).isoformat()
    if body.get("name"):
        new["name"] = as_str(body["name"], "name")
    else:
        new["name"] = src["name"] + " (copy)"
    new["status"] = "enquiry"
    new["number"] = next_job_number(conn, new.get("contact_id"))
    new["created_at"] = new["updated_at"] = now_iso()
    new_id = insert(conn, "jobs", new)
    secmap = {}
    for sc in rows(conn.execute("SELECT * FROM job_sections WHERE job_id = ? ORDER BY (parent_id IS NOT NULL), sort, id",
                                (jid,))):
        old_sid = sc.pop("id")
        sc["job_id"] = new_id
        sc["parent_id"] = secmap.get(sc["parent_id"])
        secmap[old_sid] = insert(conn, "job_sections", sc)
    idmap = {}
    for it in rows(conn.execute("SELECT * FROM job_items WHERE job_id = ? ORDER BY id", (jid,))):
        old = it.pop("id")
        it["job_id"] = new_id
        if it.get("parent_item_id"):
            it["parent_item_id"] = idmap.get(it["parent_item_id"])
        it["section_id"] = secmap.get(it.get("section_id"))
        idmap[old] = insert(conn, "job_items", it)
    conn.commit()
    return job_detail(conn, new_id)


# ---- power planning

def power_summary(conn, items, supply_key=None, light=False):
    """Estimate load for some job lines and check sockets, against the chosen venue supply.

    Equipment only knows its power draw; every powered unit is assumed to need one socket.
    Power distribution items (leads, distros) supply the sockets."""
    s = get_settings(conn)

    def num_setting(key, default):
        try:
            return float(s.get(key) or default)
        except ValueError:
            return default
    volts = num_setting("mains_voltage", 230) or 230
    safe = (num_setting("safe_load_pct", 80) or 80) / 100.0
    supply = SUPPLY_BY_KEY.get(supply_key or "") or SUPPLY_BY_KEY.get(s.get("default_supply") or "") \
        or POWER_SUPPLIES[0]
    run_meta = {}
    for it in items:
        if it.get("meta"):
            try:
                m = json.loads(it["meta"])
            except ValueError:
                m = {}
            if m.get("type") == "cable_run":
                run_meta[it["id"]] = m
    pids = {it["product_id"] for it in items if it["product_id"] and it["kind"] == "rental"}
    pids |= {m.get("end_product_id") for m in run_meta.values() if m.get("end_product_id")}
    prods = {}
    if pids:
        marks = ",".join("?" for _ in pids)
        prods = {r["id"]: dict(r) for r in conn.execute(
            f"SELECT id, name, item_type, power_watts, plugs_in, power_cable, sockets, socket_type, power_rating_a, "
            f"plug_type FROM products WHERE id IN ({marks})", list(pids))}
    watts, sockets_needed, sockets_have = 0.0, 0.0, 0.0
    socket_types = {}
    devices, leads = [], []
    lead_count, lead_capacity = 0.0, 0.0
    unknown = 0.0
    is_lead = lambda p: p and p["sockets"] and (p["item_type"] == "power" or (p["item_type"] == "cable" and p["power_cable"]))
    lines = []
    for it in items:
        if it["id"] in run_meta:
            # A power-cable run: only the sockets at the far end are free - the others feed the next cable.
            end = prods.get(run_meta[it["id"]].get("end_product_id"))
            if is_lead(end):
                lines.append((dict(end, name=f"{it['description']} (end of run)"), it["quantity"] or 0))
            continue
        if it.get("parent_item_id") in run_meta:
            continue  # cables inside a run are counted by the run
        p = prods.get(it["product_id"]) if it["kind"] == "rental" else None
        if p:
            lines.append((p, it["quantity"] or 0))
    for p, qty in lines:
        if is_lead(p):
            sockets_have += qty * p["sockets"]
            st = p["socket_type"] or "sockets"
            socket_types[st] = socket_types.get(st, 0) + qty * p["sockets"]
            lead_count += qty
            lead_capacity += qty * (p["power_rating_a"] or supply["amps"]) * safe
            leads.append({"name": p["name"], "qty": qty, "sockets": p["sockets"], "socket_type": p["socket_type"],
                          "rating_a": p["power_rating_a"]})
        elif p["item_type"] == "equipment" and (p["plugs_in"] or p["power_watts"]):
            watts += qty * (p["power_watts"] or 0)
            if p["plugs_in"]:
                sockets_needed += qty
                if not p["power_watts"]:
                    unknown += qty
            devices.append({"name": p["name"], "qty": qty, "watts": p["power_watts"],
                            "amps": round((p["power_watts"] or 0) / volts, 2)})
    amps = watts / volts

    def supplies_needed(sup):
        cap = sup["amps"] * safe * sup["phases"]
        return math.ceil(amps / cap - 1e-9) if amps else 0
    out = {
        "watts": round(watts), "amps": round(amps, 1), "volts": volts, "safe_pct": int(round(safe * 100)),
        "supply": supply, "supplies_needed": supplies_needed(supply),
        "supply_capacity_amps": round(supply["amps"] * safe * supply["phases"], 1),
        "sockets_needed": sockets_needed, "sockets_have": sockets_have,
        "sockets_short": max(0, sockets_needed - sockets_have),
        "has_data": bool(devices or leads), "unknown_load": unknown,
    }
    if light:
        return out
    options = [{"key": x["key"], "label": x["label"], "needed": supplies_needed(x),
                "capacity_amps": round(x["amps"] * safe * x["phases"], 1)} for x in POWER_SUPPLIES]
    suggestions = []
    short = out["sockets_short"]
    if short:
        cand = one(conn.execute(
            "SELECT id, name, sockets FROM products WHERE archived = 0 AND sockets > 0 AND (item_type = 'power' OR "
            "(item_type = 'cable' AND power_cable = 1 AND parent_id IS NOT NULL)) "
            "ORDER BY (plug_type = ?) DESC, sockets DESC, COALESCE(length_m, 0), power_rating_a DESC LIMIT 1",
            (supply["plug"],)))
        if cand:
            suggestions.append({"product_id": cand["id"], "name": cand["name"],
                                "quantity": math.ceil(short / cand["sockets"]),
                                "why": f"{fmt_num(short)} more socket{'s' if short != 1 else ''} needed"})
        else:
            suggestions.append({"product_id": None, "name": None, "quantity": 0,
                                "why": f"{fmt_num(short)} more socket{'s' if short != 1 else ''} needed — "
                                       "add extension leads or distros to Power distribution stock"})
    needed = out["supplies_needed"]
    if needed and lead_count and lead_count < needed:
        cand = one(conn.execute(
            "SELECT id, name FROM products WHERE archived = 0 AND sockets > 0 AND (item_type = 'power' OR "
            "(item_type = 'cable' AND power_cable = 1 AND parent_id IS NOT NULL)) "
            "ORDER BY (plug_type = ?) DESC, sockets DESC, COALESCE(length_m, 0) LIMIT 1", (supply["plug"],)))
        if cand:
            suggestions.append({"product_id": cand["id"], "name": cand["name"], "quantity": int(needed - lead_count),
                                "why": f"split the load across {needed} × {supply['label']}"})
    warnings = []
    if unknown:
        warnings.append(f"{fmt_num(unknown)} item{'s' if unknown != 1 else ''} plug in but have no power draw set, "
                        "so the real load may be higher.")
    if amps and lead_count and amps > lead_capacity + 1e-9:
        warnings.append(f"Estimated load {amps:.1f} A is more than the leads/distros on this job can safely carry "
                        f"({lead_capacity:.1f} A at {int(safe * 100)}% of their ratings).")
    out.update({"options": options, "devices": devices, "leads": leads, "socket_types": socket_types,
                "lead_count": lead_count, "lead_capacity_amps": round(lead_capacity, 1),
                "suggestions": suggestions, "warnings": warnings})
    return out


# ---- sections

def effective_sections(items):
    """Lines added with a parent (accessories, cable-run cables) live in their parent's section."""
    by_id = {it["id"]: it for it in items}
    for it in items:
        par = by_id.get(it.get("parent_item_id"))
        it["effective_section_id"] = (par.get("section_id") if par else None) or it.get("section_id")
    return items


def job_sections(conn, job, items):
    secs = rows(conn.execute("SELECT * FROM job_sections WHERE job_id = ? ORDER BY sort, id", (job["id"],)))
    kids = {}
    for sc in secs:
        kids.setdefault(sc["parent_id"], []).append(sc["id"])

    def subtree(sid):
        out = {sid}
        for k in kids.get(sid, []):
            out |= subtree(k)
        return out
    for sc in secs:
        ids = subtree(sc["id"])
        mine = [it for it in items if it["effective_section_id"] in ids]
        sc["power"] = power_summary(conn, mine, job.get("power_supply"), light=True)
        sc["item_count"] = sum(1 for it in mine if not it.get("parent_item_id"))
    return secs


@route("POST", r"/api/jobs/(\d+)/sections")
def api_section_post(req, conn, jid):
    jid = int(jid)
    if not conn.execute("SELECT 1 FROM jobs WHERE id = ?", (jid,)).fetchone():
        raise ApiError(404, "Job not found")
    d = req.json() or {}
    name = as_str(d.get("name"), "name")
    if not name:
        raise ApiError(400, "Give the section a heading")
    parent = as_int(d.get("parent_id"), "parent_id", allow_none=True)
    if parent:
        ps = one(conn.execute("SELECT * FROM job_sections WHERE id = ? AND job_id = ?", (parent, jid)))
        if not ps:
            raise ApiError(404, "Section not found")
        if ps["parent_id"]:
            raise ApiError(400, "Sub-sections can't have their own sub-sections")
    sort = (conn.execute("SELECT COALESCE(MAX(sort), 0) FROM job_sections WHERE job_id = ?", (jid,)).fetchone()[0]) + 1
    sid = insert(conn, "job_sections", {"job_id": jid, "parent_id": parent, "name": name[:120],
                                        "notes": as_str(d.get("notes"), "notes"), "sort": sort})
    conn.commit()
    out = job_detail(conn, jid)
    out["new_section_id"] = sid
    return out


@route("PUT", r"/api/sections/(\d+)")
def api_section_put(req, conn, sid):
    sc = one(conn.execute("SELECT * FROM job_sections WHERE id = ?", (sid,)))
    if not sc:
        raise ApiError(404, "Section not found")
    data = clean(req.json(), {"name": as_str, "notes": as_str}, partial=True)
    if "name" in data and not data["name"]:
        raise ApiError(400, "Give the section a heading")
    update(conn, "job_sections", sid, data)
    conn.commit()
    return job_detail(conn, sc["job_id"])


@route("POST", r"/api/sections/(\d+)/move")
def api_section_move(req, conn, sid):
    sc = one(conn.execute("SELECT * FROM job_sections WHERE id = ?", (sid,)))
    if not sc:
        raise ApiError(404, "Section not found")
    step = -1 if as_int((req.json() or {}).get("dir"), "dir") < 0 else 1
    sibs = rows(conn.execute("SELECT id, sort FROM job_sections WHERE job_id = ? AND parent_id IS ? ORDER BY sort, id",
                             (sc["job_id"], sc["parent_id"])))
    ids = [x["id"] for x in sibs]
    i = ids.index(sc["id"])
    j = i + step
    if 0 <= j < len(ids):
        ids[i], ids[j] = ids[j], ids[i]
        for n, x in enumerate(ids):
            conn.execute("UPDATE job_sections SET sort = ? WHERE id = ?", (n + 1, x))
        conn.commit()
    return job_detail(conn, sc["job_id"])


@route("DELETE", r"/api/sections/(\d+)")
def api_section_delete(req, conn, sid):
    sc = one(conn.execute("SELECT * FROM job_sections WHERE id = ?", (sid,)))
    if not sc:
        raise ApiError(404, "Section not found")
    ids = [sc["id"]] + [r[0] for r in conn.execute("SELECT id FROM job_sections WHERE parent_id = ?", (sid,))]
    marks = ",".join("?" for _ in ids)
    # Its equipment isn't deleted - it moves up to the parent section (or out of sections).
    conn.execute(f"UPDATE job_items SET section_id = ? WHERE section_id IN ({marks})", [sc["parent_id"]] + ids)
    conn.execute(f"DELETE FROM job_sections WHERE id IN ({marks})", ids)
    conn.commit()
    return job_detail(conn, sc["job_id"])


def check_section(conn, jid, sid):
    if sid and not conn.execute("SELECT 1 FROM job_sections WHERE id = ? AND job_id = ?", (sid, jid)).fetchone():
        raise ApiError(400, "That section isn't on this job")


# ---- check / scan

def check_lines(conn, jid, direction):
    items = load_items(conn, [jid])[jid]
    need = {}
    packages = {r[0] for r in conn.execute("SELECT id FROM products WHERE item_type = 'package'")}
    for it in items:
        if it["kind"] == "rental" and it["product_id"] and it["product_id"] not in packages:
            n = need.setdefault(it["product_id"], {"product_id": it["product_id"], "name": it["product_name"],
                                                   "sku": it["product_sku"], "category": it["product_category"],
                                                   "needed": 0})
            n["needed"] += it["quantity"] or 0
    checks = rows(conn.execute(
        """SELECT c.*, x.asset_number FROM job_checks c LEFT JOIN assets x ON x.id = c.asset_id
           WHERE c.job_id = ? AND c.direction = ? ORDER BY c.id""", (jid, direction)))
    tracked = {r[0] for r in conn.execute("SELECT DISTINCT product_id FROM assets WHERE sub_hire = 0")}
    lines = []
    for pid, n in need.items():
        mine = [c for c in checks if c["product_id"] == pid]
        n["done"] = sum(c["quantity"] for c in mine)
        n["assets"] = [{"check_id": c["id"], "asset_number": c["asset_number"], "by": c.get("user_name") or "",
                        "at": c["created_at"]} for c in mine if c["asset_id"]]
        n["by"] = sorted({c.get("user_name") for c in mine if c.get("user_name")})
        n["tracked"] = pid in tracked
        lines.append(n)
    extra = [c for c in checks if c["product_id"] not in need]
    lines.sort(key=lambda l: ((l["category"] or "").lower(), (l["name"] or "").lower()))
    notes = {r["product_id"]: r for r in rows(conn.execute(
        "SELECT product_id, note, user_name, updated_at FROM check_notes WHERE job_id = ? AND direction = ?", (jid, direction)))}
    for l in lines:
        n = notes.get(l["product_id"])
        l["note"], l["note_by"] = (n["note"], n["user_name"]) if n else ("", "")
    free = {}
    for c in extra:  # scanned while free scan was on (or left over after an item was taken off the job)
        f = free.setdefault(c["product_id"], {"product_id": c["product_id"], "done": 0, "assets": [], "by": set()})
        f["done"] += c["quantity"]
        if c["asset_id"]:
            f["assets"].append({"check_id": c["id"], "asset_number": c["asset_number"], "by": c.get("user_name") or "", "at": c["created_at"]})
        if c.get("user_name"):
            f["by"].add(c["user_name"])
        f.setdefault("check_ids", []).append(c["id"])
    for pid, f in free.items():
        p = one(conn.execute("SELECT name, sku, category FROM products WHERE id = ?", (pid,))) or {}
        f.update(name=p.get("name", "?"), sku=p.get("sku", ""), category=p.get("category", ""), by=sorted(f["by"]))
        n = notes.get(pid)
        f["note"], f["note_by"] = (n["note"], n["user_name"]) if n else ("", "")
    out = {"direction": direction, "lines": lines, "needed": sum(l["needed"] for l in lines),
           "done": sum(min(l["done"], l["needed"]) for l in lines), "unexpected": len(extra),
           "free": sorted(free.values(), key=lambda f: f["name"].lower())}
    if direction == "out":
        out["cases"] = job_cases(conn, jid)
    return out


def check_summary(conn, jid):
    out = {}
    for d in ("out", "in"):
        c = check_lines(conn, jid, d)
        out[d] = {"needed": c["needed"], "done": c["done"]}
    return out


def direction_of(v):
    if v not in ("out", "in"):
        raise ApiError(400, "Direction must be out or in")
    return v


@route("GET", r"/api/jobs/(\d+)/check")
def api_check(req, conn, jid):
    jid = int(jid)
    job = one(conn.execute(JOB_LIST_SQL + " WHERE j.id = ?", (jid,)))
    if not job:
        raise ApiError(404, "Job not found")
    out = check_lines(conn, jid, direction_of(req.q("dir") or "out"))
    out["job"] = job
    return out


def case_code_lookup(conn, code):
    """If this barcode is a flight case (one of its units, or its item code), what it is - else None."""
    a = one(conn.execute("SELECT x.id AS asset_id, x.asset_number AS code, p.id AS product_id, p.name, p.case_for_id "
                         "FROM assets x JOIN products p ON p.id = x.product_id "
                         "WHERE x.asset_number = ? COLLATE NOCASE AND p.item_type = 'case'", (code,)))
    if a:
        return a
    p = one(conn.execute("SELECT NULL AS asset_id, sku AS code, id AS product_id, name, case_for_id FROM products "
                         "WHERE sku = ? COLLATE NOCASE AND sku != '' AND item_type = 'case'", (code,)))
    return p


def open_case(conn, jid, case_id):
    """The flight case being packed, if it's still open on this job."""
    if not case_id:
        return None
    return one(conn.execute("SELECT * FROM job_cases WHERE id = ? AND job_id = ? AND closed_at IS NULL", (case_id, jid)))


def case_title(c):
    return " · ".join(x for x in (c.get("label"), c.get("name"), c.get("code")) if x)


def job_cases(conn, jid, packed_only=False):
    """Flight cases loaded on a job's check-out: what's in each one, and what it weighs packed."""
    cases = rows(conn.execute(
        "SELECT c.*, p.name, p.weight_kg AS empty_kg, p.size_w, p.size_d, p.size_h, p.inner_w, p.inner_d, p.inner_h "
        "FROM job_cases c JOIN products p ON p.id = c.product_id WHERE c.job_id = ? ORDER BY c.id", (jid,)))
    for c in cases:
        items = {}
        for r in rows(conn.execute(
                "SELECT k.id AS check_id, k.product_id, k.quantity, x.asset_number, p.name, p.sku, p.weight_kg "
                "FROM job_checks k JOIN products p ON p.id = k.product_id LEFT JOIN assets x ON x.id = k.asset_id "
                "WHERE k.case_id = ? AND k.direction = 'out' ORDER BY k.id", (c["id"],))):
            it = items.setdefault(r["product_id"], {"product_id": r["product_id"], "name": r["name"], "sku": r["sku"],
                                                    "quantity": 0, "weight_kg": 0.0, "assets": []})
            it["quantity"] += r["quantity"] or 0
            it["weight_kg"] += (r["weight_kg"] or 0) * (r["quantity"] or 0)
            if r["asset_number"]:
                it["assets"].append({"check_id": r["check_id"], "asset_number": r["asset_number"]})
        c["items"] = sorted(items.values(), key=lambda i: i["name"].lower())
        for i in c["items"]:
            i["weight_kg"] = round(i["weight_kg"], 2)
        c["contents_kg"] = round(sum(i["weight_kg"] for i in c["items"]), 2)
        c["empty_kg"] = round(c["empty_kg"] or 0, 2)
        c["total_kg"] = round(c["empty_kg"] + c["contents_kg"], 2)
        c["item_count"] = sum(i["quantity"] for i in c["items"])
        c["open"] = c["closed_at"] is None
    return [c for c in cases if c["items"]] if packed_only else cases


def do_scan(conn, jid, direction, code, free=False, case_id=None):
    """Scan one code on a job. free=True: something not on the job is recorded in the job's free-scan section.
    case_id: the flight case being packed (check-out only) - what's scanned is recorded as inside it."""
    state = check_lines(conn, jid, direction)
    lines = {l["product_id"]: l for l in state["lines"]}
    case = open_case(conn, jid, case_id) if direction == "out" else None

    def reply(kind, message, pid=None, **extra):
        res = check_lines(conn, jid, direction)
        res.update({"result": kind, "message": message, "product_id": pid}, **extra)
        if case_id and not open_case(conn, jid, case_id):
            res["open_case"] = None  # closed (maybe by someone else): stop packing into it
        elif case:
            res["open_case"] = next((c for c in res.get("cases", []) if c["id"] == case["id"]), None)
        return res

    def record(row):
        if case:
            row["case_id"] = case["id"]
        insert(conn, "job_checks", row)

    def into(msg):
        if not case:
            return msg
        c = dict(case, name=one(conn.execute("SELECT name FROM products WHERE id = ?", (case["product_id"],)))["name"])
        return f"{msg} → in {case_title(c)}"
    close = (get_settings(conn).get("case_close_code") or "").strip()
    if close and code.lower() == close.lower():
        if direction != "out":
            return reply("error", "Flight cases are packed at check-out — nothing to close here")
        if not case:
            return reply("warn", "No flight case is open — scan a flight case to start packing one", open_case=None)
        conn.execute("UPDATE job_cases SET closed_at = ? WHERE id = ?", (now_iso(), case["id"]))
        conn.commit()
        case = None
        return reply("case_closed", "Flight case closed", open_case=None)
    fc = case_code_lookup(conn, code) if direction == "out" else None
    if fc and not fc["case_for_id"]:
        # A general-purpose case: offer to start packing it.
        existing = one(conn.execute("SELECT id, closed_at FROM job_cases WHERE job_id = ? AND code = ? COLLATE NOCASE "
                                    "ORDER BY id DESC LIMIT 1", (jid, fc["code"])))
        return reply("case", f"{fc['code']} — {fc['name']} is a flight case. Load it?", fc["product_id"],
                     case_offer={"code": fc["code"], "name": fc["name"], "existing_id": existing and existing["id"],
                                 "reopen": bool(existing and existing["closed_at"])})
    asset = one(conn.execute("SELECT x.*, p.name FROM assets x JOIN products p ON p.id = x.product_id "
                             "WHERE x.asset_number = ? COLLATE NOCASE", (code,)))
    if asset:
        line = lines.get(asset["product_id"])
        if direction == "out" and conn.execute(
                "SELECT 1 FROM quarantine WHERE asset_id = ? AND released_at IS NULL", (asset["id"],)).fetchone():
            return reply("error", f"{asset['asset_number']} is in QUARANTINE — don't send it", asset["product_id"])
        if conn.execute("SELECT 1 FROM job_checks WHERE job_id = ? AND direction = ? AND asset_id = ?",
                        (jid, direction, asset["id"])).fetchone():
            return reply("warn", f"{asset['asset_number']} was already scanned", asset["product_id"])
        if not line:
            if not free:
                return reply("error", f"{asset['asset_number']} ({asset['name']}) isn't on this job")
            record({"job_id": jid, "product_id": asset["product_id"], "direction": direction,
                    "quantity": 1, "asset_id": asset["id"], "free": 1, "created_at": now_iso()})
            conn.commit()
            return reply("free", into(f"{asset['asset_number']} — {asset['name']} (free scan: not on the job)"), asset["product_id"])
        if line["done"] >= line["needed"]:
            return reply("warn", f"Already have all {fmt_num(line['needed'])} × {line['name']}", asset["product_id"])
        record({"job_id": jid, "product_id": asset["product_id"], "direction": direction,
                "quantity": 1, "asset_id": asset["id"], "created_at": now_iso()})
        conn.commit()
        return reply("ok", into(f"{asset['asset_number']} — {asset['name']} ({fmt_num(line['done'] + 1)}/{fmt_num(line['needed'])})"),
                     asset["product_id"])
    prods = rows(conn.execute("SELECT id, name FROM products WHERE sku = ? COLLATE NOCASE AND sku != ''", (code,)))
    on_job = [p for p in prods if p["id"] in lines]
    if not on_job:
        if prods and free:
            p = prods[0]
            record({"job_id": jid, "product_id": p["id"], "direction": direction, "quantity": 1,
                    "free": 1, "created_at": now_iso()})
            conn.commit()
            return reply("free", into(f"{p['name']} (free scan: not on the job)"), p["id"])
        if prods:
            return reply("error", f"{prods[0]['name']} isn't on this job")
        return reply("error", f"“{code}” doesn't match any asset number or item code")
    p = on_job[0]
    line = lines[p["id"]]
    if line["done"] >= line["needed"]:
        return reply("warn", f"Already have all {fmt_num(line['needed'])} × {p['name']}", p["id"])
    record({"job_id": jid, "product_id": p["id"], "direction": direction, "quantity": 1,
            "created_at": now_iso()})
    conn.commit()
    return reply("ok", into(f"{p['name']} ({fmt_num(line['done'] + 1)}/{fmt_num(line['needed'])})"), p["id"])


@route("POST", r"/api/jobs/(\d+)/check/scan")
def api_check_scan(req, conn, jid):
    d = req.json() or {}
    code = as_str(d.get("code"), "code")
    if not code:
        raise ApiError(400, "Nothing scanned")
    return do_scan(conn, int(jid), direction_of(d.get("dir") or "out"), code, free=bool(d.get("free")),
                   case_id=as_int(d.get("case_id"), "case_id", allow_none=True))


@route("POST", r"/api/jobs/(\d+)/cases")
def api_case_load(req, conn, jid):
    """Start (or carry on) packing a flight case at check-out."""
    jid = int(jid)
    if not conn.execute("SELECT 1 FROM jobs WHERE id = ?", (jid,)).fetchone():
        raise ApiError(404, "Job not found")
    code = as_str((req.json() or {}).get("code"), "code")
    fc = case_code_lookup(conn, code)
    if not fc:
        raise ApiError(400, f"“{code}” isn't a flight case")
    c = one(conn.execute("SELECT * FROM job_cases WHERE job_id = ? AND code = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1",
                         (jid, fc["code"])))
    if c:
        conn.execute("UPDATE job_cases SET closed_at = NULL WHERE id = ?", (c["id"],))
        cid = c["id"]
    else:
        cid = insert(conn, "job_cases", {"job_id": jid, "product_id": fc["product_id"], "asset_id": fc["asset_id"],
                                         "code": fc["code"], "opened_by": actor_name() or "", "opened_at": now_iso()})
    conn.commit()
    res = check_lines(conn, jid, "out")
    res["open_case"] = next(x for x in res["cases"] if x["id"] == cid)
    return res


@route("PUT", r"/api/cases/(\d+)")
def api_case_put(req, conn, cid):
    c = one(conn.execute("SELECT * FROM job_cases WHERE id = ?", (cid,)))
    if not c:
        raise ApiError(404, "Flight case not found")
    d = req.json() or {}
    data = {}
    for k in ("label", "room"):
        if k in d:
            data[k] = as_str(d[k], k)[:120]
    if "closed" in d:
        data["closed_at"] = (c["closed_at"] or now_iso()) if d["closed"] else None
    if data:
        update(conn, "job_cases", c["id"], data)
        conn.commit()
    return check_lines(conn, c["job_id"], "out")


@route("DELETE", r"/api/cases/(\d+)")
def api_case_delete(req, conn, cid):
    """Unload a case: its items stay checked out, just not recorded as in a case."""
    c = one(conn.execute("SELECT * FROM job_cases WHERE id = ?", (cid,)))
    if not c:
        raise ApiError(404, "Flight case not found")
    conn.execute("UPDATE job_checks SET case_id = NULL WHERE case_id = ?", (c["id"],))
    conn.execute("DELETE FROM job_cases WHERE id = ?", (c["id"],))
    conn.commit()
    return check_lines(conn, c["job_id"], "out")


@route("PUT", r"/api/jobs/(\d+)/check/note")
def api_check_note(req, conn, jid):
    d = req.json() or {}
    direction = direction_of(d.get("dir") or "out")
    pid = as_int(d.get("product_id"), "product_id")
    note = as_str(d.get("note"), "note")[:1000]
    if note:
        conn.execute("INSERT INTO check_notes(job_id, direction, product_id, note, user_name, updated_at) VALUES(?, ?, ?, ?, ?, ?) "
                     "ON CONFLICT(job_id, direction, product_id) DO UPDATE SET note = excluded.note, "
                     "user_name = excluded.user_name, updated_at = excluded.updated_at",
                     (int(jid), direction, pid, note, actor_name(), now_iso()))
    else:
        conn.execute("DELETE FROM check_notes WHERE job_id = ? AND direction = ? AND product_id = ?", (int(jid), direction, pid))
    conn.commit()
    return check_lines(conn, int(jid), direction)


ACTIVE_STATUSES = ("provisional", "confirmed", "out", "returned")


def lookup_code(conn, code):
    """What a barcode is, and where it is: which job it's out on, and which jobs it's booked on."""
    asset = one(conn.execute("SELECT x.*, p.name AS product_name FROM assets x JOIN products p ON p.id = x.product_id "
                             "WHERE x.asset_number = ? COLLATE NOCASE", (code,)))
    if asset:
        pid = asset["product_id"]
    else:
        pr = one(conn.execute("SELECT id FROM products WHERE sku = ? COLLATE NOCASE AND sku != ''", (code,)))
        if not pr:
            raise ApiError(404, f"“{code}” doesn't match any asset number or item code")
        pid = pr["id"]
    p = one(conn.execute(PRODUCT_LIST_SQL + " WHERE p.id = ?", (pid,)))
    today = dt.date.today().isoformat()
    jobs = rows(conn.execute(
        "SELECT j.id, j.number, j.name, j.status, j.start_date, j.end_date, j.venue, SUM(ji.quantity) AS quantity "
        "FROM job_items ji JOIN jobs j ON j.id = ji.job_id WHERE ji.product_id = ? AND ji.kind = 'rental' "
        "AND j.status IN ('enquiry','quote','provisional','confirmed','out','returned') AND j.end_date >= ? "
        "GROUP BY j.id ORDER BY j.start_date", (pid, (dt.date.today() - dt.timedelta(days=60)).isoformat())))
    for j in jobs:
        q = lambda d: conn.execute("SELECT COALESCE(SUM(quantity), 0) FROM job_checks WHERE job_id = ? AND product_id = ? AND direction = ?",
                                   (j["id"], pid, d)).fetchone()[0]
        j["out"], j["in"] = q("out"), q("in")
        j["current"] = j["start_date"] <= today <= j["end_date"]
    out_on = None
    if asset:
        r = one(conn.execute(
            "SELECT c.job_id, c.created_at, c.user_name FROM job_checks c WHERE c.asset_id = ? AND c.direction = 'out' "
            "AND NOT EXISTS (SELECT 1 FROM job_checks i WHERE i.job_id = c.job_id AND i.asset_id = c.asset_id AND i.direction = 'in') "
            "ORDER BY c.id DESC LIMIT 1", (asset["id"],)))
        if r:
            j = one(conn.execute("SELECT id, number, name, status, start_date, end_date, venue FROM jobs WHERE id = ?", (r["job_id"],)))
            out_on = dict(j, since=r["created_at"], by=r["user_name"])
    quarantine = one(conn.execute("SELECT reason, started_at FROM quarantine WHERE released_at IS NULL AND "
                                  + ("asset_id = ?" if asset else "product_id = ? AND asset_id IS NULL"),
                                  (asset["id"] if asset else pid,)))
    return {"kind": "unit" if asset else "item", "code": asset["asset_number"] if asset else code,
            "asset": asset and {"id": asset["id"], "asset_number": asset["asset_number"], "serial_number": asset["serial_number"]},
            "product": {k: p[k] for k in ("id", "name", "brand", "sku", "category", "quantity", "image_id", "sub_hire", "parent_id")},
            "out_on": out_on, "jobs": jobs, "quarantine": quarantine}


@route("POST", "/api/scan")
def api_scan(req, conn):
    """The Scan page: mode 'lookup' changes nothing; mode 'in' checks the item back in to whichever job it went out on."""
    d = req.json() or {}
    code = as_str(d.get("code"), "code")
    if not code:
        raise ApiError(400, "Nothing scanned")
    mode = d.get("mode") or "lookup"
    info = lookup_code(conn, code)
    if mode == "lookup":
        info["result"] = "info"
        return info
    if mode != "in":
        raise ApiError(400, "Mode must be lookup or in")
    jid = as_int(d.get("job_id"), "job_id", allow_none=True)
    if not jid:
        if info["out_on"]:
            jid = info["out_on"]["id"]
        else:
            cands = [j for j in info["jobs"] if j["out"] > j["in"]]
            if not cands:
                info.update(result="error", message=f"{info['code']} — {info['product']['name']} isn't checked out on any job")
                return info
            if len(cands) > 1:
                info.update(result="choose", message=f"{info['product']['name']} is out on {len(cands)} jobs — which one is it coming back from?",
                            choices=cands)
                return info
            jid = cands[0]["id"]
    res = do_scan(conn, jid, "in", code)
    job = one(conn.execute("SELECT id, number, name, status FROM jobs WHERE id = ?", (jid,)))
    out = lookup_code(conn, code)
    out.update(result=res["result"], message=res["message"], job=job,
               job_progress={"done": res["done"], "needed": res["needed"]})
    return out


@route("POST", r"/api/jobs/(\d+)/check/adjust")
def api_check_adjust(req, conn, jid):
    jid = int(jid)
    d = req.json() or {}
    direction = direction_of(d.get("dir") or "out")
    pid = as_int(d.get("product_id"), "product_id", allow_none=True)
    lines = {l["product_id"]: l for l in check_lines(conn, jid, direction)["lines"]}
    targets = [pid] if pid else list(lines)
    for t in targets:
        line = lines.get(t)
        if not line:
            raise ApiError(404, "That item isn't on this job")
        if d.get("clear"):
            conn.execute("DELETE FROM job_checks WHERE job_id = ? AND direction = ? AND product_id = ?",
                         (jid, direction, t))
            continue
        delta = line["needed"] - line["done"] if d.get("all") else as_float(d.get("delta") or 0, "delta")
        if delta > 0:
            insert(conn, "job_checks", {"job_id": jid, "product_id": t, "direction": direction, "quantity": delta,
                                        "created_at": now_iso()})
        elif delta < 0:
            # Take back manual ticks first, then the most recent scans.
            remaining = -delta
            for c in rows(conn.execute("SELECT * FROM job_checks WHERE job_id = ? AND direction = ? AND product_id = ? "
                                       "ORDER BY (asset_id IS NOT NULL), id DESC", (jid, direction, t))):
                if remaining <= 0:
                    break
                if c["quantity"] <= remaining:
                    conn.execute("DELETE FROM job_checks WHERE id = ?", (c["id"],))
                    remaining -= c["quantity"]
                else:
                    conn.execute("UPDATE job_checks SET quantity = quantity - ? WHERE id = ?", (remaining, c["id"]))
                    remaining = 0
    conn.commit()
    return check_lines(conn, jid, direction)


@route("DELETE", r"/api/checks/(\d+)")
def api_check_delete(req, conn, cid):
    c = one(conn.execute("SELECT * FROM job_checks WHERE id = ?", (cid,)))
    if not c:
        raise ApiError(404, "Not found")
    conn.execute("DELETE FROM job_checks WHERE id = ?", (cid,))
    conn.commit()
    return check_lines(conn, c["job_id"], c["direction"])


# ---- cable runs

MAX_CABLES_PER_RUN = 8


def cable_types(conn):
    types = {}
    for r in conn.execute("SELECT id, name, cable_type, length_m, quantity, joiner_product_id, day_rate "
                          "FROM products WHERE archived = 0 AND item_type = 'cable' AND parent_id IS NOT NULL "
                          "AND length_m > 0 "
                          "ORDER BY length_m"):
        types.setdefault(r["cable_type"], []).append(dict(r))
    return types


# How many metres of spare cable one extra join is "worth" for each preference.
# Balanced so 24m from 3m + 10m cables gives 10+10+3+3 (2m spare), not 8 x 3m or 3 x 10m.
JOIN_COST_M = {"excess": 1.0, "joins": 3.0}


def best_run(cables, joiners, free, length, prefer="excess"):
    """Pick the cables for one run by scoring spare length against the number of joins."""
    ordered = sorted(cables, key=lambda c: -c["length_m"])
    cable_ids = {c["id"] for c in cables}
    join_cost = JOIN_COST_M.get(prefer, 1.0)
    best = None
    for k in range(1, MAX_CABLES_PER_RUN + 1):
        # Every extra cable adds a join; once joins alone cost more than the best score, stop.
        if best and (k - 1) * join_cost > best[0][0] + 1e-9:
            break
        for combo in itertools.combinations_with_replacement(ordered, k):
            chain = sorted(combo, key=lambda c: -c["length_m"])
            needs = {}
            total = 0.0
            for c in chain:
                needs[c["id"]] = needs.get(c["id"], 0) + 1
                total += c["length_m"]
            for c in chain[:-1]:  # every joint uses the joiner of the cable being extended
                j = c["joiner_product_id"]
                if j:
                    needs[j] = needs.get(j, 0) + 1
                    total += (joiners.get(j) or {}).get("length_m") or 0  # joiner cables add length, blocks don't
            if total + 1e-9 < length:
                continue
            if free is not None and any(free.get(pid, 0) < q for pid, q in needs.items()):
                continue
            spare = total - length
            joins = k - 1
            key = (round(spare + joins * join_cost, 3), joins, round(spare, 3))
            if best is None or key < best[0]:
                best = (key, chain, needs, total)
    if best:
        return {"chain": best[1], "needs": best[2], "total": best[3]}
    return None


def plan_cable_runs(conn, job, cable_type, length, runs, prefer="excess"):
    types = cable_types(conn)
    cables = types.get(cable_type)
    if not cables:
        raise ApiError(400, f"No {cable_type} cables with a length are set up in stock yet")
    jids = {c["joiner_product_id"] for c in cables if c["joiner_product_id"]}
    joiners = {}
    if jids:
        marks = ",".join("?" for _ in jids)
        joiners = {r["id"]: dict(r) for r in conn.execute(
            f"SELECT id, name, length_m, cable_type FROM products WHERE id IN ({marks})", list(jids))}
    avail = {a["product_id"]: a["available"] for a in
             availability_summary(conn, job["start_date"], job["end_date"], exclude_job=job["id"])}
    for it in job["items"]:
        if it["kind"] == "rental" and it["product_id"] in avail:
            avail[it["product_id"]] -= it["quantity"] or 0
    free = {pid: max(0, int(math.floor(v))) for pid, v in avail.items()}
    plans, short_runs = [], 0
    for _ in range(runs):
        plan = best_run(cables, joiners, free, length, prefer)
        if plan:
            for pid, q in plan["needs"].items():
                free[pid] -= q
        else:
            plan = best_run(cables, joiners, None, length, prefer)  # plan anyway; shows as a shortage
            if not plan:
                raise ApiError(400, f"Can't reach {fmt_num(length)}m with up to {MAX_CABLES_PER_RUN} "
                                    f"{cable_type} cables — add longer cables to stock")
            plan["short"] = True
            short_runs += 1
        plans.append(plan)
    names = {c["id"]: c for c in cables}
    names.update(joiners)
    groups = {}
    for pl in plans:
        key = tuple(sorted(pl["needs"].items()))
        g = groups.setdefault(key, {"runs": 0, "needs": pl["needs"], "total": pl["total"], "short": False,
                                    "chain": [c["length_m"] for c in pl["chain"]], "end": pl["chain"][-1]["id"]})
        g["runs"] += 1
        g["short"] = g["short"] or pl.get("short", False)
    out = []
    for g in groups.values():
        counts = {}
        for x in g["chain"]:
            counts[x] = counts.get(x, 0) + 1
        parts = [f"{n} × {fmt_num(x)}m" for x, n in sorted(counts.items(), key=lambda kv: -kv[0])]
        lengths = ", ".join(parts)
        joints = [(pid, q) for pid, q in g["needs"].items() if pid in joiners and pid not in {c["id"] for c in cables}]
        jtxt = "".join(f", {q} × {names[pid]['name']}" for pid, q in joints)
        parts += [f"{q} × {names[pid]['name']}" for pid, q in joints]
        spare = round(g["total"] - length, 2)
        total_txt = f" = {fmt_num(round(g['total'], 2))}m" if len(g["chain"]) > 1 or joints else ""
        spare_txt = f" ({fmt_num(spare)}m spare)" if spare > 0 else " (exact)"
        out.append({
            "runs": g["runs"], "total_m": round(g["total"], 2), "short": g["short"], "spare_m": spare,
            "end_product_id": g["end"],
            "summary": f"{lengths}{jtxt}{total_txt}{spare_txt}",
            "parts": parts, "result": f"{fmt_num(round(g['total'], 2))}m{spare_txt}",
            "items": [{"product_id": pid, "name": names[pid]["name"], "per_run": q}
                      for pid, q in sorted(g["needs"].items(), key=lambda kv: -(names[kv[0]].get("length_m") or 0))],
        })
    return {"cable_type": cable_type, "length": length, "runs": runs, "groups": out, "short_runs": short_runs,
            "cables_used": sum(i["per_run"] * g["runs"] for g in out for i in g["items"] if i["product_id"] in
                               {c["id"] for c in cables})}


@route("GET", "/api/cable-types")
def api_cable_types(req, conn):
    return [{"type": t, "cables": cs} for t, cs in sorted(cable_types(conn).items())]


@route("POST", r"/api/jobs/(\d+)/cable-run")
def api_cable_run(req, conn, jid):
    jid = int(jid)
    job = job_detail(conn, jid)
    d = req.json() or {}
    ctype = as_str(d.get("cable_type"), "cable_type")
    length = as_float(d.get("length"), "length")
    runs = as_int(d.get("runs") or 1, "runs")
    section = as_int(d.get("section_id"), "section_id", allow_none=True)
    check_section(conn, jid, section)
    if length <= 0:
        raise ApiError(400, "Enter the length you need, in metres")
    if not 1 <= runs <= 100:
        raise ApiError(400, "Number of runs must be between 1 and 100")
    prefer = as_str(d.get("prefer"), "prefer") or get_settings(conn).get("cable_run_preference") or "excess"
    if prefer not in ("excess", "joins"):
        raise ApiError(400, "prefer must be 'excess' or 'joins'")
    plan = plan_cable_runs(conn, job, ctype, length, runs, prefer)
    plan["prefer"] = prefer
    if d.get("dry_run"):
        return plan
    sort = (conn.execute("SELECT COALESCE(MAX(sort), 0) FROM job_items WHERE job_id = ?", (jid,)).fetchone()[0] or 0) + 1
    rates = {r["id"]: r["day_rate"] for r in conn.execute("SELECT id, day_rate FROM products")}
    for g in plan["groups"]:
        parent = insert(conn, "job_items", {
            "job_id": jid, "kind": "rental", "description": f"{ctype} run {fmt_num(length)}m",
            "quantity": g["runs"], "unit_price": 0, "sort": sort, "section_id": section,
            "meta": json.dumps({"type": "cable_run", "cable_type": ctype, "length": length,
                                "summary": g["summary"], "end_product_id": g["end_product_id"]})})
        for i in g["items"]:
            insert(conn, "job_items", {
                "job_id": jid, "product_id": i["product_id"], "kind": "rental", "description": i["name"],
                "quantity": g["runs"] * i["per_run"], "accessory_qty": i["per_run"],
                "unit_price": rates.get(i["product_id"], 0), "sort": sort, "parent_item_id": parent,
                "section_id": section})
        sort += 1
    conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), jid))
    conn.commit()
    out = job_detail(conn, jid)
    out["cable_plan"] = plan
    return out


# ---- stage decks

MAX_STAGE_GRID = 120   # grid cells per side
DECK_WEIGHT_STEPS = 6  # tries at steering away from decks that are short


def stage_decks(conn):
    return rows(conn.execute(
        "SELECT id, name, sku, deck_w, deck_d, quantity, day_rate, weight_kg FROM products "
        "WHERE archived = 0 AND item_type = 'equipment' AND deck_w > 0 AND deck_d > 0 "
        "ORDER BY deck_w * deck_d DESC, name"))


def tile_rect(W, D, shapes, weight):
    """Guillotine DP: cheapest exact cover of every rectangle up to W x D grid cells.

    shapes: {(w, d): deck_id} (both orientations). Returns (cost table, choice table)."""
    INF = float("inf")
    cost = [[INF] * (D + 1) for _ in range(W + 1)]
    choice = [[None] * (D + 1) for _ in range(W + 1)]
    for w in range(1, W + 1):
        cw, chw = cost[w], choice[w]
        for d in range(1, D + 1):
            best, pick = INF, None
            sid = shapes.get((w, d))
            if sid is not None:
                best, pick = weight[sid], ("deck", sid)
            for i in range(1, w // 2 + 1):
                c = cost[i][d] + cost[w - i][d]
                if c < best - 1e-9:
                    best, pick = c, ("v", i)
            for j in range(1, d // 2 + 1):
                c = cw[j] + cw[d - j]
                if c < best - 1e-9:
                    best, pick = c, ("h", j)
            cw[d], chw[d] = best, pick
    return cost, choice


def unpack(choice, x, y, w, d, out):
    pick = choice[w][d]
    if pick[0] == "deck":
        out.append((x, y, w, d, pick[1]))
    elif pick[0] == "v":
        unpack(choice, x, y, pick[1], d, out)
        unpack(choice, x + pick[1], y, w - pick[1], d, out)
    else:
        unpack(choice, x, y, w, pick[1], out)
        unpack(choice, x, y + pick[1], w, d - pick[1], out)


def zone_search(decks, shapes, cm, unit, W, D, want_w, want_d, free, count, best, better, budget=2.5):
    t_end = time.time() + budget
    base = {dk["id"]: 1.0 for dk in decks}
    tables = {}

    def table(banned):
        if banned not in tables:
            sh = {}
            for dk in decks:
                if dk["id"] in banned:
                    continue
                a_, b_ = cm(dk["deck_w"]) // unit, cm(dk["deck_d"]) // unit
                sh.setdefault((a_, b_), dk["id"])
                sh.setdefault((b_, a_), dk["id"])
            tables[banned] = tile_rect(W, D, sh, base) if sh else None
        return tables[banned]

    def count_need(placed):
        need = {}
        for p_ in placed:
            need[p_[4]] = need.get(p_[4], 0) + 1
        return need

    def shortage(need):
        return {k: v * count - free.get(k, 0) for k, v in need.items() if v * count > free.get(k, 0)}

    memo = {}

    def fix(w, d, banned, depth):
        """Best placements (relative to 0,0) for a w x d zone without the banned decks."""
        key = (w, d, banned, depth)
        if key in memo:
            return memo[key]
        t = table(banned)
        if not t or t[0][w][d] == float("inf"):
            memo[key] = None
            return None
        placed = []
        unpack(t[1], 0, 0, w, d, placed)
        res = placed
        sh = shortage(count_need(placed))
        if sh and depth > 0 and time.time() < t_end:
            for k in sorted(sh, key=lambda x: -sh[x]):
                nb = banned | {k}
                if not table(nb):
                    continue
                for axis in ("v", "h"):
                    for cut in range(0, (w if axis == "v" else d) + 1):
                        if time.time() > t_end:
                            break
                        A = (cut, d) if axis == "v" else (w, cut)
                        Bz = (w - cut, d) if axis == "v" else (w, d - cut)
                        off = (cut, 0) if axis == "v" else (0, cut)
                        pa = []
                        if A[0] and A[1]:
                            if t[0][A[0]][A[1]] == float("inf"):
                                continue
                            unpack(t[1], 0, 0, A[0], A[1], pa)
                        pb = []
                        if Bz[0] and Bz[1]:
                            sub = fix(Bz[0], Bz[1], nb, depth - 1)
                            if sub is None:
                                continue
                            pb = [(x + off[0], y + off[1], ww, dd, k_) for x, y, ww, dd, k_ in sub]
                        cand = pa + pb
                        cs, rs = shortage(count_need(cand)), shortage(count_need(res))
                        if (sum(cs.values()), len(cand)) < (sum(rs.values()), len(res)):
                            res = cand
        memo[key] = res
        return res

    sizes = sorted(((w, d) for w in range(want_w, W + 1) for d in range(want_d, D + 1)),
                   key=lambda wd: (wd[0] * wd[1], wd[0] + wd[1]))[:6]
    out = best
    for (w, d) in sizes:
        if time.time() > t_end:
            break
        placed = fix(w, d, frozenset(), len(decks))
        if placed is None:
            continue
        need = count_need(placed)
        c = {"w": w, "d": d, "placed": placed, "need": need, "short": shortage(need)}
        if better(c, out):
            out = c
        if not out["short"]:
            break
    return out


def plan_stage(conn, job, width, depth, count, deck_ids=None, exclude_job=True):
    decks = [dk for dk in stage_decks(conn) if not deck_ids or dk["id"] in deck_ids]
    if not decks:
        raise ApiError(400, "No stage decks set up yet — in Stock, give your decks a width and depth")
    cm = lambda m: int(round(m * 100))
    unit = 0
    for dk in decks:
        unit = math.gcd(unit, math.gcd(cm(dk["deck_w"]), cm(dk["deck_d"])))
    unit = max(unit, 1)
    want_w, want_d = math.ceil(cm(width) / unit - 1e-9), math.ceil(cm(depth) / unit - 1e-9)
    biggest = max(max(cm(dk["deck_w"]), cm(dk["deck_d"])) // unit for dk in decks)
    W, D = want_w + biggest, want_d + biggest
    if W > MAX_STAGE_GRID or D > MAX_STAGE_GRID:
        raise ApiError(400, "That stage is too big for these deck sizes — try a smaller size")
    shapes = {}
    for dk in decks:  # bigger decks first, so they win ties for the same shape
        a, b = cm(dk["deck_w"]) // unit, cm(dk["deck_d"]) // unit
        shapes.setdefault((a, b), dk["id"])
        shapes.setdefault((b, a), dk["id"])
    # How many of each deck are free on the job's dates (after what's already on this job).
    avail = {a["product_id"]: a["available"] for a in
             availability_summary(conn, job["start_date"], job["end_date"], exclude_job=job["id"])}
    for it in job["items"]:
        if it["kind"] == "rental" and it["product_id"] in avail:
            avail[it["product_id"]] -= it["quantity"] or 0
    free = {dk["id"]: max(0, math.floor(avail.get(dk["id"], 0))) for dk in decks}
    by_id = {dk["id"]: dk for dk in decks}
    def solve(weight):
        cost, choice = tile_rect(W, D, shapes, weight)
        size = None  # the smallest buildable size that covers what was asked for
        for w in range(want_w, W + 1):
            for d in range(want_d, D + 1):
                if cost[w][d] < float("inf"):
                    key = (w * d, cost[w][d], w + d)
                    if size is None or key < size[0]:
                        size = (key, w, d)
        if not size:
            return None
        _, w, d = size
        placed = []
        unpack(choice, 0, 0, w, d, placed)
        need = {}
        for p in placed:
            need[p[4]] = need.get(p[4], 0) + 1
        short = {k: v * count - free.get(k, 0) for k, v in need.items() if v * count > free.get(k, 0)}
        return {"w": w, "d": d, "placed": placed, "need": need, "short": short}

    def better(a, b):
        if b is None:
            return True
        if a["w"] * a["d"] != b["w"] * b["d"]:
            return a["w"] * a["d"] < b["w"] * b["d"]
        if bool(a["short"]) != bool(b["short"]):
            return not a["short"]
        if a["short"]:
            return sum(a["short"].values()) < sum(b["short"].values())
        return sum(a["need"].values()) < sum(b["need"].values())

    weight = {dk["id"]: 1.0 for dk in decks}
    best = solve(weight)
    # Not enough of a deck size? Make it gradually "dearer" until the plan fits the stock that's free.
    for _ in range(DECK_WEIGHT_STEPS):
        if not best or not best["short"]:
            break
        for k in list(best["short"]):
            lo, hi = weight[k], weight[k] * 64
            for _step in range(12):
                mid = (lo + hi) / 2
                trial = dict(weight)
                trial[k] = mid
                c = solve(trial)
                if c and c["need"].get(k, 0) * count <= free.get(k, 0):
                    hi = mid
                    if better(c, best):
                        best = c
                else:
                    lo = mid
            weight[k] = hi
        c = solve(weight)
        if c and better(c, best):
            best = c
    if best and best["short"]:
        # Still short: split the stage into zones. One zone is laid with the usual decks; the rest is laid
        # without the deck that's short - and that rest can be split again for the next short deck.
        best = zone_search(decks, shapes, cm, unit, W, D, want_w, want_d, free, count, best, better) or best
    if not best:
        raise ApiError(400, "These decks can't make that shape — add a smaller deck size to stock")
    u = unit / 100.0
    layout = [{"x": round(x * u, 3), "y": round(y * u, 3), "w": round(w_ * u, 3), "d": round(d_ * u, 3),
               "deck_id": k, "rotated": round(w_ * u, 3) != by_id[k]["deck_w"]} for x, y, w_, d_, k in best["placed"]]
    items = [{"product_id": k, "name": by_id[k]["name"], "per_stage": n,
              "size": f"{fmt_num(by_id[k]['deck_w'])} × {fmt_num(by_id[k]['deck_d'])}m",
              "free": free.get(k, 0), "short": best["short"].get(k, 0)}
             for k, n in sorted(best["need"].items(), key=lambda kv: -(by_id[kv[0]]["deck_w"] * by_id[kv[0]]["deck_d"]))]
    actual_w, actual_d = round(best["w"] * u, 3), round(best["d"] * u, 3)
    return {
        "asked_w": width, "asked_d": depth, "width": actual_w, "depth": actual_d, "count": count,
        "rounded": abs(actual_w - width) > 0.001 or abs(actual_d - depth) > 0.001,
        "area": round(actual_w * actual_d, 2), "decks_per_stage": sum(best["need"].values()),
        "items": items, "layout": layout, "short": bool(best["short"]),
        "summary": ", ".join(f"{i['per_stage']} × {i['size']}" for i in items),
    }


SIDES = ("front", "left", "right", "back")


def clamp_points(layout):
    """Every place two decks meet: one point per started metre of shared edge, evenly spaced."""
    pts = []
    eps = 1e-6
    for i, a in enumerate(layout):
        for b in layout[i + 1:]:
            # side by side (shared vertical edge)
            for l, r in ((a, b), (b, a)):
                if abs(l["x"] + l["w"] - r["x"]) < eps:
                    y0, y1 = max(l["y"], r["y"]), min(l["y"] + l["d"], r["y"] + r["d"])
                    if y1 - y0 > eps:
                        n = max(1, math.ceil(round(y1 - y0, 3) - 1e-9))
                        pts += [(round(r["x"], 3), round(y0 + (y1 - y0) * (k + 0.5) / n, 3)) for k in range(n)]
            # front to back (shared horizontal edge)
            for t, u in ((a, b), (b, a)):
                if abs(t["y"] + t["d"] - u["y"]) < eps:
                    x0, x1 = max(t["x"], u["x"]), min(t["x"] + t["w"], u["x"] + u["w"])
                    if x1 - x0 > eps:
                        n = max(1, math.ceil(round(x1 - x0, 3) - 1e-9))
                        pts += [(round(x0 + (x1 - x0) * (k + 0.5) / n, 3), round(u["y"], 3)) for k in range(n)]
    return sorted(set(pts))


def skirt_items(conn):
    out = rows(conn.execute(
        "SELECT id, name, skirt_len, skirt_height, skirt_style, skirt_colour, quantity, day_rate FROM products "
        "WHERE archived = 0 AND skirt_len > 0 ORDER BY skirt_height, skirt_style, skirt_colour, skirt_len DESC, name"))
    for it in out:
        if not it["skirt_height"]:  # not filled in: take it from the name, e.g. "Stage Skirt 40cm × 3m"
            m = re.search(r"(\d+(?:\.\d+)?)\s*cm\b", it["name"], re.I)
            it["skirt_height"] = float(m.group(1)) if m else None
        it["skirt_style"] = (it["skirt_style"] or "").strip()
        it["skirt_colour"] = (it["skirt_colour"] or "").strip()
    return out


SKIRT_FILTER_KEYS = ("height", "style", "colour")


def skirt_filter(d):
    """{height, style, colour} chosen for a stage's skirts (blank = any)."""
    f = {}
    h = d.get("skirt_height")
    if h not in (None, ""):
        f["height"] = as_float(h, "skirt_height")
    for k in ("style", "colour"):
        v = str(d.get("skirt_" + k) or "").strip()
        if v:
            f[k] = v
    return f


def skirt_matches(it, f):
    if f.get("height") is not None and abs((it["skirt_height"] or 0) - f["height"]) > 0.01:
        return False
    for k in ("style", "colour"):
        if f.get(k) and it["skirt_" + k].lower() != f[k].lower():
            return False
    return True


def cover_length(length, lengths):
    """Fewest skirt pieces that cover a side, then the least overlap: returns {length: count}."""
    lengths = sorted(set(lengths), reverse=True)
    if not lengths or length <= 0:
        return {}
    n = max(1, math.ceil(length / lengths[0] - 1e-9))
    best = None
    for k in range(n, n + 3):
        for combo in itertools.combinations_with_replacement(lengths, k):
            total = sum(combo)
            if total + 1e-9 >= length and (best is None or total < best[0] - 1e-9):
                best = (total, combo)
        if best:
            break
    out = {}
    for x in best[1]:
        out[x] = out.get(x, 0) + 1
    return out


def plan_skirts(conn, width, depth, sides, skirt_ids, count=1, filt=None):
    sides = [s_ for s_ in SIDES if s_ in (sides or [])]
    stock = skirt_items(conn)
    items = [it for it in stock if (not skirt_ids or it["id"] in skirt_ids) and skirt_matches(it, filt or {})]
    if sides and stock and not items:
        raise ApiError(400, "None of your skirts match that height, style and colour")
    if not sides or not items:
        return None
    by_len = {}
    for it in items:  # one product per length (the first, i.e. the one with most stock wins ties by name order)
        by_len.setdefault(round(it["skirt_len"], 3), it)
    side_len = {"front": width, "back": width, "left": depth, "right": depth}
    per_side, need = [], {}
    for sd in sides:
        cover = cover_length(side_len[sd], list(by_len))
        per_side.append({"side": sd, "length": side_len[sd],
                         "pieces": [{"length": ln, "count": c} for ln, c in sorted(cover.items(), reverse=True)]})
        for ln, c in cover.items():
            pid = by_len[ln]["id"]
            need[pid] = need.get(pid, 0) + c
    names = {it["id"]: it for it in items}
    return {
        "sides": sides, "perimeter": round(sum(side_len[x] for x in sides), 3), "per_side": per_side,
        "filter": filt or {},
        "items": [{"product_id": pid, "name": names[pid]["name"], "length": names[pid]["skirt_len"],
                   "per_stage": c, "owned": names[pid]["quantity"]}
                  for pid, c in sorted(need.items(), key=lambda kv: -names[kv[0]]["skirt_len"])],
    }


def set_role_line(conn, parent, role, product_id, per_stage, description=None):
    """Create, update or remove the single child line of a stage that plays `role` (clamps, skirt:<id>, ...)."""
    rows_ = rows(conn.execute("SELECT * FROM job_items WHERE parent_item_id = ? AND meta LIKE ?",
                              (parent["id"], f'%"role": "{role}"%')))
    if not product_id or per_stage <= 0:
        for r in rows_:
            conn.execute("DELETE FROM job_items WHERE id = ? OR parent_item_id = ?", (r["id"], r["id"]))
        return
    p = one(conn.execute("SELECT id, name, day_rate FROM products WHERE id = ?", (product_id,)))
    if not p:
        raise ApiError(400, "Item not found")
    qty = (parent["quantity"] or 1) * per_stage
    if rows_:
        conn.execute("UPDATE job_items SET product_id = ?, description = ?, quantity = ?, accessory_qty = ?, "
                     "unit_price = CASE WHEN product_id = ? THEN unit_price ELSE ? END WHERE id = ?",
                     (p["id"], description or p["name"], qty, per_stage, p["id"], p["day_rate"], rows_[0]["id"]))
        for r in rows_[1:]:
            conn.execute("DELETE FROM job_items WHERE id = ?", (r["id"],))
    else:
        insert(conn, "job_items", {
            "job_id": parent["job_id"], "product_id": p["id"], "kind": "rental", "description": description or p["name"],
            "quantity": qty, "accessory_qty": per_stage, "unit_price": p["day_rate"], "sort": parent["sort"],
            "parent_item_id": parent["id"], "section_id": parent["section_id"],
            "meta": json.dumps({"role": role})})


def apply_stage_extras(conn, parent, meta, clamp_product, points, sides, skirt_ids, filt=None):
    # clamps
    valid = set(clamp_points(meta.get("layout") or []))
    chosen = []
    for pt in points or []:
        try:
            x, y = round(float(pt[0]), 3), round(float(pt[1]), 3)
        except (TypeError, ValueError, IndexError):
            raise ApiError(400, "Clamp positions are invalid")
        match = next((v for v in valid if abs(v[0] - x) < 0.02 and abs(v[1] - y) < 0.02), None)
        if not match:
            raise ApiError(400, "A clamp isn't on a joint between decks")
        if match not in chosen:
            chosen.append(match)
    if chosen and not clamp_product:
        raise ApiError(400, "Choose which clamp to use")
    meta["clamps"] = {"product_id": clamp_product if chosen else None, "points": [list(p_) for p_ in chosen]}
    set_role_line(conn, parent, "clamps", clamp_product, len(chosen))
    # skirts
    sk = plan_skirts(conn, meta["width"], meta["depth"], sides, skirt_ids, filt=filt)
    meta["skirts"] = sk and {"sides": sk["sides"], "skirt_ids": skirt_ids or [], "per_side": sk["per_side"],
                             "perimeter": sk["perimeter"], "filter": sk["filter"]}
    used = set()
    for it in (sk["items"] if sk else []):
        set_role_line(conn, parent, f"skirt:{it['product_id']}", it["product_id"], it["per_stage"])
        used.add(it["product_id"])
    for r in rows(conn.execute("SELECT id, meta FROM job_items WHERE parent_item_id = ? AND meta LIKE '%\"role\": \"skirt:%'",
                               (parent["id"],))):
        role = json.loads(r["meta"])["role"]
        if int(role.split(":")[1]) not in used:
            conn.execute("DELETE FROM job_items WHERE id = ?", (r["id"],))
    conn.execute("UPDATE job_items SET meta = ? WHERE id = ?", (json.dumps(meta), parent["id"]))


@route("GET", "/api/equip-kinds")
def api_equip_kinds(req, conn):
    return [{"key": k, "label": v[0], "help": v[1], "fields": sorted(v[2])} for k, v in EQUIP_KINDS.items()]


@route("GET", "/api/stage-extras")
def api_stage_extras_list(req, conn):
    clamps = rows(conn.execute(
        "SELECT id, name, quantity FROM products WHERE archived = 0 AND item_type = 'equipment' "
        "AND (name LIKE '%clamp%' OR category LIKE '%clamp%') ORDER BY name"))
    return {"clamps": clamps, "skirts": skirt_items(conn)}


@route("PUT", r"/api/stages/(\d+)")
def api_stage_put(req, conn, iid):
    parent = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (iid,)))
    meta = json.loads(parent["meta"]) if parent and parent["meta"] else {}
    if not parent or meta.get("type") != "stage":
        raise ApiError(404, "Stage not found")
    d = req.json() or {}
    clamp = as_int(d.get("clamp_product_id"), "clamp_product_id", allow_none=True)
    apply_stage_extras(conn, parent, meta, clamp, d.get("clamp_points") or [],
                       d.get("skirt_sides") or [], [int(x) for x in (d.get("skirt_ids") or [])], skirt_filter(d))
    conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), parent["job_id"]))
    conn.commit()
    return job_detail(conn, parent["job_id"])


@route("GET", "/api/stage-decks")
def api_stage_decks(req, conn):
    return stage_decks(conn)


@route("POST", r"/api/jobs/(\d+)/stage")
def api_stage(req, conn, jid):
    jid = int(jid)
    job = job_detail(conn, jid)
    d = req.json() or {}
    width, depth = as_float(d.get("width"), "width"), as_float(d.get("depth"), "depth")
    count = as_int(d.get("count") or 1, "count")
    if width <= 0 or depth <= 0:
        raise ApiError(400, "Enter the stage width and depth in metres")
    if not 1 <= count <= 50:
        raise ApiError(400, "Number of stages must be between 1 and 50")
    deck_ids = [int(x) for x in (d.get("deck_ids") or [])]
    legs_id = as_int(d.get("legs_product_id"), "legs_product_id", allow_none=True)
    legs_per = as_float(d.get("legs_per_deck") or 0, "legs_per_deck")
    height = as_str(d.get("height"), "height")
    section = as_int(d.get("section_id"), "section_id", allow_none=True)
    check_section(conn, jid, section)
    plan = plan_stage(conn, job, width, depth, count, deck_ids)
    if legs_id and legs_per > 0:
        lp = one(conn.execute("SELECT id, name FROM products WHERE id = ?", (legs_id,)))
        if not lp:
            raise ApiError(400, "Leg item not found")
        plan["legs"] = {"product_id": lp["id"], "name": lp["name"],
                        "per_stage": int(math.ceil(plan["decks_per_stage"] * legs_per - 1e-9))}
    sides = [x for x in (d.get("skirt_sides") or []) if x in SIDES]
    skirt_ids = [int(x) for x in (d.get("skirt_ids") or [])]
    filt = skirt_filter(d)
    plan["skirts"] = plan_skirts(conn, plan["width"], plan["depth"], sides, skirt_ids, filt=filt)
    plan["joints"] = len(clamp_points(plan["layout"]))
    if d.get("dry_run"):
        return plan
    sort = (conn.execute("SELECT COALESCE(MAX(sort), 0) FROM job_items WHERE job_id = ?", (jid,)).fetchone()[0] or 0) + 1
    rates = {r["id"]: r["day_rate"] for r in conn.execute("SELECT id, day_rate FROM products")}
    title = f"Stage {fmt_num(plan['width'])}m × {fmt_num(plan['depth'])}m" + (f" @ {height}" if height else "")
    parent = insert(conn, "job_items", {
        "job_id": jid, "kind": "rental", "description": title, "quantity": count, "unit_price": 0,
        "sort": sort, "section_id": section,
        "meta": json.dumps({"type": "stage", "width": plan["width"], "depth": plan["depth"], "height": height,
                            "summary": plan["summary"], "layout": plan["layout"],
                            "deck_names": {str(i["product_id"]): i["size"] for i in plan["items"]}})})
    for i in plan["items"]:
        child = insert(conn, "job_items", {
            "job_id": jid, "product_id": i["product_id"], "kind": "rental", "description": i["name"],
            "quantity": count * i["per_stage"], "accessory_qty": i["per_stage"],
            "unit_price": rates.get(i["product_id"], 0), "sort": sort, "parent_item_id": parent,
            "section_id": section})
        add_accessories(conn, child)  # anything linked to the deck itself (e.g. its own legs or clamps)
    if plan.get("legs"):
        lg = plan["legs"]
        insert(conn, "job_items", {
            "job_id": jid, "product_id": lg["product_id"], "kind": "rental", "description": lg["name"],
            "quantity": count * lg["per_stage"], "accessory_qty": lg["per_stage"],
            "unit_price": rates.get(lg["product_id"], 0), "sort": sort, "parent_item_id": parent,
            "section_id": section, "meta": json.dumps({"role": "legs"})})
    prow = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (parent,)))
    clamp = as_int(d.get("clamp_product_id"), "clamp_product_id", allow_none=True)
    points = clamp_points(plan["layout"]) if (clamp and d.get("clamp_all")) else []
    apply_stage_extras(conn, prow, json.loads(prow["meta"]), clamp, points, sides, skirt_ids, filt)
    conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), jid))
    conn.commit()
    out = job_detail(conn, jid)
    out["stage_plan"] = plan
    return out


# ---- job items

def linked_qty(parent_qty, per_unit):
    """Linked items come in whole numbers: 0.5 receivers per mic for 3 mics = 2 receivers."""
    return float(math.ceil((parent_qty or 0) * (per_unit or 0) - 1e-9))


def add_accessories(conn, parent_id, ancestors=None, depth=0, skip=None, free=False):
    """Create linked-item lines for a new stock line - and their linked items, and so on.
    skip: items to leave out (a package's removed items); free: everything is covered by a package price."""
    parent = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (parent_id,)))
    ancestors = (ancestors or set()) | {parent["product_id"]}
    if depth >= MAX_LINK_DEPTH:
        return
    links = rows(conn.execute(
        """SELECT a.quantity AS per_unit, a.charged, p.id, p.name, p.day_rate
           FROM product_accessories a JOIN products p ON p.id = a.accessory_id
           WHERE a.product_id = ? AND p.archived = 0 ORDER BY a.sort, a.id""", (parent["product_id"],)))
    for ln in links:
        if ln["id"] in ancestors or (skip and ln["id"] in skip):
            continue
        child = insert(conn, "job_items", {
            "job_id": parent["job_id"], "product_id": ln["id"], "kind": "rental",
            "description": ln["name"], "quantity": linked_qty(parent["quantity"], ln["per_unit"]),
            "accessory_qty": ln["per_unit"], "unit_price": ln["day_rate"] if ln["charged"] and not free else 0,
            "days": parent["days"], "sort": parent["sort"], "parent_item_id": parent_id,
            "section_id": parent["section_id"],
        })
        add_accessories(conn, child, ancestors, depth + 1, skip, free)


def sync_accessories(conn, parent_id, depth=0):
    """Keep linked lines (at every level) in step with their parent's quantity and days."""
    parent = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (parent_id,)))
    if not parent or depth > MAX_LINK_DEPTH + 1:
        return
    for c in rows(conn.execute("SELECT id, accessory_qty FROM job_items WHERE parent_item_id = ?", (parent_id,))):
        if c["accessory_qty"] is not None:
            conn.execute("UPDATE job_items SET quantity = ?, days = ? WHERE id = ?",
                         (linked_qty(parent["quantity"], c["accessory_qty"]), parent["days"], c["id"]))
        sync_accessories(conn, c["id"], depth + 1)


def descendants(conn, iid):
    out, todo = [], [int(iid)]
    while todo:
        x = todo.pop()
        kids = [r[0] for r in conn.execute("SELECT id FROM job_items WHERE parent_item_id = ?", (x,))]
        out.extend(kids)
        todo.extend(kids)
    return out


@route("POST", r"/api/jobs/(\d+)/items")
def api_items_post(req, conn, jid):
    jid = int(jid)
    if not conn.execute("SELECT 1 FROM jobs WHERE id = ?", (jid,)).fetchone():
        raise ApiError(404, "Job not found")
    body = req.json() or {}
    data = clean(body, ITEM_SPEC)
    data.setdefault("kind", "rental")
    check_section(conn, jid, data.get("section_id"))
    if data.get("product_id"):
        p = one(conn.execute("SELECT * FROM products WHERE id = ?", (data["product_id"],)))
        if not p:
            raise ApiError(400, "Product not found")
        data["kind"] = "rental" if "kind" not in body else data["kind"]
        if not data.get("description"):
            data["description"] = p["name"]
        if "unit_price" not in body:
            data["unit_price"] = p["day_rate"]
        # Adding a product already on the job increases that line instead.
        if data["kind"] == "rental" and body.get("merge", True):
            existing = one(conn.execute(
                "SELECT * FROM job_items WHERE job_id = ? AND product_id = ? AND kind = 'rental' "
                "AND parent_item_id IS NULL AND section_id IS ? AND (meta IS NULL OR meta = '') ORDER BY id LIMIT 1",
                (jid, data["product_id"], data.get("section_id"))))
            if existing:
                conn.execute("UPDATE job_items SET quantity = quantity + ? WHERE id = ?",
                             (data.get("quantity", 1) if "quantity" in body else 1, existing["id"]))
                sync_accessories(conn, existing["id"])
                conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), jid))
                conn.commit()
                return job_detail(conn, jid)
    if "quantity" not in body:
        data["quantity"] = 1
    if "sort" not in body:
        data["sort"] = (conn.execute("SELECT COALESCE(MAX(sort), 0) FROM job_items WHERE job_id = ?",
                                     (jid,)).fetchone()[0] or 0) + 1
    data["job_id"] = jid
    new_id = insert(conn, "job_items", data)
    if data.get("product_id") and data["kind"] == "rental" and p["item_type"] == "package":
        add_package(conn, new_id)
    elif data.get("product_id") and data["kind"] == "rental" and body.get("accessories", True):
        add_accessories(conn, new_id)
    conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), jid))
    conn.commit()
    return job_detail(conn, jid)


@route("PUT", r"/api/items/(\d+)")
def api_item_put(req, conn, iid):
    it = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (iid,)))
    if not it:
        raise ApiError(404, "Line not found")
    data = clean(req.json(), ITEM_SPEC, partial=True)
    if "section_id" in data:
        check_section(conn, it["job_id"], data["section_id"])
        for d in descendants(conn, iid):
            conn.execute("UPDATE job_items SET section_id = ? WHERE id = ?", (data["section_id"], d))
    update(conn, "job_items", iid, data)
    if "quantity" in data or "days" in data:
        if it["parent_item_id"] and "quantity" in data:
            # Editing a linked item's quantity changes its per-unit ratio.
            parent = one(conn.execute("SELECT quantity FROM job_items WHERE id = ?", (it["parent_item_id"],)))
            if parent and parent["quantity"]:
                conn.execute("UPDATE job_items SET accessory_qty = ? WHERE id = ?",
                             (data["quantity"] / parent["quantity"], iid))
        sync_accessories(conn, int(iid))
        clamp_sub_hire(conn, it["job_id"])
    conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (now_iso(), it["job_id"]))
    conn.commit()
    return job_detail(conn, it["job_id"])


@route("DELETE", r"/api/items/(\d+)")
def api_item_delete(req, conn, iid):
    it = one(conn.execute("SELECT * FROM job_items WHERE id = ?", (iid,)))
    if not it:
        raise ApiError(404, "Line not found")
    for d in [int(iid)] + descendants(conn, iid):
        conn.execute("DELETE FROM job_items WHERE id = ?", (d,))
    conn.commit()
    return job_detail(conn, it["job_id"])


# ---- availability

@route("GET", "/api/availability")
def api_availability(req, conn):
    start = req.q("start") or dt.date.today().isoformat()
    end = req.q("end") or start
    exclude = req.q("exclude_job")
    return availability_summary(conn, start, end, int(exclude) if exclude else None)


@route("GET", "/api/availability/grid")
def api_availability_grid(req, conn):
    start = parse_date(req.q("start") or dt.date.today().isoformat(), "start")
    days = max(1, min(as_int(req.q("days") or 14, "days"), 62))
    end = start + dt.timedelta(days=days - 1)
    dates = [(start + dt.timedelta(days=i)).isoformat() for i in range(days)]
    use = usage_by_day(conn, start.isoformat(), end.isoformat())
    subs = sub_units_by_day(conn, start.isoformat(), end.isoformat())
    qmap = quarantined_map(conn)
    products = []
    for p in conn.execute("SELECT id, name, category, subcategory, quantity FROM products WHERE archived = 0 AND sub_hire = 0 AND item_type != 'package' "
                          "AND NOT (item_type = 'cable' AND parent_id IS NULL) "
                          "ORDER BY category COLLATE NOCASE, subcategory COLLATE NOCASE, name COLLATE NOCASE, length_m"):
        m = use.get(p["id"], {})
        products.append({"id": p["id"], "name": p["name"], "category": p["category"], "subcategory": p["subcategory"],
                         "quantity": p["quantity"] - qmap.get(p["id"], 0), "owned": p["quantity"],
                         "quarantined": qmap.get(p["id"], 0),
                         "days": [m.get(d, [0, 0]) for d in dates],
                         "extra": [subs.get(p["id"], {}).get(d, 0) for d in dates] if p["id"] in subs else None})
    jobs = rows(conn.execute(
        JOB_LIST_SQL + " WHERE j.status IN ('provisional','confirmed','out') "
        "AND j.start_date <= ? AND j.end_date >= ? ORDER BY j.start_date",
        (end.isoformat(), start.isoformat())))
    return {"dates": dates, "products": products, "jobs": jobs}


# ---- dashboard

@route("GET", "/api/dashboard")
def api_dashboard(req, conn):
    today = dt.date.today()
    t = today.isoformat()
    horizon = (today + dt.timedelta(days=14)).isoformat()
    upcoming = rows(conn.execute(
        JOB_LIST_SQL + " WHERE j.status IN ('enquiry','quote','provisional','confirmed','out') "
        "AND j.end_date >= ? AND j.start_date <= ? ORDER BY j.start_date, j.id", (t, horizon)))
    attach_totals(conn, upcoming)
    out_now = rows(conn.execute(JOB_LIST_SQL + " WHERE j.status = 'out' ORDER BY j.end_date"))
    maybe = attach_overdue(conn, rows(conn.execute(
        JOB_LIST_SQL + " WHERE j.status IN ('provisional', 'confirmed', 'out') AND j.end_date < ? ORDER BY j.end_date", (t,))))
    overdue = [j for j in maybe if j["overdue"]]
    counts = {s: 0 for s in STATUSES}
    for r in conn.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"):
        counts[r["status"]] = r["n"]

    # Shortages over the next 90 days (quarantined stock isn't usable).
    end90 = (today + dt.timedelta(days=90)).isoformat()
    use = usage_by_day(conn, t, end90)
    subs = sub_units_by_day(conn, t, end90)
    qmap = quarantined_map(conn)
    shortages = []
    for p in conn.execute("SELECT id, name, quantity FROM products WHERE sub_hire = 0 AND item_type != 'package'"):
        days = use.get(p["id"])
        if not days:
            continue
        usable = p["quantity"] - qmap.get(p["id"], 0)
        sd = subs.get(p["id"], {})
        hard_bad = sorted(d for d, v in days.items() if v[0] > usable + sd.get(d, 0))
        soft_bad = sorted(d for d, v in days.items() if v[0] + v[1] > usable + sd.get(d, 0))
        if hard_bad or soft_bad:
            worst = max(v[0] + v[1] - sd.get(d, 0) for d, v in days.items()) if not hard_bad else \
                max(v[0] - sd.get(d, 0) for d, v in days.items())
            shortages.append({
                "product_id": p["id"], "name": p["name"], "owned": p["quantity"],
                "quarantined": qmap.get(p["id"], 0), "firm": bool(hard_bad),
                "first_date": (hard_bad or soft_bad)[0],
                "short_by": worst - usable,
            })
    shortages.sort(key=lambda s: (not s["firm"], s["first_date"]))

    week = (today + dt.timedelta(days=7)).isoformat()
    going_out = rows(conn.execute(
        JOB_LIST_SQL + " WHERE j.status IN ('provisional','confirmed') AND j.start_date >= ? AND j.start_date <= ? "
        "ORDER BY j.start_date", (t, week)))
    ready = rows(conn.execute(
        JOB_LIST_SQL + " WHERE (j.zoho_invoice_id IS NULL OR j.zoho_invoice_id = '') AND ("
        "j.status = 'returned' OR (j.status IN ('confirmed','out') AND j.end_date < ?)) "
        "ORDER BY j.end_date", (t,)))
    attach_totals(conn, ready)
    return {
        "today": t,
        "upcoming": upcoming,
        "out_now": out_now,
        "overdue": overdue,
        "going_out": going_out,
        "ready_to_invoice": ready,
        "counts": counts,
        "shortages": shortages,
        "quarantine_units": sum(qmap.values()),
        "zoho_connected": bool(get_secret(conn, "zoho_refresh_token")),
        "product_count": conn.execute("SELECT COUNT(*) FROM products WHERE archived = 0").fetchone()[0],
        "contact_count": conn.execute("SELECT COUNT(*) FROM contacts WHERE archived = 0").fetchone()[0],
    }


# ---- import / export

def norm(h):
    return re.sub(r"[^a-z0-9]", "", (h or "").lower())


PRODUCT_COLS = {
    "name": ["name", "productname", "product", "item", "itemname", "description"],
    "category": ["category", "productgroup", "group", "type", "department"],
    "subcategory": ["subcategory", "subgroup", "productsubgroup", "subtype", "subcat"],
    "sku": ["sku", "code", "productcode", "barcode", "assetnumber", "partnumber", "id"],
    "brand": ["brand", "brandname", "manufacturer", "make", "maker"],
    "quantity": ["quantity", "qty", "stock", "stocklevel", "quantityheld", "held", "quantityowned",
                 "owned", "total"],
    "day_rate": ["dayrate", "rate", "price", "rentalprice", "rentalrate", "dailyrate", "rentalcharge",
                 "hirerate", "rentalpricedaily"],
    "replacement_value": ["replacementvalue", "replacement", "replacementcharge", "replacementcost",
                          "value", "purchaseprice"],
    "weight_kg": ["weight", "weightkg"],
    "notes": ["notes", "note", "comments"],
}
CONTACT_COLS = {
    "name": ["name", "fullname", "contact", "contactname", "member", "membername"],
    "company": ["company", "organisation", "organization", "companyname", "business"],
    "email": ["email", "emailaddress", "primaryemail"],
    "phone": ["phone", "telephone", "mobile", "phonenumber", "primaryphone", "tel"],
    "address": ["address", "fulladdress", "street", "address1", "streetaddress"],
    "notes": ["notes", "note", "comments"],
}


def map_columns(headers, spec):
    normed = {norm(h): h for h in headers}
    mapping = {}
    for field, aliases in spec.items():
        for a in aliases:
            if a in normed and normed[a] not in mapping.values():
                mapping[field] = normed[a]
                break
    return mapping


def parse_money(v):
    v = re.sub(r"[^0-9.\-]", "", str(v or ""))
    try:
        return float(v) if v else 0.0
    except ValueError:
        return 0.0


@route("POST", "/api/import/products")
def api_import_products(req, conn):
    text = (req.json() or {}).get("csv", "")
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    mapping = map_columns(reader.fieldnames or [], PRODUCT_COLS)
    if "name" not in mapping:
        raise ApiError(400, "Couldn't find a product name column. Columns seen: "
                       + ", ".join(reader.fieldnames or []))
    added = updated = skipped = 0
    for row in reader:
        name = (row.get(mapping["name"]) or "").strip()
        if not name:
            skipped += 1
            continue
        rec = {"name": name}
        for f in ("category", "subcategory", "sku", "brand", "notes"):
            if f in mapping:
                rec[f] = (row.get(mapping[f]) or "").strip()
        for f in ("day_rate", "replacement_value", "weight_kg"):
            if f in mapping:
                rec[f] = parse_money(row.get(mapping[f]))
        if "quantity" in mapping:
            rec["quantity"] = int(parse_money(row.get(mapping["quantity"])))
        existing = None
        if rec.get("sku"):
            existing = conn.execute("SELECT id FROM products WHERE sku = ?", (rec["sku"],)).fetchone()
        if not existing:
            existing = conn.execute("SELECT id FROM products WHERE name = ? COLLATE NOCASE",
                                    (name,)).fetchone()
        if existing:
            update(conn, "products", existing["id"], rec)
            updated += 1
        else:
            insert(conn, "products", rec)
            added += 1
    conn.commit()
    fill_equip_kinds(conn)
    conn.commit()
    return {"added": added, "updated": updated, "skipped": skipped, "columns": mapping}


@route("POST", "/api/import/contacts")
def api_import_contacts(req, conn):
    text = (req.json() or {}).get("csv", "")
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    headers = reader.fieldnames or []
    mapping = map_columns(headers, CONTACT_COLS)
    first_last = None
    if "name" not in mapping:
        nh = {norm(h): h for h in headers}
        if "firstname" in nh:
            first_last = (nh["firstname"], nh.get("lastname") or nh.get("surname"))
        elif "company" not in mapping:
            raise ApiError(400, "Couldn't find a name column. Columns seen: " + ", ".join(headers))
    added = updated = skipped = 0
    for row in reader:
        if "name" in mapping:
            name = (row.get(mapping["name"]) or "").strip()
        elif first_last:
            name = " ".join(p for p in ((row.get(first_last[0]) or "").strip(),
                                        (row.get(first_last[1]) or "").strip() if first_last[1] else "")
                            if p)
        else:
            name = ""
        if not name and "company" in mapping:
            name = (row.get(mapping["company"]) or "").strip()
        if not name:
            skipped += 1
            continue
        rec = {"name": name}
        for f in ("company", "email", "phone", "address", "notes"):
            if f in mapping:
                rec[f] = (row.get(mapping[f]) or "").strip()
        existing = None
        if rec.get("email"):
            existing = conn.execute("SELECT id FROM contacts WHERE email = ? COLLATE NOCASE AND email != ''",
                                    (rec["email"],)).fetchone()
        if not existing:
            existing = conn.execute("SELECT id FROM contacts WHERE name = ? COLLATE NOCASE",
                                    (name,)).fetchone()
        if existing:
            update(conn, "contacts", existing["id"], rec)
            updated += 1
        else:
            insert(conn, "contacts", rec)
            added += 1
    conn.commit()
    return {"added": added, "updated": updated, "skipped": skipped, "columns": mapping}


def csv_safe(v):
    """A cell a spreadsheet would run as a formula (=, +, -, @ first) gets a leading ' so it stays text. Numbers are left alone."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") and not re.match(r"^[+-]?\d+(\.\d+)?$", v):
        return "'" + v
    return v


def csv_response(filename, header, data):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in data:
        w.writerow([csv_safe(r.get(h, "")) for h in header])
    return Raw("﻿" + buf.getvalue(), "text/csv; charset=utf-8", filename=filename)


@route("GET", "/api/export/products.csv")
def export_products(req, conn):
    data = rows(conn.execute("SELECT * FROM products ORDER BY category, subcategory, name"))
    return csv_response("horan-event-tracking-products.csv",
                        ["id", "name", "brand", "category", "subcategory", "sku", "quantity", "day_rate",
                         "replacement_value", "weight_kg", "notes", "archived"], data)


@route("GET", "/api/export/contacts.csv")
def export_contacts(req, conn):
    data = rows(conn.execute("SELECT * FROM contacts ORDER BY name"))
    return csv_response("horan-event-tracking-contacts.csv",
                        ["id", "name", "company", "email", "phone", "address", "notes", "archived"], data)


@route("GET", "/api/export/jobs.csv")
def export_jobs(req, conn):
    jobs = attach_totals(conn, rows(conn.execute(JOB_LIST_SQL + " ORDER BY j.start_date")))
    for j in jobs:
        j.update({"net": j["totals"]["net"], "vat": j["totals"]["vat"], "total": j["totals"]["total"]})
    return csv_response("horan-event-tracking-jobs.csv",
                        ["number", "name", "status", "contact_name", "contact_company", "venue",
                         "reference", "start_date", "end_date", "net", "vat", "total"], jobs)


@route("GET", "/api/export.json")
def export_json(req, conn):
    require_admin(req, conn)  # everything in the business: only admins
    dump = {"app": "Horan Event Tracking", "version": VERSION, "exported_at": now_iso()}
    for t in ("settings", "products", "product_accessories", "contacts", "jobs", "job_items"):
        dump[t] = rows(conn.execute(f"SELECT * FROM {t}"))
    dump["settings"] = [r for r in dump["settings"] if not r["key"].startswith(("zoho_", "secret_"))]
    stamp = dt.date.today().isoformat()
    return Raw(json.dumps(dump, indent=2), "application/json",
               filename=f"horan-event-tracking-export-{stamp}.json")


@route("GET", "/api/backup.db")
def backup_db(req, conn):
    require_admin(req, conn)  # the whole database, PIN hashes and connection tokens included: only admins
    tmp = os.path.join(DATA_DIR, ".download-backup.db")
    if os.path.exists(tmp):
        os.remove(tmp)
    dest = sqlite3.connect(tmp)
    conn.backup(dest)
    dest.close()
    with open(tmp, "rb") as f:
        body = f.read()
    os.remove(tmp)
    stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M")
    return Raw(body, "application/octet-stream", filename=f"horan-event-tracking-{stamp}.db")


# ---------------------------------------------------------------- HTTP

class Request:
    def __init__(self, handler, query, body, remote=False, session=None):
        self.handler = handler
        self.query = query
        self.body = body
        self.remote = remote        # True when the request comes from another device on the network
        self.session = session      # this device's sign-in, if any
        self.signed_in = True       # False only for the sign-in page's own requests
        self.set_cookie = None

    def q(self, key):
        v = self.query.get(key)
        return v[0] if v else None

    def json(self):
        if not self.body:
            return {}
        try:
            return json.loads(self.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "Body is not valid JSON")


# Sent with every response. The policy only lets the page run the app's own script files, so even if some
# text were ever shown without being made safe, a script hidden in it could not run or send data elsewhere.
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                               "img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; "
                               "connect-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; "
                               "form-action 'self'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",                 # no other site may show the app inside a frame
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


class Handler(BaseHTTPRequestHandler):
    timeout = 120   # drop connections that stall, so they can't tie up the server
    server_version = f"HoranEventTracking/{VERSION}"

    def log_message(self, fmt, *args):
        if os.environ.get("HORAN_RMS_DEBUG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _host_ok(self):
        # Defend against DNS-rebinding: only answer to local names, IP addresses and local network names
        # (a hostile website's own domain name is never accepted).
        raw = (self.headers.get("Host") or "").strip()
        host = raw[1:raw.index("]")] if raw.startswith("[") and "]" in raw else raw.rsplit(":", 1)[0]
        host = host.lower().rstrip(".")
        if host in ("127.0.0.1", "localhost", "::1"):
            return True
        if HOST in ("127.0.0.1", "localhost", "::1"):
            return False
        try:
            ipaddress.ip_address(host)
            return True
        except ValueError:
            pass
        me = socket.gethostname().lower().split(".")[0]
        return ("." not in host or host.split(".")[0] == me
                or host.endswith((".local", ".lan", ".home", ".internal", ".home.arpa")))

    def _cookie(self, name):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return None

    def _login_page(self):
        with open(os.path.join(STATIC_DIR, "login.html"), "rb") as f:
            body = f.read()
        self._send(200, body, "text/html; charset=utf-8", {"Cache-Control": "no-store"})

    def _send(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        headers = dict(SECURITY_HEADERS, **(extra or {}))
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, payload):
        body = json.dumps(payload, default=str).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _static(self, path):
        if path in ("/", "/index.html"):
            rel = "index.html"
        elif path.startswith("/static/"):
            rel = path[len("/static/"):]
        else:
            return False
        full = os.path.realpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(os.path.realpath(STATIC_DIR) + os.sep) or not os.path.isfile(full):
            return False
        with open(full, "rb") as f:
            body = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        self._send(200, body, ctype, {"Cache-Control": "no-cache"})
        return True

    def _dispatch(self):
        if not self._host_ok():
            return self._json(403, {"error": "Forbidden host"})
        parsed = urlparse(self.path)
        path = parsed.path
        method = "GET" if self.command == "HEAD" else self.command

        # Mutating requests must carry a custom header. Browsers can't add it to
        # cross-site requests without a CORS pre-flight, which we never grant.
        if method in ("POST", "PUT", "DELETE") and self.headers.get("X-Requested-With") != "horan-rms":
            return self._json(403, {"error": "Missing request header"})

        # Who is this? Other devices on the network always sign in. Once there are users, everyone signs in
        # (on this computer too) so the app knows who did what. Without users, this computer never has to.
        remote = not is_loopback(self.client_address[0])
        conn = db()
        try:
            session = session_for(conn, self._cookie(SESSION_COOKIE))
            has_users = users_exist(conn)
            allowed = get_settings(conn)["network_access"] == "1"
            user = None
            if session and session.get("user_id"):
                user = one(conn.execute("SELECT id, name FROM users WHERE id = ? AND active = 1", (session["user_id"],)))
        finally:
            conn.close()
        if remote and not allowed:
            return self._json(403, {"error": "Network access is turned off on the computer running this app"})
        need_login = (has_users and not user) or (remote and not session)
        if need_login:
            public = (path in ("/api/login", "/api/login-options", "/api/meta", "/favicon", "/apple-touch-icon.png",
                               "/manifest.webmanifest", "/app-icon-192.png", "/app-icon-512.png", "/logo")
                      or path.startswith("/static/"))
            if not public:
                if path.startswith("/api/"):
                    return self._json(401, {"error": "Please sign in", "login": True})
                if method == "GET":
                    return self._login_page()
                return self._json(401, {"error": "Please sign in", "login": True})
        ACTOR.user_id, ACTOR.name = (user["id"], user["name"]) if user else (None, "")

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"error": "Bad request"})
        if length < 0:
            return self._json(400, {"error": "Bad request"})
        if length > 25 * 1024 * 1024:
            return self._json(413, {"error": "Request too large"})
        body = self.rfile.read(length) if length else b""

        for m, regex, fn in ROUTES:
            if m != method:
                continue
            match = regex.match(path)
            if not match:
                continue
            req = Request(self, parse_qs(parsed.query), body, remote, session)
            req.signed_in = not need_login
            conn = db()
            try:
                pre = None
                if method != "GET":
                    try:
                        pre = pre_describe(fn.__name__, conn, match.groups())
                    except Exception:  # noqa: BLE001 - the log must never get in the way
                        pre = None
                if method != "GET":
                    jid_ = job_of(conn, fn.__name__, match.groups())
                    if jid_:
                        require_job_edit(conn, req, jid_)
                result = fn(req, conn, *match.groups())
                if method != "GET":
                    try:
                        b_ = req.json() if req.body else {}
                        entry = describe(fn.__name__, conn, req, match.groups(), b_ if isinstance(b_, dict) else {}, result, pre)
                        if entry:
                            log_activity(conn, entry[0], entry[1], entry[2], entry[3])
                            conn.commit()
                    except Exception:  # noqa: BLE001
                        import traceback
                        traceback.print_exc()
            except ApiError as e:
                conn.rollback()
                return self._json(e.status, {"error": e.message})
            except sqlite3.IntegrityError as e:
                conn.rollback()
                return self._json(400, {"error": f"Database constraint: {e}"})
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                import traceback
                traceback.print_exc()
                return self._json(500, {"error": f"Server error: {e}"})
            finally:
                conn.close()
            if isinstance(result, Raw):
                extra = dict(result.extra_headers)
                extra["Cache-Control"] = "no-store"
                if result.filename:
                    extra["Content-Disposition"] = f'attachment; filename="{result.filename}"'
                return self._send(200, result.body, result.content_type, extra)
            if req.set_cookie:
                body_ = json.dumps(result, default=str).encode("utf-8")
                return self._send(200, body_, "application/json; charset=utf-8",
                                  {"Cache-Control": "no-store", "Set-Cookie": req.set_cookie})
            return self._json(200, result)

        if method == "GET" and self._static(path):
            return
        if path.startswith("/api/"):
            return self._json(404, {"error": "Not found"})
        # Unknown non-API GET: serve the app shell (client-side routing uses #hash anyway).
        if method == "GET" and self._static("/"):
            return
        self._json(404, {"error": "Not found"})

    do_GET = _dispatch
    do_HEAD = _dispatch
    do_POST = _dispatch
    do_PUT = _dispatch
    do_DELETE = _dispatch


# ---------------------------------------------------------------- startup

def lock_down_data():
    """Other accounts on this computer shouldn't be able to read the database (PINs, connection tokens) or its backups."""
    if os.name != "posix":
        return
    try:
        os.chmod(DATA_DIR, 0o700)
        for base in (DATA_DIR, os.path.join(DATA_DIR, "backups")):
            if os.path.isdir(base):
                for fn in os.listdir(base):
                    full = os.path.join(base, fn)
                    if os.path.isfile(full) and (fn.endswith((".db", ".db-wal", ".db-shm"))):
                        os.chmod(full, 0o600)
    except OSError:
        pass


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(job_items)")}
    if "parent_item_id" not in cols:
        conn.execute("ALTER TABLE job_items ADD COLUMN parent_item_id INTEGER "
                     "REFERENCES job_items(id) ON DELETE CASCADE")
    if "accessory_qty" not in cols:
        conn.execute("ALTER TABLE job_items ADD COLUMN accessory_qty REAL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_items_parent ON job_items(parent_item_id)")
    for table, col, decl in (("products", "cable_type", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "length_m", "REAL"),
                             ("products", "joiner_product_id", "INTEGER"),
                             ("products", "power_watts", "REAL NOT NULL DEFAULT 0"),
                             ("products", "plug_type", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "sockets", "INTEGER NOT NULL DEFAULT 0"),
                             ("products", "socket_type", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "power_rating_a", "REAL NOT NULL DEFAULT 0"),
                             ("job_items", "meta", "TEXT"),
                             ("job_items", "section_id", "INTEGER REFERENCES job_sections(id) ON DELETE SET NULL"),
                             ("products", "item_type", "TEXT NOT NULL DEFAULT 'equipment'"),
                             ("products", "plugs_in", "INTEGER NOT NULL DEFAULT 0"),
                             ("products", "deck_w", "REAL"),
                             ("products", "skirt_len", "REAL"),
                             ("products", "brand", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "sub_hire", "INTEGER NOT NULL DEFAULT 0"),
                             ("sessions", "user_id", "INTEGER"),
                             ("products", "equip_kind", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "size_w", "REAL"),
                             ("products", "size_d", "REAL"),
                             ("products", "size_h", "REAL"),
                             ("products", "plan_shape", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "stand_height_mode", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "stand_h", "REAL"),
                             ("products", "stand_h_min", "REAL"),
                             ("products", "stand_h_max", "REAL"),
                             ("products", "stand_h_steps", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "stand_load_kg", "REAL"),
                             ("jobs", "created_by_id", "INTEGER"),
                             ("jobs", "edit_lock", "INTEGER NOT NULL DEFAULT 0"),
                             ("jobs", "editors", "TEXT NOT NULL DEFAULT ''"),
                             ("job_checks", "free", "INTEGER NOT NULL DEFAULT 0"),
                             ("jobs", "created_by", "TEXT NOT NULL DEFAULT ''"),
                             ("job_items", "added_by", "TEXT NOT NULL DEFAULT ''"),
                             ("job_items", "sub_qty", "REAL NOT NULL DEFAULT 0"),
                             ("assets", "sub_hire", "INTEGER NOT NULL DEFAULT 0"),
                             ("users", "alias", "TEXT NOT NULL DEFAULT ''"),
                             ("contacts", "account_ref", "TEXT NOT NULL DEFAULT ''"),
                             ("jobs", "invoice_number", "TEXT"),
                             ("jobs", "invoice_date", "TEXT"),
                             ("jobs", "exported_at", "TEXT"),
                             ("jobs", "exported_to", "TEXT"),
                             ("users", "company", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "subcategory", "TEXT NOT NULL DEFAULT ''"),
                             ("assets", "vendor_id", "INTEGER REFERENCES vendors(id) ON DELETE SET NULL"),
                             ("assets", "hire_from", "TEXT"),
                             ("assets", "hire_to", "TEXT"),
                             ("job_items", "sub_vendor_id", "INTEGER REFERENCES vendors(id) ON DELETE SET NULL"),
                             ("job_items", "sub_cost", "REAL"),
                             ("job_checks", "user_name", "TEXT NOT NULL DEFAULT ''"),
                             ("job_checks", "user_id", "INTEGER"),
                             ("products", "vendor_id", "INTEGER REFERENCES vendors(id) ON DELETE SET NULL"),
                             ("products", "sub_hire_cost", "REAL NOT NULL DEFAULT 0"),
                             ("products", "skirt_height", "REAL"),
                             ("products", "skirt_style", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "skirt_colour", "TEXT NOT NULL DEFAULT ''"),
                             ("products", "deck_d", "REAL"),
                             ("products", "power_cable", "INTEGER NOT NULL DEFAULT 0"),
                             ("products", "parent_id", "INTEGER REFERENCES products(id) ON DELETE CASCADE"),
                             ("jobs", "power_supply", "TEXT NOT NULL DEFAULT ''"),
                             ("contacts", "zoho_contact_id", "TEXT"),
                             ("jobs", "zoho_invoice_id", "TEXT"),
                             ("jobs", "zoho_invoice_number", "TEXT"),
                             ("jobs", "zoho_synced_at", "TEXT"),
                             ("products", "inner_w", "REAL"),
                             ("products", "inner_d", "REAL"),
                             ("products", "inner_h", "REAL"),
                             ("products", "case_for_id", "INTEGER REFERENCES products(id) ON DELETE SET NULL"),
                             ("job_checks", "case_id", "INTEGER REFERENCES job_cases(id) ON DELETE SET NULL"),
                             ("contacts", "job_prefix", "TEXT NOT NULL DEFAULT ''"),
                             ("contacts", "next_job_number", "INTEGER")):
        if col not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    for k, v in DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)", (k, v))
    conn.row_factory = sqlite3.Row
    if not conn.execute("SELECT 1 FROM settings WHERE key = 'migrated_plugs_in'").fetchone():
        conn.execute("UPDATE products SET plugs_in = 1 WHERE item_type = 'equipment' AND power_watts > 0")
        conn.execute("INSERT INTO settings(key, value) VALUES('migrated_plugs_in', '1')")
    if not conn.execute("SELECT 1 FROM settings WHERE key = 'migrated_stock_types'").fetchone():
        migrate_stock_types(conn)
        conn.execute("INSERT INTO settings(key, value) VALUES('migrated_stock_types', '1')")
    fill_equip_kinds(conn)
    if not conn.execute("SELECT 1 FROM settings WHERE key = 'instance_id'").fetchone():
        conn.execute("INSERT INTO settings(key, value) VALUES('instance_id', ?)", (new_instance_id(),))
    apply_fulfilled(conn)
    # 1.11: the logo lives in the database (so it's in backups); bring in a logo file from older versions
    if not conn.execute("SELECT 1 FROM files WHERE key = 'logo_light'").fetchone():
        for mime, ext in LOGO_TYPES.items():
            old = os.path.join(DATA_DIR, f"logo.{ext}")
            if os.path.exists(old):
                with open(old, "rb") as f:
                    conn.execute("INSERT INTO files(key, name, ctype, data, updated_at) VALUES('logo_light', ?, ?, ?, ?)",
                                 (f"logo.{ext}", mime, f.read(), now_iso()))
                os.replace(old, old + ".imported")
                break
    conn.commit()
    conn.close()


def migrate_stock_types(conn):
    """1.4: split stock into equipment / cable / power, and group cable lengths under one cable item."""
    conn.execute("UPDATE products SET item_type = 'power' WHERE sockets > 0 AND parent_id IS NULL "
                 "AND item_type = 'equipment'")
    loose = [dict(r) for r in conn.execute(
        "SELECT * FROM products WHERE cable_type != '' AND length_m > 0 AND parent_id IS NULL "
        "AND item_type != 'power' ORDER BY cable_type, length_m")]
    groups = {}
    for r in loose:
        groups.setdefault(r["cable_type"], []).append(r)
    for ctype, items in groups.items():
        cats = [i["category"] for i in items if i["category"]]
        joiner = next((i["joiner_product_id"] for i in items if i["joiner_product_id"]), None)
        cur = conn.execute(
            "INSERT INTO products (name, category, sku, quantity, day_rate, replacement_value, item_type, "
            "cable_type, joiner_product_id) VALUES (?, ?, '', ?, ?, ?, 'cable', ?, ?)",
            (f"{ctype} Cable", max(set(cats), key=cats.count) if cats else "Cables",
             sum(i["quantity"] for i in items), min(i["day_rate"] for i in items),
             min(i["replacement_value"] for i in items), ctype, joiner))
        parent = cur.lastrowid
        for i in items:
            conn.execute("UPDATE products SET parent_id = ?, item_type = 'cable', joiner_product_id = ? WHERE id = ?",
                         (parent, joiner, i["id"]))
    conn.execute("UPDATE products SET power_watts = 0, sockets = 0 WHERE item_type = 'cable'")


def daily_backup(keep=14):
    """Keep one automatic snapshot per day in data/backups (newest 14)."""
    if not os.path.exists(DB_PATH):
        return
    bdir = os.path.join(DATA_DIR, "backups")
    os.makedirs(bdir, exist_ok=True)
    target = os.path.join(bdir, f"rms-{dt.date.today().isoformat()}.db")
    if not os.path.exists(target):
        src = sqlite3.connect(DB_PATH)
        dest = sqlite3.connect(target)
        src.backup(dest)
        dest.close()
        src.close()
    snaps = sorted(f for f in os.listdir(bdir) if f.startswith("rms-") and f.endswith(".db"))
    for old in snaps[:-keep]:
        try:
            os.remove(os.path.join(bdir, old))
        except OSError:
            pass


def default_data_dir():
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "Horan Event Tracking", "data")
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "horan-rms", "data")


HEADLESS_MARKER = "server-mode"


def headless_marked():
    return sys.platform != "darwin" and os.path.exists(os.path.join(DATA_DIR, HEADLESS_MARKER))


def set_headless_marker(on, quiet=False):
    path = os.path.join(DATA_DIR, HEADLESS_MARKER)
    if on:
        if sys.platform == "darwin":
            print("Server mode is for Linux servers. On a Mac, use Settings > Network access.", file=sys.stderr)
            return 2
        with open(path, "w") as f:
            f.write("This is a Horan Event Tracking server with no screen of its own: admins can update it from any\n"
                    "device (Settings > Software update). Remove this file, or run 'horan-rms headless off', to stop.\n")
    elif os.path.exists(path):
        os.remove(path)
    if not quiet:
        print("Server mode is " + ("on: admins can install updates from any device. Restart to apply:  horan-rms restart"
                                   if on else "off: only this computer can install updates. Restart to apply:  horan-rms restart"))
    return 0


def main():
    global DATA_DIR, DB_PATH, HOST, PORT, HOST_FROM_SETTINGS, HEADLESS
    ap = argparse.ArgumentParser(description="Horan Event Tracking - local server")
    ap.add_argument("--host", default=os.environ.get("HORAN_RMS_HOST"),
                    help="address to listen on (default: this computer only, or the whole network when "
                         "Settings > Network access is on)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("HORAN_RMS_PORT", "8765")))
    ap.add_argument("--data", default=os.environ.get("HORAN_RMS_DATA") or default_data_dir(),
                    help="folder for the database, logo and backups")
    ap.add_argument("--demo", action="store_true", help="load sample data if the database is empty")
    ap.add_argument("--headless", action="store_true",
                    help="server mode: other devices on the network use it (needs a passcode - see --set-passcode)")
    ap.add_argument("--set-passcode", action="store_true",
                    help="set the passcode other devices sign in with (asks for it, or reads HORAN_RMS_PASSCODE), then exit")
    ap.add_argument("--network", choices=("on", "off"), help="turn network access on or off, then exit")
    ap.add_argument("--status", action="store_true", help="show the version, data folder and network addresses, then exit")
    ap.add_argument("--list-users", action="store_true", help="list the people who can sign in, then exit")
    ap.add_argument("--reset-pin", metavar="NAME", help="give someone a new PIN (and make sure they're an active admin "
                    "with --admin), then exit - for when everyone is locked out")
    ap.add_argument("--admin", action="store_true", help="with --reset-pin: also make them an admin")
    ap.add_argument("--headless-mode", choices=("on", "off"),
                    help="remember that this is a server with no screen (admins can then update it from any device), "
                         "so it stays in server mode however it's started; then exit")
    args = ap.parse_args()

    PORT = args.port
    DATA_DIR = os.path.abspath(os.path.expanduser(args.data))
    DB_PATH = os.path.join(DATA_DIR, "rms.db")
    init_db()
    if args.headless_mode:
        sys.exit(set_headless_marker(args.headless_mode == "on"))
    if args.set_passcode or args.network or args.status or args.list_users or args.reset_pin:
        sys.exit(cli_admin(args))
    # Server mode is remembered in the data folder, so a restart that forgets --headless (the launcher, a
    # hand-started copy, an old service file) still runs as a server.
    HEADLESS = bool(args.headless) or headless_marked()
    if HEADLESS and not args.headless:
        print("Server mode (remembered from the install). Turn it off with:  horan-rms headless off", file=sys.stderr)
    if args.headless and not headless_marked():
        set_headless_marker(True, quiet=True)
    if args.headless:
        c = db()
        try:
            if not get_secret(c, "secret_passcode"):
                print("Headless mode: no passcode is set yet, so only this computer can connect.\n"
                      "Set one with:  horan-rms passcode   (or: python3 server.py --set-passcode)", file=sys.stderr)
            elif get_settings(c)["network_access"] != "1":
                print("Headless mode: network access is off, so only this computer can connect.\n"
                      "Turn it on with:  horan-rms network on", file=sys.stderr)
        finally:
            c.close()
    HOST_FROM_SETTINGS = not args.host
    if args.host:
        HOST = args.host
    else:
        c = db()
        try:
            st = get_settings(c)
            HOST = "0.0.0.0" if st["network_access"] == "1" and (get_secret(c, "secret_passcode") or users_exist(c)) else "127.0.0.1"
        finally:
            c.close()
    daily_backup()
    lock_down_data()
    threading.Thread(target=auto_update_loop, daemon=True, name="auto-update").start()
    if args.demo:
        load_demo()

    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("image/svg+xml", ".svg")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Horan Event Tracking {VERSION} running at http://{'127.0.0.1' if HOST == '0.0.0.0' else HOST}:{PORT}")
    if HOST == "0.0.0.0":
        print("Other devices on your network can connect at: " + ", ".join(f"http://{ip}:{PORT}/" for ip in lan_addresses()))
    print(f"Data folder: {DATA_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def cli_admin(args):
    """Command-line admin for servers without a screen. Returns the exit code."""
    import getpass
    c = db()
    try:
        if args.set_passcode:
            pc = os.environ.get("HORAN_RMS_PASSCODE", "")
            if not pc:
                if not sys.stdin.isatty():
                    print("No terminal to ask for the passcode: set HORAN_RMS_PASSCODE instead.", file=sys.stderr)
                    return 2
                pc = getpass.getpass("New passcode for other devices (at least 6 characters): ")
                if pc != getpass.getpass("Type it again: "):
                    print("Those didn't match - nothing changed.", file=sys.stderr)
                    return 1
            if len(pc) < 6:
                print("Use at least 6 characters - nothing changed.", file=sys.stderr)
                return 1
            set_secret(c, "secret_passcode", hash_passcode(pc))
            c.execute("DELETE FROM sessions")
            c.commit()
            print("Passcode saved. Every device needs to sign in again with the new one.")
        if args.network:
            if args.network == "on" and not get_secret(c, "secret_passcode"):
                print("Set a passcode first:  horan-rms passcode", file=sys.stderr)
                return 1
            set_secret(c, "network_access", "1" if args.network == "on" else "0")
            c.commit()
            print(f"Network access {args.network}. Restart Horan Event Tracking for it to take effect.")
        if args.list_users:
            us = rows(c.execute("SELECT name, is_admin, active FROM users ORDER BY name COLLATE NOCASE"))
            if not us:
                print("No users yet - nobody needs to sign in on this computer.")
            for u in us:
                print(f"{u['name']}{'  (admin)' if u['is_admin'] else ''}{'  [disabled]' if not u['active'] else ''}")
        if args.reset_pin:
            u = one(c.execute("SELECT * FROM users WHERE name = ? COLLATE NOCASE", (args.reset_pin,)))
            if not u:
                print(f"Nobody called {args.reset_pin}. See: horan-rms users", file=sys.stderr)
                return 1
            pin = os.environ.get("HORAN_RMS_PIN", "")
            if not pin:
                if not sys.stdin.isatty():
                    print("No terminal to ask for the PIN: set HORAN_RMS_PIN instead.", file=sys.stderr)
                    return 2
                pin = getpass.getpass(f"New PIN for {u['name']} (at least {USER_PIN_MIN} characters): ")
                if pin != getpass.getpass("Type it again: "):
                    print("Those didn't match - nothing changed.", file=sys.stderr)
                    return 1
            if len(pin) < USER_PIN_MIN:
                print(f"Use at least {USER_PIN_MIN} characters - nothing changed.", file=sys.stderr)
                return 1
            c.execute("UPDATE users SET pin_hash = ?, active = 1" + (", is_admin = 1" if args.admin else "") + " WHERE id = ?",
                      (hash_passcode(pin), u["id"]))
            c.execute("DELETE FROM sessions WHERE user_id = ?", (u["id"],))
            c.commit()
            print(f"New PIN saved for {u['name']}{' (now an admin)' if args.admin else ''}.")
        if args.status:
            st = get_settings(c)
            on = st["network_access"] == "1" and bool(get_secret(c, "secret_passcode"))
            print(f"Horan Event Tracking {VERSION}")
            print(f"Data folder:     {DATA_DIR}")
            print("Server mode:     " + ("on (admins can update from any device)" if headless_marked() else "off"))
            print(f"Passcode set:    {'yes' if get_secret(c, 'secret_passcode') else 'no'}")
            print(f"Network access:  {'on' if on else 'off'}")
            print(f"Signed-in devices: {c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]}")
            if on:
                for ip in lan_addresses():
                    print(f"Open on other devices:  http://{ip}:{PORT}/")
        return 0
    finally:
        c.close()


def load_demo():
    conn = db()
    if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]:
        conn.close()
        return
    prods = [
        ("LED Screen Panel 3.9mm", "LED Video", "LED-P39", 48, 45, 1800, 7.5),
        ("LED Processor (Novastar VX1000)", "LED Video", "LED-VX1000", 2, 120, 3000, 6),
        ("Projector 10K Laser", "Projection", "PRJ-10K", 2, 250, 18000, 24),
        ("Projection Screen 16:9 3m", "Projection", "SCR-3M", 3, 45, 900, 18),
        ("65\" Display on Stand", "Displays", "DSP-65", 6, 85, 1200, 35),
        ("Line Array Top", "Audio", "AUD-LA12", 8, 75, 4500, 32),
        ("18\" Subwoofer", "Audio", "AUD-SUB18", 4, 60, 2200, 55),
        ("Digital Mixer 32ch", "Audio", "AUD-MIX32", 2, 150, 6000, 20),
        ("Radio Mic Handheld", "Audio", "AUD-RMH", 8, 25, 600, 0.5),
        ("Radio Mic Lapel", "Audio", "AUD-RML", 8, 25, 650, 0.3),
        ("LED Wash Fixture", "Lighting", "LX-WASH", 16, 18, 450, 6),
        ("Moving Head Spot", "Lighting", "LX-SPOT", 8, 40, 2200, 22),
        ("Lighting Desk", "Lighting", "LX-DESK", 1, 95, 4000, 12),
        ("Truss 3m Section", "Staging & Rigging", "TRS-3M", 20, 12, 250, 15),
        ("16A Power Distro", "Power & Cable", "PWR-16A", 6, 20, 300, 8),
        ("Vision Mixer (ATEM)", "Vision", "VIS-ATEM", 2, 90, 2500, 3),
    ]
    for n, c, s, q, r, rv, w in prods:
        insert(conn, "products", {"name": n, "category": c, "sku": s, "quantity": q, "day_rate": r,
                                  "replacement_value": rv, "weight_kg": w})
    stand = insert(conn, "products", {"name": "Speaker Stand", "category": "Audio Accessories", "sku": "ACC-STAND",
                                      "quantity": 12, "day_rate": 5, "replacement_value": 80, "weight_kg": 6})
    loom = insert(conn, "products", {"name": "XLR/IEC Loom 10m", "category": "Audio Accessories", "sku": "ACC-LOOM",
                                     "quantity": 12, "day_rate": 4, "replacement_value": 45, "weight_kg": 2})
    xlr = insert(conn, "products", {"name": "XLR Cable 10m", "category": "Audio Accessories", "sku": "ACC-XLR10",
                                    "quantity": 40, "day_rate": 2, "replacement_value": 18, "weight_kg": 0.8})
    k12 = insert(conn, "products", {"name": "QSC K12.2 Speaker", "category": "Audio", "sku": "AUD-K12",
                                    "quantity": 8, "day_rate": 35, "replacement_value": 900, "weight_kg": 18})
    for acc in (stand, loom, xlr):
        insert(conn, "product_accessories", {"product_id": k12, "accessory_id": acc, "quantity": 1})
    conn.execute("UPDATE products SET cable_type = 'XLR', length_m = 10 WHERE id = ?", (xlr,))
    for n, ln, q in (("XLR Cable 3m", 3, 20), ("XLR Cable 5m", 5, 20), ("XLR Cable 20m", 20, 6)):
        insert(conn, "products", {"name": n, "category": "Audio Accessories", "sku": f"ACC-XLR{ln}",
                                  "quantity": q, "day_rate": 2, "replacement_value": 15 + ln, "weight_kg": 0.1 * ln,
                                  "cable_type": "XLR", "length_m": ln})
    barrel = insert(conn, "products", {"name": "HDMI Barrel Coupler", "category": "Vision", "sku": "VIS-BARREL",
                                       "quantity": 10, "day_rate": 1})
    for n, ln, q in (("HDMI Cable 2m", 2, 10), ("HDMI Cable 5m", 5, 8), ("HDMI Cable 10m", 10, 4)):
        insert(conn, "products", {"name": n, "category": "Vision", "sku": f"VIS-HDMI{ln}", "quantity": q,
                                  "day_rate": 3, "cable_type": "HDMI", "length_m": ln, "joiner_product_id": barrel})
    insert(conn, "products", {"name": "4-Way Extension Lead 10m", "category": "Power & Cable", "sku": "PWR-4W10",
                              "quantity": 12, "day_rate": 4, "sockets": 4, "socket_type": "UK 13A",
                              "power_rating_a": 13, "plug_type": "UK 13A"})
    conn.execute("UPDATE products SET power_watts = 400 WHERE id = ?", (k12,))
    conn.execute("UPDATE products SET power_watts = 150 WHERE sku IN ('AUD-MIX32', 'DSP-65')")
    conn.execute("UPDATE products SET power_watts = 600 WHERE sku = 'PRJ-10K'")
    conn.execute("UPDATE products SET power_watts = 1150 WHERE sku = 'AUD-LA12'")
    conn.execute("UPDATE products SET power_watts = 1000 WHERE sku = 'AUD-SUB18'")
    conn.execute("UPDATE products SET power_watts = 60 WHERE sku = 'LX-WASH'")
    conn.execute("UPDATE products SET sockets = 6, socket_type = 'UK 13A', power_rating_a = 16, "
                 "plug_type = '16A CEE' WHERE sku = 'PWR-16A'")
    migrate_stock_types(conn)
    conn.execute("UPDATE products SET plugs_in = 1 WHERE power_watts > 0")
    rx = insert(conn, "products", {"name": "Radio Mic Receiver (dual)", "category": "Audio", "sku": "AUD-RX2",
                                   "quantity": 4, "day_rate": 0, "power_watts": 12, "plugs_in": 1})
    psu = insert(conn, "products", {"name": "Receiver PSU", "category": "Audio Accessories", "sku": "AUD-PSU",
                                    "quantity": 6, "day_rate": 0})
    xlr3 = conn.execute("SELECT id FROM products WHERE name = 'XLR Cable 3m'").fetchone()[0]
    rmh = conn.execute("SELECT id FROM products WHERE sku = 'AUD-RMH'").fetchone()[0]
    for a, b, q in ((rmh, rx, 0.5), (rx, xlr3, 2), (rx, psu, 1)):
        insert(conn, "product_accessories", {"product_id": a, "accessory_id": b, "quantity": q})
    pc = insert(conn, "products", {"name": "16A Extension Cable", "category": "Power", "item_type": "cable",
                                   "cable_type": "16A", "power_cable": 1, "sockets": 1, "socket_type": "16A CEE",
                                   "power_rating_a": 16, "plug_type": "16A CEE", "day_rate": 4})
    for ln, q in ((5, 6), (10, 8), (25, 4)):
        insert(conn, "products", {"name": f"16A Extension Cable {ln}m", "category": "Power", "item_type": "cable",
                                  "parent_id": pc, "length_m": ln, "quantity": q, "day_rate": 4})
    sync_cable(conn, pc)
    for n, w, d_, q, kg in (("Stage Deck 2m × 1m", 2, 1, 24, 30), ("Stage Deck 1m × 1m", 1, 1, 8, 16),
                            ("Stage Deck 2m × 0.5m", 2, 0.5, 6, 17)):
        insert(conn, "products", {"name": n, "category": "Staging", "sku": f"STG-{fmt_num(w)}X{fmt_num(d_)}",
                                  "quantity": q, "day_rate": 15, "weight_kg": kg, "deck_w": w, "deck_d": d_})
    insert(conn, "products", {"name": "Stage Deck Clamp", "category": "Staging", "quantity": 200, "day_rate": 0.5,
                              "weight_kg": 0.3})
    for h, style, colour, sets in ((40, "Box pleat", "Black", ((3, 12), (2, 12), (1, 8))),
                                   (60, "Box pleat", "Black", ((3, 8), (2, 6), (1, 6))),
                                   (40, "Ruched", "White", ((3, 6), (1, 4)))):
        for ln, q in sets:
            extra = "" if (style, colour) == ("Box pleat", "Black") else f" {colour} {style.lower()}"
            insert(conn, "products", {"name": f"Stage Skirt {h}cm × {ln}m{extra}", "category": "Staging",
                                      "quantity": q, "day_rate": 4, "weight_kg": 0.5 * ln, "skirt_len": ln,
                                      "skirt_height": h, "skirt_style": style, "skirt_colour": colour})
    for n, q in (("Stage Leg 40cm", 120), ("Stage Leg 60cm", 120), ("Stage Leg 1m", 80)):
        insert(conn, "products", {"name": n, "category": "Staging", "quantity": q, "day_rate": 1, "weight_kg": 1})
    for name_like, brand in (("QSC K12%", "QSC"), ("LED Processor (Novastar%", "Novastar"), ("Vision Mixer (ATEM)%", "Blackmagic"),
                             ("Line Array Top", "d&b audiotechnik"), ("18\" Subwoofer", "d&b audiotechnik"),
                             ("Radio Mic%", "Shure"), ("Digital Mixer 32ch", "Allen & Heath")):
        conn.execute("UPDATE products SET brand = ? WHERE name LIKE ?", (brand, name_like))
    c1 = insert(conn, "contacts", {"name": "Sam Example", "company": "Example Events Ltd",
                                   "email": "sam@example.com", "phone": "01234 567890"})
    c2 = insert(conn, "contacts", {"name": "Alex Sample", "company": "Sample Conference Centre",
                                   "email": "alex@example.org"})
    today = dt.date.today()

    def mk(name, contact, start_off, length, status, lines, venue=""):
        start = today + dt.timedelta(days=start_off)
        jid = insert(conn, "jobs", {
            "number": next_job_number(conn, contact), "name": name, "contact_id": contact, "venue": venue,
            "start_date": start.isoformat(),
            "end_date": (start + dt.timedelta(days=length - 1)).isoformat(),
            "status": status, "created_at": now_iso(), "updated_at": now_iso()})
        for i, (pid, qty) in enumerate(lines, 1):
            p = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            insert(conn, "job_items", {"job_id": jid, "product_id": pid, "kind": "rental",
                                       "description": p["name"], "quantity": qty,
                                       "unit_price": p["day_rate"], "sort": i})
        return jid

    j1 = mk("Annual Awards Dinner", c1, 3, 2, "confirmed", [(1, 32), (2, 1), (6, 4), (7, 2), (8, 1), (9, 4)],
            "Grand Hotel Ballroom")
    insert(conn, "job_items", {"job_id": j1, "kind": "service", "description": "AV Technician (per day)",
                               "quantity": 2, "unit_price": 280, "sort": 20})
    insert(conn, "job_items", {"job_id": j1, "kind": "service", "description": "Delivery & collection",
                               "quantity": 1, "unit_price": 150, "sort": 21})
    mk("Product Launch", c2, 4, 1, "provisional", [(1, 24), (3, 1), (4, 1), (9, 2)], "Sample Conference Centre")
    mk("Sales Kick-off", c2, 12, 2, "quote", [(5, 4), (8, 1), (10, 6)])
    mk("Matchday Hospitality", c1, -1, 3, "out", [(5, 2), (11, 8)])
    # sizes for the room planner (cm) and an example package
    for like, w, d, h, shape in (("QSC K12%", 43, 36, 68, "box"), ("Line Array Top", 70, 50, 35, "box"), ("18\" Subwoofer", 60, 75, 55, "box"),
                                 ("65\" Display%", 150, 70, 180, "box"), ("Digital Mixer%", 90, 60, 25, "box"), ("Speaker Stand", 80, 80, 180, "round"),
                                 ("Moving Head%", 40, 30, 60, "box"), ("LED Wash%", 30, 20, 30, "box"), ("Lighting Desk", 100, 60, 20, "box"),
                                 ("Projection Screen%", 320, 30, 250, "box"), ("Truss 3m%", 300, 30, 30, "box")):
        conn.execute("UPDATE products SET size_w = ?, size_d = ?, size_h = ?, plan_shape = ? WHERE name LIKE ?", (w, d, h, shape, like))
    rmh = conn.execute("SELECT id FROM products WHERE name = 'Radio Mic Handheld'").fetchone()
    psu = conn.execute("SELECT id FROM products WHERE name = 'Receiver PSU'").fetchone()
    if rmh and psu:
        pkg = insert(conn, "products", {"name": "Radio Mic Rack (4 handhelds, rack powered)", "category": "Audio", "item_type": "package",
                                        "sku": "PKG-RF4", "day_rate": 90, "notes": "Receivers run off the rack's own power distro, so no PSUs."})
        comp = insert(conn, "package_items", {"package_id": pkg, "product_id": rmh[0], "quantity": 4, "sort": 1})
        conn.execute("INSERT INTO package_excludes(package_item_id, product_id) VALUES(?, ?)", (comp, psu[0]))
    fill_equip_kinds(conn)
    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
