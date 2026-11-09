# Change log

Every version of Horan Event Tracking. The same list is in the app under **Settings → Change log**. The 🤖 line on each version says which AI model wrote it; see [AI_DISCLOSURE.md](AI_DISCLOSURE.md).

## 1.26.1 — 2026-11-09 · Job history, VAT fixes

- A job's History card now links to that job's own history (See all), instead of the activity for everything. Items do the same.
- Not VAT registered: accounting exports now always use the no-VAT code, even if a VAT code was typed in under External software → Accounting software.
- Settings warns if something you saved didn't stick, which can happen if the app hasn't restarted properly after an update.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.26.0 — 2026-11-09 · Your own icons, scan sounds, document layouts and barcode labels

- Change any sidebar icon, and give each stock category an icon: pick from the built-in icons or upload an SVG or PNG (Settings → Customisation → Icons).
- Your own scan sounds for a successful scan, a warning and a failed scan: MP3, WAV, Ogg/Opus, FLAC or WebM (Settings → Customisation → Scan sounds).
- Lay out quotes and invoices your way: layout options with a live preview (logo position and size, colour, text size, title, header and footer text, which columns and details show, and the order of notes, payment details and terms), or your own HTML template with Refresh preview. Quotes and invoices can share one layout or have their own. The PDF download follows the layout.
- Print barcode labels for items and units on A4 label sheets or a label printer, from an item's page or for everything listed on the Stock page. Items without a code can be given one.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.25.0 — 2026-11-09 · Tidier settings, in tabs

- Settings is now in tabs: Users, Customisation, Company information, Electrical, External software and Updates. Save settings still saves every tab at once.
- Tabs that only hold admin settings are hidden from everyone else. Non-admins see Updates, with their own details and the change log.
- Downloading a database backup or the JSON export is now for admins only. A backup holds everything, including PINs and connection details, so other users could previously download it.
- New accounting export: Other software (generic CSV), with plain columns that FreeAgent, KashFlow, Clear Books, QuickFile and other accounting / Making Tax Digital software can map when importing. Choose it under Settings → External software.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.24.0 — 2026-11-09 · VAT registration setting

- New setting: VAT registered (Settings → Money & numbering). Untick it if your business isn't registered for VAT: no VAT is added to or shown on jobs, quotes, invoices, PDFs or Zoho invoices, exports use "No VAT", and your VAT number is left off documents.
- ROI calculator: the result cards no longer overlap when a figure is long; they wrap inside their box, and sit one per row when the column is narrow.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.23.0 — 2026-11-09 · ROI calculator and day rate suggestions

- Return on investment card on every equipment, power and flight case item: what it's earned (last 12 months, since its first hire, booked ahead), and a calculator for revenue, profit, payback time and return over its life.
- Day rate help: suggested rates to pay an item back in your target time, to match your other stock in the same category, and a 3–5% rule of thumb. Use one with a click, then save it as the item's day rate.
- Stock → ROI calculator works out whether kit you're thinking of buying is worth it, and what to hire it out for.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.22.0 — 2026-11-08 · Flight cases, client job numbers, automatic updates and a new (temporary) logo

- Flight cases: a new kind of stock with outside size, inside size and empty weight. Link a case to the item it carries (e.g. an SQ5 case to the SQ5) and it goes on jobs with that item.
- Packing flight cases at check out: scan a general case to load it, and everything scanned after is recorded as in that case. Close it with the button, or scan the close code (one code for every case, printable from Settings → Jobs).
- Each packed case can have an identifier and a room, and shows its packed weight (the case plus everything in it). Packed cases are listed at the bottom of the prep list.
- Clients can have their own job number prefix and count, e.g. ACME-1, ACME-2.
- The brand shows on each line of a job, and on printed and PDF quotes and invoices.
- Automatic updates: none, check at a set time and ask on the next page load, or install automatically at a set time (Settings → Software update).
- New, temporary app logo and icon: a flight case, with light and dark mode versions of the logo. They're placeholders — better logo designs are very welcome, so please submit yours as an issue or pull request on GitHub.
- Renaming the app (Settings → Company → App name) now changes every place it's named: messages, the sign-in page, the app-menu entry on Linux and PDF details. The built-in logo and the Horan AV credit are hidden once it's renamed.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.21.1 — 2026-11-08 · Security fixes

- Security fixes from GitHub code scanning: uploaded SVG logos are now cleaned before use, so a logo file can no longer run hidden script in the app.
- The Zoho API Console link in Settings only ever opens a normal web address.
- Text typed in the stock picker search (such as cable lengths) is always shown as plain text.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.21.0 — 2026-11-05 · Open source, and updates from GitHub

