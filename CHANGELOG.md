# Change log

Every version of Horan Event Tracking. The same list is in the app under **Settings → Change log**. The 🤖 line on each version says which AI model wrote it; see [AI_DISCLOSURE.md](AI_DISCLOSURE.md).

## 1.30.0 — 2026-11-13 · Patch sheets, terms of hire, calendar feed, Zoho quotes, client payment terms, and fixes

- Fix: sending a job to Zoho Books marked it Invoiced, so it disappeared from your open jobs — and, because Invoiced jobs don't reserve stock, a job invoiced before its hire freed its kit for other bookings. Now the job's status only changes if you tick Mark this job as Invoiced (completed) when sending it. Invoicing several jobs with “Mark finished jobs as Invoiced” only changes jobs whose hire is over, and jobs invoiced in advance are tagged “invoiced” in the list.
- Zoho Books quotes: send a job to Zoho as a quote (an estimate), and update it later, as well as an invoice. Connected to Zoho before? Disconnect and connect once more so Zoho lets the app make quotes.
- Zoho invoices now have the same number as the app (the job number, with any invoice prefix) — or untick that in Settings to let Zoho number them. Zoho's Order Number is the client's PO from the job, never the job number. The due date and payment terms are sent too.
- Payment terms per client: Due on receipt, Net 7 to Net 90, or Due end of next month. They set the due date and are printed next to it on invoices, in exports and in Zoho. A client can also have their own invoice number prefix, used instead of your usual one.
- Terms of hire: a new document for each job (Documents → Terms of hire), with your terms from Settings and the client's name, the job's dates, times and venue filled in, and lines for both sides to sign.
- Patch: a page for each job (Documents → Patch) to give lighting DMX addresses (universe and start address per unit, with auto-addressing and overlap warnings), give wireless kit a frequency per unit (with warnings for duplicates, frequencies too close together, or outside the band), and write the audio input and output lists. It prints as a patch sheet. Set a stock item's DMX footprint, or tick Wireless, to include it.
- Stage builder: decks can be joined with bolts and nuts instead of clamps. Choose the bolt and nut items and how many bolts go in each joint; the job and the prep list get the right numbers.
- Calendar feed: a link your calendar subscribes to, showing your jobs and staying up to date (Settings → External software → Calendar feed). Apple Calendar, Outlook and Thunderbird can use it on your network; for Google Calendar and Teamup the app publishes only the calendar link with Tailscale Funnel.
- Fix: the HTTPS certificate is easier to install. Open http://<address>:8765/trust on a device for a page with the download and the steps for that device: it works before signing in and over plain http, so a browser's warning can't block the download. There's an Install in Firefox button that opens Firefox's own trust box, a .cer version for Windows and Android, and a warning when you open the app with an address the certificate doesn't cover (such as a Tailscale ….ts.net name).
- Fix: turning Tailscale on could fail with “Failed to connect to local Tailscale daemon … tailscaled.service not running”, because the app only waited two seconds for Tailscale's background service. It now waits until the service is ready, restarts it once if it doesn't come up, and if it still won't start, shows the computer's own reason.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.29.0 — 2026-11-12 · Job discount button, start and end times, easier categories and a tidier Stock page

- Discount the whole job from its own button: on a job, under Totals, press Add discount and give it as a percentage or as a fixed amount (e.g. £50 off). It shows what the job comes to as you type, and can be changed or removed the same way. A fixed amount is never more than the job itself.
- The discount shows on the quote, invoice and PDFs (“Discount (10%)”, or just “Discount” for an amount), is sent to Zoho as a percentage or an amount, and is spread across the lines in accounting exports as before.
- Start and end times on jobs: optional times next to the out and return dates (Edit details). They show on the job, in job lists and on the quote, invoice and prep list, and a copied job keeps them.
- Categories are quicker to change: Stock → More → Rename & arrange categories lists every category and subcategory. Type a new name and press Enter to rename it on every item, or drag a category onto another to make it a subcategory. Move… does the same on a phone, and also moves a subcategory to another category or makes it a main category. A category's icon goes with it when it's renamed.
- Each category and subcategory header on the Stock page also has a pencil to rename or move it.
- A tidier Stock page: categories fold away, so you see one line per category with how many items it has. Click a header to open it, or use Expand all / Collapse all. Each device remembers which are open; searching or filtering shows everything that matches.
- Import and export CSV, Print barcodes, the ROI calculator and categories are now under the Stock page's More button.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.28.1 — 2026-11-11 · HTTPS can be turned on from any device, and no stale app after an update