- Update from GitHub: Settings → Software update → Check for updates looks at the project's GitHub releases. Install downloads the new version, backs up your data and the current version, installs and restarts — the same as updating from a file. Works on servers too.
- Ready to publish as open source: licence, AI disclosure, contributor notes and an automatic release build on GitHub.
- The change log now says which AI model wrote each version.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.20.1 — 2026-11-05 · Hex colour codes

- Every colour picker now has a hex code box beside it (brand colours, light and dark mode colours, and room plan shapes). Type or paste a code such as #1f5c3d or #c9a, or pick a colour and the code updates.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.20.0 — 2026-11-05 · Invoice PDFs, accounting exports and your own app name

- Invoice document is back: invoice number (with an optional prefix), invoice date, due date from your payment terms, payment details and invoice terms.
- Download PDF: invoices and quotations download as PDF files, made by the app itself - also from phones. In Jobs → Invoices…, download several jobs' invoices as one PDF.
- Export invoices for QuickBooks Online, Xero, Zoho Books, Sage 50 Accounts or Sage Accounting. Choose your software in Settings (or when exporting) and you get a file it imports, with VAT codes and job discounts built into the lines.
- Each invoice's number and date are fixed the first time it's downloaded or exported, and Jobs → Invoices… shows what's already been exported. Optionally mark exported jobs as Invoiced.
- Clients have an optional accounts reference (used by Sage 50).
- Rename the app: Settings → Company → App name changes what it's called in the sidebar, the browser tab, the sign-in page and on phones' home screens.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.19.0 — 2026-11-05 · Requests, change log, overdue hires, subcategories and barcoded cables

- Requests: anyone can suggest a feature or report a problem from the new Requests page. Each request gets its own ID made from this install's ID, and Export requests gives a CSV to send in. When an update delivers a request, it's marked done and leaves the open list.
- Your details (optional): in Settings, give a Name / Alias and a Company. They're attached to requests you make, so you can be credited in this change log.
- Change log: every version's changes, from 1.0.0 onwards, in Settings → Change log. Ideas from people who gave their details are credited.
- Overdue hires: jobs show their hire period and due-back date. A job with kit still out after its return date goes Overdue automatically: on the job, in Jobs (with an Overdue filter), on the dashboard and on the prep list. Settings → Jobs sets how many days' grace before it counts as overdue.
- Sizes in cm or mm: a cm / mm switch on stock items for width, depth and height (each device remembers its choice).
- Subcategories: give stock a subcategory under its category, e.g. Lighting › IP rated, Wash or Hybrid. Stock is grouped and filtered by them, and they're included in search, import and export.
- Barcoded cables: give each cable of a length its own barcode, while keeping the lengths under one cable. The barcode list for each length is tucked away until you click Show barcodes. Scanning a cable's barcode checks out that exact cable.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.18.0 — 2026-11-03 · Sub-hired units in stock

- Add sub-hired units to a stock item's Units, alongside your own: the vendor, the dates you have them, and their barcodes. Jobs can use them on those days, and they're never counted as owned.
- Availability, the availability grid and the dashboard count sub-hired units only on the days you have them.
- Stock shows how many sub-hired units an item has next to the owned count.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.17.0 — 2026-11-03 · Sub-hire extra of what you own

- A job line that's short can sub-hire the extra from a vendor (e.g. own 2 K12s, hire in 4 more). The sub-hired units don't use your stock and are listed under Sub-hire to order and on the prep list.
- Stock items you own can have a usual sub-hire vendor and price, and the Not enough free window then offers Sub-hire the extra.
- A job's shortage is never more than it needs from your own stock.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.16.1 — 2026-11-03 · Server mode fixes

- A server stays in server mode however it's restarted, so admins can always update it from any device. New command: horan-rms headless on|off.
- The server installer works in containers without sudo (e.g. Debian on Proxmox), and says how to make it start at boot.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.16.0 — 2026-11-03 · Alternatives for linked items and packages

- Suitable alternatives are offered for linked items and package contents that are short, not just the item you added. A swapped item stays with its parent and keeps following its quantity.
- Skip the rest, when several items are short at once.

🤖 Written by Claude Opus 5.5 (model ID claude-opus-5-5, Anthropic), directed and tested by James Horan

## 1.15.0 — 2026-11-03 · Update a server from any device

- On a server with no screen, admins can install updates, roll back and restore backups from any signed-in device.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.14.0 — 2026-11-03 · Packages and room planner

- Packages: a set of stock items added to a job together. Linked items come with them, and you can leave out ones the package doesn't need (e.g. receiver PSUs in an RF rack).
- Room planner: place a job's kit, stages and your own shapes in a top-down view and a stage view, with each room's size. Prints with the job's documents.
- Stock items have an optional size (width × depth × height) and shape for the room planner.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.13.0 — 2026-11-03 · Kinds of equipment, alternatives, scanning

- Choose what kind of equipment you're adding (powered, stand, stage deck, skirt, staging accessory, other) and only its fields are shown.
- Stands: fixed, adjustable or stepped heights, and maximum load.
- Suitable alternatives: offered, with how many are free, when an item is short on a job. Nothing is swapped without you confirming.
- Lock who can edit a job (off by default).
- Free scan: scan things that aren't on the job into their own section. Notes on any checked item.
- Scan page: check items in without opening the job, or look up where something is.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.12.0 — 2026-11-02 · Users and activity

- Users with PINs, and admins. Records who creates jobs, adds items and scans each item out and in.
- Activity page, plus a History card on every job and stock item.
- Logos are scaled to fit and never cropped; Settings shows the logo's size, with a Fit to box button.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.11.0 — 2026-11-02 · Your look, vendors and server mode

- Light and dark logos, with see-through edges trimmed and no box behind them.
- Light and dark mode with your own colours, your own fonts, and your own app icon.
- Vendors, and sub-hire stock linked to the vendor you hire it from. Each job lists what to order from whom.
- Images on stock items.
- Server mode for Linux servers with no screen (Ubuntu, Debian, Fedora…), used from any browser.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.10.0 — 2026-10-30 · Use it from any device

- Network access: phones, tablets and other computers on your network use it with a passcode. The computer it's installed on is the server.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.9.0 — 2026-10-30 · Scan to set barcodes, and brands

- Track units by scanning the barcodes already on your kit, and re-label a unit by scanning.
- Scan a barcode into the Stock search to jump to that item.
- A Brand field on stock, with search and a brand filter.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.8.0 — 2026-10-30 · Stage skirts and clamps on the prep list

- Choose stage skirt height, style and colour from what's in stock.
- The prep list's stage diagram shows each numbered clamp and the skirted sides.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.7.0 — 2026-10-30 · Stage clamps and skirts

- Click joints on a stage plan to add clamps; each clamp is added to the job.
- Stage skirt quantities worked out from the stage's perimeter.
- The stage diagram is printed on the prep list.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.6.1 — 2026-10-30 · Mac installer

- A double-click .pkg installer for macOS.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.6.0 — 2026-10-30 · Mac support and stage decks

- Runs on macOS as well as Linux.
- Stage decks: enter a stage size and it works out the decks and legs from what's free, with a printed plan.
- Restore from backup, to move to another computer.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.5.2 — 2026-10-30 · Smarter cable runs

- Cable runs weigh spare cable against the number of joins, for a sensible mix of lengths.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.5.1 — 2026-10-30 · Cable run preference

- Choose Less excess cable or Fewer joins for cable runs, with a default in Settings.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.5.0 — 2026-10-30 · Power cables and chained links

- Plugs in tick for equipment, so socket counts work without a wattage.
- Extension leads are cables with lengths and work in cable runs.
- Linked items chain (a mic brings a receiver, which brings its PSU), and round up to whole items.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.4.0 — 2026-10-30 · Kinds of stock, sections and scanning

- Stock split into equipment, cables (several lengths per cable) and power distribution.
- Sections and sub-sections on jobs, with power per section.
- Check out and in by scanning barcodes or ticking items off.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.3.0 — 2026-10-30 · Units, quarantine, cable runs and power

- Track individual units, and quarantine a unit or a quantity with a reason.
- Cable runs: give a length and it picks cables from what's free.
- Power check: load, supplies needed and sockets for each job.
- Zoho Books only uses customers that already exist there.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.2.0 — 2026-10-30 · Zoho Books

- Create a job's invoice in Zoho Books as a draft in one click, and update it if the job changes.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.1.0 — 2026-10-30 · Horan Event Tracking

- Renamed to Horan Event Tracking.
- Linked accessories: items that come with a product automatically (e.g. a K12 brings a stand, loom and XLR).
- Prep list with accessories nested and a Totals to pull list.
- Update the software from a file in Settings, with roll back.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version

## 1.0.0 — 2026-10-30 · First version

- Stock, clients, and jobs and quotes with labour, sale lines, discounts and VAT.
- Availability grid and live clash warnings.
- Quotation, invoice and pick list documents with your logo.
- CSV import (Current RMS columns), CSV and JSON export, and database backups.

🤖 Written by Claude (Anthropic), directed and tested by James Horan — the exact model wasn't recorded for this version