- HTTPS can now be turned on by an admin from any signed-in device, not just the computer running the app — useful for a server with no screen. The page reloads at the https:// address; accept the browser's warning once, then add the certificate to stop it.
- If HTTPS is switched on but can't start (for example a certificate of your own that can't be used), Settings now says why, instead of quietly staying on plain http and showing the “Turn HTTPS on” button again. Turning it on checks the certificate first and explains any problem before anything changes.
- After an update, browsers always load the new version of the app instead of a mix of old saved files and the new page. This is now built in, so the separate fix_frontend_cache.py script has been removed and isn't needed.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.28.0 — 2026-11-10 · HTTPS and remote access with Tailscale

- HTTPS: other devices can now connect over an encrypted https:// address, so passwords and data can't be read on the network. Turn it on under Settings → Users → Network access (or `horan-rms https on` on a server). It's off until you turn it on.
- The app makes its own certificate. Devices show a warning the first time; install the app's certificate on a device (the steps are shown in Settings) and the warning goes for good, even if the computer's address changes.
- Old http:// links from other devices are sent to the https:// address, and sign-ins are never accepted over plain http while HTTPS is on. The computer running the app works exactly as before.
- The app's certificate only works for local names and private addresses, so it can't be misused for websites on the internet.
- Remote access with Tailscale: Settings → Users → Remote access walks you through installing Tailscale, turning it on, signing in and adding your other devices, so you can use the app from anywhere without opening it to the internet. The computer asks for its own password when needed; the app never sees it.
- On a server with no screen, an admin can install and turn on Tailscale from another device by entering the server's admin password — only over HTTPS and as a named admin. The password is used once and never saved.
- Cleaner addresses: pages are now /jobs, /job/12 and so on, without the # in the middle. Old bookmarks and links with a # still work.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

## 1.27.0 — 2026-11-10 · Passwords, security hardening and automated tests

- Passwords instead of PINs: everyone signs in with a password of at least 8 characters, and very common ones are refused. Short PINs you already have still work, and the app asks you to choose a password.
- Change your own password under Settings → Updates → Your details. It signs you out on your other devices.
- Passwords are never stored — only a salted hash that can't be turned back into the password, now a stronger one (600,000 rounds). Existing ones are upgraded automatically the next time each person signs in.
- Browser protection: the app now only lets its own script files run and can't be shown inside another website, so code hidden in a name or note could never run.
- Admins only: signing out other devices, seeing which devices are signed in, the Zoho Books connection details, and the server's folder locations. Before, any signed-in user could do or see these.
- Sign-in: wrong passwords are now also limited per person (10 in 15 minutes), not just per device.
- Where updates come from can only be changed on the computer running the app (or a server in server mode), not by an admin on another device.
- The data folder and database are now private to the account running the app (Mac and Linux).
- CSV exports: text a spreadsheet would run as a formula is exported as plain text.
- Stalled connections are dropped after two minutes so they can't tie up the app.
- Fixed: a tinted icon on a stock category with an apostrophe or brackets in its name didn't show.
- For contributors: an automated test suite, run by GitHub on every pull request and before each release.

🤖 Written by Claude (Anthropic) using Claude Code, directed and tested by James Horan

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
