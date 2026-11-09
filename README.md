# **Meatbag ramble:**

Hello all, I'm James, and I am a AV Tech that wants to make thing work.

While I'm ok with computer stuff, I'm not much of a coder, but I also needed a tool that could do what I need to make my business work, and all the options I could find were really expensive, and I wanted a local verison, so as such I coded this. Well, Vibe-coded, so I guess I coded this in the same way I cook a burger at the drive through at McDonalds. 

While I have spent many hours trying to make this work, I cannot in good conscience make this a product I attempt to profit from, so as such I have decided to make this open source for anyone to use. If for whatever reason you use this software and read this and for some reason you're wanting to chuck me some coppers, that would be greatly appreciated [via this link](buymeacoffee.com/HoranAV).

The purpose of this software is to keep track of AV equipment rentals using a self hosted server. It has other features which I think are pretty neat, such as a power draw calculator (please take this with a pinch of salt, it is a guess, not a promise) and stage deck calculators, as well as standard invoice and prep features. It is designed as a local network software, but you can use something like Tailscale to make it accessible via the internet to make it useful on site or on the go. I may attempt to get this to function natively in the app.

This is intended for use on a linux server, although it is just a python script, so as long as you know how to install them, do what you like. you can also run it just on a machine if you don't want to have a 24/7 server. Not sure why, but that's your problem, not mine.

Ulitmately I would like to get this to the point where there is minimal AI being used, but I wanted to get the ball rolling.

Please enjoy, contribute if you want, and try not to eat it all at once.

Everything else below is AI generated

# Horan Event Tracking

Prep and event tracking for AV and event hire companies, made by Horan AV. It runs entirely on your own computer or server, on **macOS** or **Linux**, with no account and no subscription. Phones and other computers on your network can use it too.

> **Open source, written with AI.** This project is published under the [MIT licence](LICENSE). Almost all of its code and documentation was written by an AI model, Anthropic's Claude, directed and tested by James Horan (Horan AV). The full details, including which model wrote each version, are in [AI_DISCLOSURE.md](AI_DISCLOSURE.md) and in the app under **Settings → Change log**.

- **Stock**: what you own, day rates, replacement values and weights.
- **Units**: track individual units by scanning their existing barcodes, or number them automatically (e.g. K12-001 to K12-010). You can then add, remove or quarantine a specific one without creating new stock items.
- **Brands**: record each item's brand, then search and filter stock by it.
- **Quarantine**: take a unit, or a quantity of bulk stock, out of service with a reason. It stops counting as available until it's returned.
- **Three kinds of stock**: equipment (with power draw in watts or amps), cables (several lengths per cable) and power distribution (sockets and ratings).
- **Sections**: split a job into sections and sub-sections with headings. Power is worked out per section and for the whole sheet.
- **Check out / in**: scan barcodes or tick items off.
- **Use it from any device**: turn on network access, and phones, tablets and other computers on your Wi-Fi can use it with a passcode. The computer it's installed on is the server.
- **Stage decks**: enter a stage size (e.g. 6 × 4m) and it works out the decks, and optional legs, from what's free on the job's dates. Click joints on the plan to add clamps, and it works out the skirts from the perimeter. The prep list includes the stage diagram.
- **Cable runs**: tell it the length you need (e.g. 28m of XLR, 4 runs) and it picks the fewest cables from what's free. Joiners are added where a cable type needs them.
- **Power check**: estimated load, how many supplies of the chosen type a job needs (UK 13A, 16A or 32A CEE, three-phase and more), and whether there are enough sockets of each type.
- **Linked accessories**: link items to a product so they are added automatically with it. For example, a K12 speaker brings 1 × speaker stand, 1 × XLR/IEC loom and 1 × XLR. Accessories scale with the quantity and are reserved for availability.
- **Clients**: contacts and their job history.
- **Jobs and quotes**: build a job from your stock, with labour and sale lines, discounts and VAT.
- **Availability**: a day-by-day grid and live clash warnings while you build a job.
- **Documents**: branded Quotation and Prep list. Print them, or use "Save as PDF" to email them.
  - The prep list nests accessories and cable runs under their item and adds a **Totals to pull** list, so XLRs from speakers and cable runs show as one figure. It also includes the power summary.
- **Zoho Books**: one click on a job creates the invoice in Zoho Books as a draft, for a customer that already exists in Zoho. The dashboard lists returned jobs that are ready to invoice.
- **Vendors and sub-hire**: keep the companies you hire from, mark stock as sub-hired from one of them (or sub-hire extra of kit you own), and every job lists what to order from whom.
- **Images**: add photos to any stock item. The main one shows in Stock and when adding kit to a job.
- **Your look**: light and dark logos, your own app icon, light and dark mode with your own colours, and your own fonts.
- **Server mode**: run it on a Linux server with no screen (Ubuntu, Debian, Fedora…), and everyone uses it from their own browser.
- **Settings**: company details, Zoho Books, network access, and **update the software** from a file.
- **Import and export**: CSV import that recognises Current RMS export columns, CSV export, a JSON export and a one-click database backup.
- **Requests and change log**: suggest features or report problems in the app and export them as a CSV; every version's changes are in Settings → Change log, crediting whoever suggested them.

It needs no internet connection and no account. Only the optional Zoho Books button goes online. It uses only Python 3.9+ and SQLite. They come with Bazzite; on a Mac, the installer fetches them with Apple's free developer tools if needed.

## Install on a Mac

Use the installer: **Horan-Event-Tracking-<version>.pkg**.

1. Double-click the `.pkg` file.
2. Click **Continue**, then **Install**, and enter your Mac password when asked (this is normal for anything that installs into Applications).
3. Horan Event Tracking opens in your browser. Next time, open it from Launchpad or Spotlight.

**"Apple could not verify…" message.** The installer isn't signed with an Apple Developer certificate yet, so macOS asks you to confirm it once:

- **macOS 15 (Sequoia) and later:** click **Done**. Then open **System Settings ▸ Privacy & Security**, scroll down, click **Open Anyway** next to the Horan Event Tracking message, and confirm.
- **macOS 14 and earlier:** right-click (or Control-click) the `.pkg`, choose **Open**, then **Open** again.

**First time only.** If your Mac doesn't yet have Apple's free **Command Line Tools**, the app offers to install them. This is a one-off download of about 5–10 minutes. Click **Install Tools**, and open Horan Event Tracking again when it finishes.

Notes:

- A small background helper starts at login. macOS may show a **"Background Items Added"** notification for it.
- **To uninstall,** drag Horan Event Tracking from Applications to the Bin. The background helper removes itself, and your data is kept in your Library folder.
- **To update,** use a newer `.pkg` or the app's own **Settings → Software update**.
- Your brand font, **Myanmar MN**, comes with macOS. Safari, Chrome and Firefox all work.

| What | Where (Mac) |
| --- | --- |
| App | `/Applications/Horan Event Tracking.app` |
| Your data (database with images and logos, backups) | `~/Library/Application Support/Horan Event Tracking/data` |
| Log | `~/Library/Logs/Horan Event Tracking.log` |

<details><summary>Installing from Terminal instead</summary>

Run `bash install.sh` from the unzipped folder. This puts the app in the Applications folder inside your home folder, with no password needed.
</details>

**Building or signing the installer.** `python3 macos/build_pkg.py` builds the `.pkg`. On a Mac with an Apple Developer ID you can sign it: `--sign "Developer ID Installer: Your Name (TEAMID)"`. Then notarise it with `xcrun notarytool submit … --wait` and `xcrun stapler staple …`, and the "could not verify" step goes away.

## Install on Bazzite (Linux)

1. Extract the zip.
2. Open a terminal (Konsole or Ptyxis) in the extracted folder and run:

   ```bash
   bash install.sh
   ```

3. Open **Horan Event Tracking** from your app menu. It opens in your browser at <http://127.0.0.1:8765>.

Everything installs into your home folder. It does not need `sudo` or `rpm-ostree`, and it survives Bazzite system updates. A small background service starts it at login. Use `bash install.sh --no-service` if you'd rather it only runs when you open it.

| What | Where (Linux) |
| --- | --- |
| App | `~/.local/share/horan-rms/app` |
| Your data (database with images and logos, backups) | `~/.local/share/horan-rms/data` |

## Moving to another computer (e.g. Bazzite → Mac)

1. On the old computer: **Settings → Your data → Download database backup**.
2. On the new computer, install the app, then use **Settings → Your data → Restore from backup…** and choose that file.

Everything comes across: stock, units, images, vendors, jobs, clients, settings, logos, app icon, fonts and the Zoho connection. A copy of what was on the new computer is kept in its backups folder first.

## Updating

The easy way is in the app:

1. Go to **Settings → Software update**.
2. Choose **Install update from file…** and pick the new `.zip`.

Before installing, the app takes three safety steps:

- It checks the file is a genuine Horan Event Tracking release and that it isn't damaged.
- It backs up your database and the current version.
- It installs the new version and restarts itself.

If something isn't right afterwards, use **Roll back to previous version**. Your data stays as it is either way.

Re-running `./install.sh` from a newer zip also works.

**From GitHub.** **Settings → Software update → Check for updates** looks at the project's GitHub releases:
- If there's a newer version, **Install from GitHub** downloads it and installs it with the same checks, backups and roll back as a file.
- It works on a server too, from any admin's device.
- Set the repository (`owner/name`) in the same card if yours isn't built in.
- Only this check and the optional Zoho Books button go online.

**Automatic updates.** In the same card, choose one of:
- **None.** You check yourself (the default).
- **Check at a set time, and ask me.** Once a day at the time you choose, it looks for a new release. If there is one, admins are asked to install it the next time they open a page.
- **Install automatically at a set time.** Once a day at the time you choose, it installs any new release with the same backups, then restarts. Pick a time nobody is using it, e.g. 03:00.

If the app is off at that time, it runs when it's next started that day. If GitHub can't be reached, it tries again an hour later. The result of the last run shows under the setting.

## Publishing a new version (for maintainers)

1. Change `VERSION = "..."` at the top of `server.py`, e.g. `1.21.1`.
2. Add an entry at the top of `static/changelog.json`. Include the `ai` line saying which AI model (if any) wrote the change. To credit someone's request, list its ID in `fulfils` and add `"credit": "Name · Company"` to the change.
3. Commit, then tag and push: `git tag v1.21.1 && git push && git push --tags`.
4. GitHub Actions (`.github/workflows/release.yml`) then:
   - checks that the tag matches `VERSION`;
   - builds `horan-event-tracking-1.21.1.zip` and the Mac `.pkg`;
   - publishes them as a release, with that version's change log as the notes.

   Every install's **Check for updates** then offers it.

## Your logo, icon, colours and fonts

Everything here is saved with your data, so it's in every backup and shows the same on every device.

**The app's own logo and icon.** Until you add your own, the sidebar and sign-in page show the app's logo (a flight case, in light and dark mode versions), and the app uses the matching flight case icon. These are temporary, and better designs are welcome: open an issue or pull request with your logo. Quotes, invoices and prep lists only ever show a logo you've uploaded; otherwise they show your company name.

**Logos** (Settings → Logo & app icon). Add a **light mode logo**, and optionally a **dark mode logo** that reads well on dark backgrounds. PNG, JPG, WebP or SVG all work.
- **Best size:** a wide logo about 3 : 1, e.g. **1200 × 400 px** (at least 600 px wide), or an SVG.
- It's shown up to 200 × 96 px in the sidebar, 220 × 64 px on documents and 160 × 40 px on phones. Settings shows the size of the logo you saved.
- Logos are scaled to fit and never cropped. Empty see-through edges are trimmed off so the logo fills its space.
- For SVG logos, anything drawn outside the file's own drawing area is brought back in, so text sticking out the top isn't cut off.
- **Fit to box** re-does this for a logo you've already saved.
- If part of a PNG reaches the very edge of the file, you'll get a warning. That means it may already be cut off in the file itself; re-export it with some space around it.
- There's no box behind it in the sidebar.
- The sidebar shows the version for the current mode. Printed quotes and prep lists always use the light one.

**App icon.** Choose a square image, at least 512 × 512. It's used for:
- the browser tab;
- a phone's home screen, using "Add to Home Screen";
- the app menu on Bazzite;
- Finder and the Dock on a Mac.

**Light and dark mode** (Settings → Appearance). Choose whether every device follows its own light/dark setting, or is always light or always dark.
- Anyone can switch just their own device with the moon button at the bottom of the sidebar.
- Each mode has its own colours for the background, cards, text, sidebar and sidebar text. Changes preview straight away; press **Save settings** to keep them.
- **Reset** goes back to the standard colours.
- Every colour has a **hex code** box next to its picker. Type or paste a code like `#1f5c3d` (or the short form `#c9a`), or use the picker and the code follows. This works for brand colours, the light and dark mode colours, and room plan shapes.

**Fonts.** Pick a font for text and another for headings. The choices are:
- one of the built-in styles (system, serif, rounded and others);
- a font installed on the computer, typed by name (e.g. *Myanmar MN*);
- your own font file (.woff2, .woff, .ttf or .otf) added with **Add font file…**. Added fonts work on every device and on printed documents.

## Invoices, PDFs and accounting software

**Settings → Invoices & accounting software** sets up how invoices are numbered and exported:
- **Invoice number prefix:** invoice numbers are the prefix plus the job number, e.g. `INV-HAV-1001`.
- **Payment terms (days):** set each invoice's due date.
- **Payment details** and **Invoice terms** are printed on every invoice.
- **Accounting software:** choose QuickBooks Online, Xero, Zoho Books, Sage 50 Accounts or Sage Accounting.

**One job.** Open the job and click **Invoice** under Documents:
- **Download PDF** saves the invoice as a PDF file. Quotations have the same button.
- **Export for Xero** (or whichever software you chose) saves a file to import.

**Several jobs.** Go to **Jobs → Invoices…**. It ticks jobs that are on hire or returned and not exported yet; change the ticks as you like. Then:
- **Download PDF** gives one PDF with each invoice starting on a new page.
- **Export for…** gives one import file for all of them.
- Tick **Mark them as Invoiced** to update their status at the same time.

The invoice number and date are fixed the first time an invoice is downloaded or exported. Jobs → Invoices… shows which jobs were already exported, and to which software.

| Software | Where to import |
| --- | --- |
| QuickBooks Online | Settings ⚙ → Import data → Invoices. Choose D/M/YYYY and VAT exclusive, and turn on custom transaction numbers to keep your invoice numbers. Up to 100 invoices per file. |
| Xero | Business → Invoices → Import, tax exclusive. |
| Zoho Books | Sales → Invoices → ⋯ → Import Invoices (dates are YYYY-MM-DD). Or use the one-click Zoho Books connection below. |
| Sage 50 Accounts | File → Import → Audit Trail Transactions. Each client needs a Sage account: give them an **Accounts reference** (otherwise the first 8 letters of the company name are used). |
| Sage Accounting | Sales → Quick Entries → Import; check the column mapping. |

How the lines are built:
- The job discount is built into each line, because these programs don't accept negative lines. The lines still add up exactly to the job's net.
- Free included accessories aren't billed.
- Items are named **Equipment hire**, **Sales** and **Services** (set those up once in your software), or each item's own name if you choose that.
- VAT codes default to the usual one for each program, e.g. `20.0% S`, `20% (VAT on Income)` or `T1`. Change it in Settings if yours differs.
- Set the sales account / nominal code there too (Xero: 200, Sage: 4000 by default).

## Renaming the app

**Settings → Company → App name** changes what the app is called everywhere you see it, e.g. "Smith Hire Desk":
- the sidebar, the browser tab, the sign-in page and phones' home screens;
- messages in the app (updates, network access, restarting);
- the app-menu entry on Bazzite/Linux (changed when you save on the computer running the app);
- the "made by" details inside PDF quotes and invoices.

Once renamed, the app's own "Event Tracker" logo and the "Horan AV" credit under the version are hidden too. Upload your own logo to show one. Documents use your company name. On a Mac, the app in Finder and the Dock keeps its original name.

## Invoicing with Zoho Books

### Connect once

Go to **Settings → Zoho Books** and follow the four steps shown there:

1. Pick your Zoho region. It matches the address you sign in at; for example, `books.zoho.eu` means Europe.
2. Open the Zoho API Console, choose **Add Client → Self Client → Create**, and copy the Client ID and Client Secret into the app.
3. On the **Generate Code** tab:
   - Paste the scope the app shows you (there's a Copy button).
   - Set the time duration to 10 minutes.
   - Click **Create**, choose your Zoho Books organisation, and copy the code.
4. Paste the code and click **Connect**.

Then choose your organisation and VAT rate, for example *Standard Rate 20%*, and save.

The connection is stored only on this computer. It is never included in exports. **Disconnect** removes it.

### Invoice a job

On the job, click **Create invoice in Zoho Books**. The app then:

- Finds the client among your existing Zoho customers, by email or by company/contact name. **It never creates customers.** If there's no match, you're told to add them in Zoho first, and nothing is created.
- Creates a **draft** invoice. It includes:
  - your job number (and the client's PO) as the reference;
  - one line per item, with days, day rate and any discounts in the description;
  - the job discount, and VAT on every line;
  - the job name, venue and dates in the notes. Zoho applies your usual invoice terms.
- Free included accessories are left off the invoice. Charged accessories are billed.
- Marks the job **Invoiced** (you can turn this off in Settings).

Afterwards the job shows the Zoho invoice number with three buttons:

- **Open in Zoho**: review the invoice and send it to the customer from Zoho.
- **Update in Zoho**: if the job changes, this pushes the new lines and totals to the same invoice.
- **Unlink**: forgets the link, for example if you deleted the invoice in Zoho.

If Zoho's total ever differs from the app's, you'll get a warning. That usually means the VAT setting needs checking.

## Units and quarantine

**Units.** Open an item in **Stock** and give each unit its own barcode in one of two ways:

- **Scan barcodes to track units.** Scan the label already on each unit with a USB or Bluetooth scanner. Each scan adds one unit with that barcode, and you can add a serial number before each scan. Duplicates are rejected, and so is a code another item already uses, with a message saying which item.
- **Number them automatically.** Units are numbered from the item's code, for example `AUD-K12-001`.

After that, you can:

- **scan in more units** with **Scan in units**;
- **re-label one unit** with the scanner button next to it, or click its barcode, scan, and it saves when the scanner presses Enter;
- use **+ Add units** to add more, numbered automatically or with a single barcode you type or scan;
- use **×** to remove a unit that's been sold, lost or written off.

Scan any unit or item code into the **Stock** search box and press Enter to jump straight to that item.

The owned quantity always matches the unit list. Bulk items like cables can stay as a simple quantity.

**Quarantine.** On a tracked item, press **Quarantine** on the specific unit. On a quantity item, use **Quarantine some…**. Either way, give a reason such as "failed PAT".

Quarantined stock is taken out of availability, so jobs, the availability grid and the dashboard all show the real shortfall. The **Quarantine** page lists everything out of service, with **Return to service** buttons.

## Requests, your details and the change log

**Requests** (in the sidebar) are for ideas, changes and problems:
1. Choose the type (New feature, Change to something, or Problem / bug), give it a title and some details, and click **Add request**.
2. Each request gets an ID: this install's ID plus a number, e.g. `U3BFJR-0001`. The install ID is made once, when it's first installed.
3. **Export requests (CSV)** downloads the open ones, with their IDs, who made them and the version they're on. Send that file in.
4. When an update delivers a request, installing the update moves it to **Done** with the version it arrived in, and it drops off the export.

People can edit or withdraw their own requests; admins can change any.

**Your details** (Settings, optional) are a **Name / alias** and a **Company**. They're added to every request you make. If you fill them in, the change log credits you when your idea is built ("💡 Idea from Jess · Horan AV"). With users, each person has their own details. Without users, they apply to the install.

**Change log** (Settings → Change log, or click the version number at the bottom of the sidebar) lists everything that changed in every version, from 1.0.0 onwards. It's kept up to date with each new version.

## Users and activity

Add the people who use Horan Event Tracking in **Settings → Users**. Each has a name and a **PIN** (at least 4 characters).
- The first person you add is an **admin**, and is signed in straight away.
- Once there are users, everyone signs in by picking their name and entering their PIN. This applies on the main computer and on phones and other devices on the network. Other devices then don't need the shared network passcode.
- **Admins** can change settings, logos, network access, Zoho Books and software updates, and add, edit or disable users. Everyone else can do everything else: jobs, stock, scanning, clients and vendors.
- **Switch user** at the bottom of the sidebar signs out so someone else can sign in. Disabling someone signs them out everywhere and keeps their history.
- **Locked out?** On the computer running it, run `horan-rms reset-pin "Name" --admin` (on a Mac: `python3 ~/Library/Application\ Support/Horan\ Event\ Tracking/app/server.py --reset-pin "Name" --admin`).

**Activity** (in the sidebar) records who did what, newest first, and can be filtered by person, by kind or by searching. It covers:
- creating jobs and changing their status;
- adding, changing or removing items;
- every scan or tick out and in;
- stock edits, units and quarantine;
- clients, vendors, settings and sign-ins.

The same history shows elsewhere too:
- Each job and stock item has its own **History** card.
- The job details show who created it, and each line shows the initials of whoever added it.
- On the check-out and check-in screens, each line shows who checked it, and hovering over a scanned unit shows who scanned it and when.

Without users, everything works as before, and changes are recorded as "This computer".

## Vendors and sub-hire

**Vendors** (in the sidebar) are the companies you hire kit in from. Each one has its contact, phone, email, website, your account number with them, an address and notes.

**Sub-hire stock** is kit you don't own but hire in when a job needs it. To add some, do either of these:
- Open a vendor and click **Add sub-hire item**.
- On any equipment or power item, tick **Not owned** and choose the vendor in **Sub-hire from**. You can also create a new vendor right there.

Add **their price per day** to see your margin and the cost of each order.

- Sub-hire items never show as short. In Stock and the job's equipment search they're tagged **Sub-hire · vendor name**.
- Each job has a **Sub-hire to order** card, grouped by vendor with quantities and an estimated cost.
- The prep list marks sub-hire lines and adds a **Sub-hire — order in** table with In and Back tick boxes.
- A vendor's page lists their items and every upcoming job that uses their kit.

**Sub-hired units in your stock.** When you hire kit in for a while (a week, a season, or until you send it back), add it to the item's **Units** card. Under **Sub-hired units**, click **+ Add sub-hire units** and fill in:
- who it's from;
- when it arrives and goes back (both optional);
- their barcodes, scanned one per line, or just how many (numbered e.g. AUD-K12-SH-001).

How they behave:
- They sit alongside your own units, but they're not counted as owned. The card header reads e.g. **2 owned · 2 usable · +4 sub-hired**.
- Any job on those dates can use them. Availability, the availability grid and the dashboard count them only on the days you have them.
- Their barcodes scan for check out / in like your own.
- Stock shows **+4 sub** next to the owned count.
- **Edit** changes the dates or vendor. **×** removes one when it goes back, and **Remove ended hires** clears out finished ones. Removing them never changes what you own.

**Sub-hiring extra of something you own.** Say you own 2 K12s but a job needs 6. On the job, the K12 line shows **Short** with a **Sub-hire** button. Choose how many to hire in (4), who from, and optionally what they charge per day. The line then reads **+4 sub-hire · vendor**:
- The 4 don't use your own stock, so the shortage clears and other jobs aren't affected.
- The 4 appear in **Sub-hire to order** (marked "on top of your own"), on the prep list as **4 SUB-HIRED**, and on the vendor's page.
- Your price to the client doesn't change.
- Click the badge to change the number or vendor, or to **Stop sub-hiring**.

It works on linked items and package contents too.

To have it offered automatically, set **Sub-hire from** (and their price) on the stock item. Leave **Not owned** unticked, since you own some. When you add more than you have free, the "Not enough free" window then offers **Sub-hire the extra** alongside any suitable alternatives. A job's shortage never counts more than it needs from your own stock.

## Images on stock

Open a stock item and drop photos onto **Images**, or click to choose them. You can add up to 20 per item.
- They're resized to a sensible size as they're added.
- The first is the **main** image; use **Make main** to change it. It shows as a thumbnail in Stock and when adding kit to a job.
- Click an image to see it full size.

## Kinds of stock

Stock is split into three tabs, each with only the fields that matter to it. Every item can also have a **Brand** (e.g. QSC, Shure). The brand shows next to the name, can be searched, and has its own **All brands** filter. It also comes in from Current RMS CSV imports when there's a brand or manufacturer column.


| Kind | What you record |
| --- | --- |
| **Equipment** | Quantity or individual units, rates and weight, plus details for its **kind** (see below). |
| **Cables** | One cable item (e.g. "XLR Cable") with **several lengths**, each with its own quantity, code and rate. Tick **power cable / extension** to add its sockets, socket type and rating. |
| **Power distribution** | Fixed distros and boxes without a length: **number of sockets**, socket type, amp rating, and what it plugs into. |
| **Packages** | A set of stock items added to a job together, e.g. "Sennheiser 4-way RF rack". See below. |

**Packages.** Under **Stock → Packages**, add a package, then add the items in it with how many of each per package.
- Each item brings its linked items as usual, shown as a tree under it. **Untick** any this package doesn't need, and they're left out every time the package goes on a job. For example, untick the receiver PSUs when the rack runs off its own power distro, so you don't have to delete them from the prep sheet each time.
- Give the package a **price per day** to charge one price for everything in it, or leave it at 0 to charge each item at its own rate.
- On a job the package is one line with its contents underneath ("in package"). Changing the number of packages scales everything inside it.
- Availability, shortages and check out / in work item by item, so a package can never be short itself.

**Sizes.** Equipment and power items have an optional **Size** (width × depth × height) and a **shape** (box or round). These are used by the room planner. The **cm / mm** switch next to **Size** changes the units you type and see. Each device remembers its choice, and sizes are converted, so nothing is lost when you switch.

**Subcategories.** Give items a **Subcategory** under their category, e.g. **Lighting › IP rated**, **Lighting › Wash** or **Lighting › Hybrid**:
- Stock and the availability grid group items by category, then subcategory.
- The category filter lists each subcategory under its category, so you can pick all lighting or just the IP-rated fixtures.
- Subcategories are included in search, on the job's equipment search, on the prep list, and in CSV import (a `Subcategory` or `Sub group` column) and export.

**Kinds of equipment.** When adding or editing equipment, first choose **what kind of item it is**. Only the details that matter for that kind are shown:

| Kind | Extra details |
| --- | --- |
| **Powered equipment** (speakers, lighting, video, mixers) | **Plugs in** tick and power draw |
| **Stand, truss or rigging** | **Height** (fixed, adjustable with a lowest and highest height, or stepped heights, e.g. 1.2, 1.6, 2.0 m) and **maximum load** in kg |
| **Stage deck** | Deck width and depth, for the stage calculator |
| **Stage skirt** | Length, height, style and colour |
| **Staging accessory** (legs, clamps, steps) and **Other** (cases, drape, furniture) | Nothing extra |

Stock from older versions is sorted into kinds automatically, e.g. a deck size makes it a stage deck and a power draw makes it powered. Change any that are wrong by editing the item.

**Suitable alternatives.** On a stock item's page, add the items that can stand in for it, e.g. a K10 for a K12. **Both ways** also lists it the other way round. When you add something to a job and there aren't enough free, its alternatives are offered with how many of each are free. Choose one and how many, then press the **Swap** button to confirm. **Keep as it is** leaves the job unchanged. Nothing is ever swapped without you confirming. Short lines on a job also get an **Alternatives** button. This covers linked items and what's inside packages too. If the stands linked to a speaker, or the PSUs in a package, are short, you're offered the alternatives for those, one at a time (**Skip the rest** stops asking). A swapped linked item stays under its parent and keeps following its quantity, and stays included if it was included. Swapping inside a package only changes that job, not the package itself. Parts a stage or cable run adds for itself (legs, clamps, skirts) are changed on the stage instead.

**Power draw.** Enter watts *or* amps and the other is worked out at your mains voltage (Settings → Power).

**Plugs in.** Tick this for anything that needs a mains socket. Every ticked item counts as one socket when a job works out how many extension leads it needs, even if you don't know its wattage. You'll get a warning that the load may be higher.

**Power cables.** Extension leads and power cables are cables with lengths, so they work in cable runs. In a run of extensions, only the sockets on the **last** cable count as free, because each earlier one powers the next.

**Cables.** When you add a cable, you can type its lengths straight away, e.g. `3m × 20, 5m × 20, 10m × 40`. On the cable's page you can:

- add more lengths (adding an existing length adds to its quantity);
- edit each length's owned quantity, code and rate in place;
- quarantine some of a length;
- remove a length.

Upgrading from 1.3 merges your separate XLR, HDMI and other cables into one cable item per type automatically.

## Barcoded cables

Cables can have individual barcodes, one per cable, while staying grouped by length under one cable item (e.g. XLR Cable → 3m, 5m, 10m). On the cable's page, click **Show barcodes**. The barcode lists stay hidden until you do. Then, for each length:
- **Scan in 10m cables** scans the labels already on them, one per scan.
- **Number all 40** gives every cable of that length a numbered barcode, which you can scan over later.
- Each barcode can be edited, quarantined (⚠) or removed (×).

Once a length has barcodes, its owned quantity is the number of barcodes, and the cable's total follows. Scanning a cable's barcode at check-out ticks that exact cable, and the Scan page and Stock search find it too. Lengths without barcodes stay counted as a quantity.

## Cable runs

1. Give each cable a **cable type**, and set **To extend it, join with** if it needs a joiner, e.g. an HDMI barrel. A joiner that is itself a cable adds its length; a connector block doesn't.
2. On a job, use **+ Cable run**, or type e.g. `xlr 28m` in the Add equipment box.

Each run uses the lengths free on the job's dates. It weighs spare cable against the number of joins, so you get a sensible mix rather than a pile of short cables or a lot of waste. For example, 24m from 3m and 10m cables gives **2 × 10m + 2 × 3m** (2m spare).

In the cable-run window, choose how much a join matters:

- **Less excess cable**: one join is worth about 1m of spare. With 3, 5, 10 and 20m stock, 28m gives 1 × 20m + 1 × 5m + 1 × 3m (exact).
- **Fewer joins**: one join is worth about 3m of spare. The same 28m gives 1 × 20m + 1 × 10m (2m spare).

Set the default in **Settings → Power & cable runs**. You can still switch for each run.

## Stage decks

1. In **Stock**, open each deck item, e.g. "Stage Deck 2m × 1m", and fill in **Deck width** and **Deck depth**.
2. On a job, click **+ Stage**, or type e.g. `stage 6x4` in the Add equipment box.
3. Enter the width, depth and how many identical stages you need. Choose which deck sizes to use and, optionally, the **legs** and how many per deck. The height is just a label, e.g. "40cm".

It works out the layout using the **fewest decks**, only from decks free on the job's dates. If you're short of one size, it fills that part with your other sizes. You see a **plan of the layout** before adding it.

- If the size can't be built exactly from your decks, it tells you the nearest size it can build. For example, 7 × 3.5m from 2×1 and 1×1 decks becomes 7 × 4m.
- The stage appears on the job as one line with its decks and legs underneath. Changing the number of stages scales everything.
- Anything linked to a deck in Stock is added too.

### Clamps and skirts

- **Clamps:** add a clamp item to Stock with "clamp" in its name, e.g. "Stage Deck Clamp". After you add a stage, its plan opens. Every joint between two decks shows as a dot, with one per metre of shared edge. **Click a dot to add a clamp** and click it again to remove it. **Clamp every joint** and **Clear clamps** do them all at once. Each clamp is added to the job's list straight away. You can also tick **Clamp every joint now** when adding the stage.
- **Skirts:** open each skirt item in Stock and fill in its **Skirt length** (e.g. 3, 2 and 1 for 3m, 2m and 1m skirts). Also fill in its **Skirt height** (cm), **Skirt style** (e.g. Box pleat, Ruched) and **Skirt colour**. If you leave the height blank, it's read from the name, e.g. "Stage Skirt 40cm × 3m".
- When adding a stage or in its plan, choose the skirt's **Height, Style and Colour**. These boxes only offer combinations you actually have in stock. Typing a stage height such as "60cm" picks the matching skirt height for you.
- Choose which sides get a skirt (front, left and right by default). Click a side on the plan or tick it. It works out the pieces for each side from the stage's perimeter, using the fewest pieces and then the least overlap. For example, a 4m side gets 3m + 1m.
- Reopen the plan any time with **plan, clamps & skirts** on the stage's line.
- The **prep list** includes a full-size diagram of each stage, with each clamp as a numbered red dot (the same numbers as in the plan) and skirted sides in gold. It also states the skirt height, colour and style. Next to it is that stage's pull list and the skirt pieces for each side.

## Sections and headings

On a job, **+ Section** adds a heading, e.g. *Main stage* or *Breakout room 2*, with an optional note underneath. Each section's **+ Sub-section** adds one level below, e.g. *Stage left PA*.

- **Add here** on a section (or the **Add to** box) sends new equipment and cable runs into it.
- **⇅** on a line moves it to another section. Its accessories and run cables move with it.
- ✎ edits a heading, ↑ ↓ reorder sections, and × removes a section without removing its equipment.

**Power per section.** Every section and sub-section shows its own power draw, amps, supplies needed and sockets. A section's figure includes its sub-sections. The prep list is printed in section order, with the same figures on each heading and a **whole-sheet** power summary at the bottom.

## Hire periods and overdue

Every job shows its **hire period** and **due-back date**, e.g. "13 days hire · due back 13 Dec", on the job and on the quotation, invoice and prep list.

A job goes **Overdue** automatically when kit is still out after its return date. Kit counts as still out if the job is **On hire**, or if items were scanned out and haven't all been scanned back in. For example, a 13-day hire due back on the 13th is overdue on the 14th if the kit isn't back. Overdue shows in these places:
- on the job, with a red banner saying how many days late it is;
- in **Jobs**, with an **Overdue · 2 days** tag and an **Overdue** filter;
- on the dashboard, under **Overdue returns**;
- stamped on the printed prep list.

To give some grace, set **Settings → Jobs → Days' grace before a hire is overdue**, e.g. 2. To clear it, check the kit in and set the job to Returned. If the hire was extended, change the end date instead.

## Checking out and in (scanning)

On a job, click **Check out** (or **Check in**):

- **Scan** with a USB or Bluetooth barcode scanner. They type like a keyboard, so just scan into the box. You can also type an asset number or item code and press Enter.
  - An **asset number** ticks that exact unit and lists it under the line.
  - An **item code** ticks one of that item.
  - A beep and colour tell you if the code isn't on the job, was already scanned, is quarantined, or you already have them all.
- **Tick by hand** with **+ / −**, **✓ All**, or **Tick everything**.
- Click × on a scanned asset to undo it.

When everything is checked, you're offered **Mark job as On hire** (out) or **Returned** (in). Progress for both shows on the job page.

- **Free scan.** Tick **Free scan** under the scan box (it's remembered on that device). Anything you scan that isn't on the job is then recorded in its own **Free scan — not on the job** section instead of being refused. There, **Add to job** puts it on the job's equipment list, and **Remove** deletes those scans.
- **Flight cases.** See [Flight cases](#flight-cases) below.
- **Notes.** Every item, including free-scanned ones, has **+ Add a note**, e.g. "lens scratched". Type the note and press Enter. Notes are saved separately for check out and check in, show who wrote them, and appear in Activity.

## Flight cases

Add them under **Stock → Flight cases**. Each case has an outside size, an inside size (so you know what fits) and an empty weight. Give each case its own barcode under **Units**.

- **Made for an item** (e.g. an SQ5 case for the SQ5). The case becomes a free linked accessory of that item, so it goes on a job with it, shows under it on the prep list and is scanned like any other item.
- **General** (a trunk, a cable case). At **check out**, scanning it asks **Load flight case?**. Everything you scan after that is recorded as packed in it. A banner shows the case being packed, with its item count and weight.
- **Closing a case.** Press **Close case**, or scan the close code. One close code works for every case. It's `CLOSE-CASE` unless you change it under **Settings → Jobs**, where you can also print it as a barcode label.
- **Identifier and room.** In the **Flight cases** card under check out, give each case an identifier (e.g. "Case 3") and a room. **Pack into it** carries on packing a closed case, and **Unload** forgets the case (its items stay checked out).
- **Weight.** Each case shows its packed weight: the empty case plus everything in it.
- **Prep list.** Packed cases are listed at the bottom, with identifier, room, contents and weight. The total weight adds the general cases' own weight.

## Return on investment and day rates

Every equipment, power and flight case item has a **Return on investment** card on its page. For kit you haven't bought yet, use **Stock → ROI calculator**.

**What it's earned** (for items in stock). This comes from confirmed, on-hire, returned and invoiced jobs:
- revenue and unit-days out over the last 12 months, and since its first hire;
- how much of its purchase price it has earned back;
- the average discount given;
- firm bookings that haven't started yet.

**The calculator.** Change any of these and the results update straight away:
- purchase price, units and day rate;
- hire days a year per unit;
- average discount;
- running costs a year (servicing, PAT, insurance);
- useful life;
- how soon you want it to pay back.

Hire days are filled in from the item's history once it has 3 or more hires. Otherwise it starts at a guess of 40 for you to change.

It shows:
- revenue and profit a year;
- how long it takes to pay for itself;
- the return over its life;
- how many hire days a year it needs to break even.

**Suggested day rate.** Three suggestions, each with a **Use** button:
- **Pays back in your target time**, at the hire days and discount you entered. You're warned if that's far above the usual range.
- **Like your other stock**: the median day rate as a share of purchase price for your items in the same category, or across all your stock.
- **Rule of thumb**: about 3–5% of the purchase price per day. This is a starting point only, so check what others charge locally.

On an item's page, **Save as the day rate** updates its rate for new quotes. Quotes already made keep their prices.

## Client job numbers

A client can have their own job number prefix and count. Edit the client and fill in **Job number prefix** (e.g. `ACME-`) and, if you like, **Their next job number**. Their new jobs are then numbered ACME-1, ACME-2… and everyone else's keep your usual numbering. A job keeps its number if you change its client later.

## Room planner

On a job, click **Room plan** under Documents.

- **Rooms:** set each room's name, width, depth and ceiling height in metres. **+ Room** adds another room, e.g. a breakout space.
- **Adding things:** the left-hand list shows everything on the job with how many are placed so far, e.g. 2/4. You can add:
  - one at a time, by clicking an item;
  - all of them in tidy rows, with **Place everything not yet placed**;
  - stages from the job, at their real size;
  - your own **shapes** (round tables, a bar, an FOH desk).
- **Moving things:** drag in the **top-down** view, with the stage end at the top and the audience at the bottom. Dragging in the **stage view** moves things left and right and up and down, i.e. their height off the floor.
- **Changing one thing:** click it to change its label, size, height off the floor, angle, shape and colour, or to put it **on the stage**, duplicate it or remove it. Keys: arrows nudge it (Shift for 50 cm), R rotates by 15°, Delete removes it.
- **Sizes:** they come from each stock item's **Size**. Items with no size are drawn as 50 cm boxes until you add one, and stage decks use their deck size. Labels that don't fit a shape are shortened to initials, e.g. RMH, and the printed plan has a key.
- **Saving and printing:** the plan saves as you go. **Print** gives a Room plan document with both views for every room. It's also a tab next to Quotation and Prep list.
- **Locked jobs:** if the job is locked, its plan is view-only for everyone except the people who can edit the job.

## Scan page (check in from anywhere, or look up)

**Scan** in the sidebar has a big scan box with two modes:

- **Check in:** scan an item and it's checked back in to the job it went out on, without opening the job.
  - A **unit** goes back to the job it was scanned out on.
  - An **item code** goes back to the job that has some of it out. If several jobs have it out, you pick which one it's coming back from.
  - Each scan shows the job and how many of its items are back, and the screen keeps a list of everything scanned in that session.
- **Look up only:** scan anything to see what it is and where it is, without checking anything in or out. It shows:
  - the unit or code, and any quarantine;
  - which job it's out on, since when and who scanned it;
  - every current and upcoming job it's booked on, with how many are out and back.

## Locking who can edit a job

On a job (once there are users), **Who can edit → Change** lets you choose **Anyone** (the default) or **Only these people**.
- A locked job can only be changed by the people you pick, the person who created it, and admins. That covers its details, status, items, sections, stages and cable runs.
- Everyone else can still see it, print it, and check items out and in. Its editing controls are greyed out for them.

## Power

On each job's **Power** card:

- Choose the venue supply: UK 13A, 16A, 32A or 63A CEE, or three-phase up to 125A.
- It shows the load, the supplies needed at your safe-load % (80% by default), and a comparison of all supply types.
- Sockets: one per powered item, against the sockets on the leads and distros packed.
- Suggestions offer one-click **Add** buttons.

It's a planning aid. Have a competent person check the final power plan.

## Linking accessories

Links **chain**. If a handheld mic brings a receiver, and the receiver brings a 3m XLR and a PSU, then adding handhelds adds all of them, nested on the job and the prep list. Changing the handheld quantity updates every level, and removing it removes them all. Loops (A brings B, B brings A) are blocked.

Linked quantities **round up to whole items**. Set 0.5 receivers per handheld for dual receivers: 3 handhelds gives 2 receivers.


1. Open the item in **Stock**, for example *QSC K12.2 Speaker*.
2. Under **Linked accessories**, choose an item, enter the quantity *per speaker*, and click **Link**. Repeat for each accessory.
3. Tick **Charge** if the accessory should be billed at its own day rate. Otherwise it's included free.

From then on, adding K12s to a job adds the accessories underneath them automatically:

- Changing the number of K12s updates the accessories to match.
- Removing the K12 line removes its accessories.
- You can still edit or delete an individual accessory line on a job.

Free accessories are hidden on quotations by default and never sent to Zoho. To show them on quotations as "Included", turn this on in **Settings → Documents**. They always appear on the prep list.

Linking only affects items added to a job *after* you set up the link.

## First steps

1. **Settings**: add your logo, company details, VAT number, terms and payment details.
2. **Stock**: add items, or **Import CSV** from a Current RMS product export. Then link accessories.
3. **New job**: you can also press `N` anywhere. Pick a client and dates, then type in the "Add equipment" box. Each result shows how many are free for those dates and how many accessories are linked.
4. Move the job through its statuses: Enquiry → Quotation → Provisional → Confirmed → On hire → Returned → Invoiced.

### How pricing works

- A rental line costs quantity × day rate × days, less any line discount.
- "Days" defaults to every day of the hire. To charge a week as three days, set **Chargeable days** on the job.
- Labour/service lines and sale lines cost quantity × price.
- The job discount comes off the subtotal, then VAT is added.

### How availability works

| Job status | Effect on stock |
| --- | --- |
| Confirmed, On hire | Reserves stock, including linked accessories. Over-booking shows **red**. |
| Provisional | Doesn't reserve. Shows **amber** if it would cause a shortage when confirmed. |
| Enquiry, Quotation, Returned, Invoiced, Cancelled, Lost | Doesn't affect stock. |

## Backups

- An automatic snapshot is saved each day the app runs (the last 14 are kept) and before every update. They are in `data/backups/`.
- **Settings → Download database backup** gives you a single `.db` file to keep somewhere safe.
- To restore one, use **Settings → Your data → Restore from backup…** and choose the `.db` file.

## Try it with sample data

```bash
python3 server.py --demo --data /tmp/het-demo --port 8766
# then open http://127.0.0.1:8766
```

The sample data includes a K12 speaker with linked accessories.

## Using it from other devices on your network

The computer where Horan Event Tracking is installed acts as the server. Phones, tablets and other computers on the same Wi-Fi or network can open it in their web browser. They all see and edit the same jobs and stock, live. Nothing needs installing on them.

1. On the server computer, go to **Settings → Network access**.
2. Tick **Let other devices on this network connect**, choose a **passcode** of at least 6 characters, and click **Save network access**. The app restarts in a few seconds.
3. The card then lists the address to use, e.g. `http://192.168.1.20:8765/`. Open that on the other device and enter the passcode once. The device stays signed in.

- The server computer never needs the passcode. It needs to be on, awake and running the app for other devices to connect.
- **Signed-in devices** lists every phone and computer that has signed in. **Sign out all other devices**, or changing the passcode, signs them out. Each device can also sign itself out from Settings or the sidebar.
- For safety, these can only be done on the server computer: software updates, restoring a backup, and the network settings themselves. After 5 wrong passcodes, that device has to wait 5 minutes before trying again.
- Only use this on a network you trust, such as your own office or home Wi-Fi. The connection isn't encrypted (http), so don't turn it on for public or venue Wi-Fi.
- **A device can't connect?** Check it's on the same network, not mobile data or a guest network.
  - **Bazzite / Linux:** let the port through the firewall with `sudo firewall-cmd --permanent --add-port=8765/tcp && sudo firewall-cmd --reload`.
  - **Mac:** click **Allow** if asked whether "python3" can accept incoming connections.

## Running it on a server (no screen)

You can run Horan Event Tracking on a Linux server or mini PC with no screen. Ubuntu, Debian, Fedora and most other systemd distributions work. Everyone then uses it from their own browser over the network. You need Python 3.9 or newer, which these all include (`sudo apt install python3` if it's missing).

1. Copy the zip to the server, extract it, and in that folder run:

   ```bash
   bash install.sh --headless
   ```

   Add `--port 8080` to use a different port.
2. Choose the **passcode** that devices sign in with.
3. Enter your admin password when asked. That's used once to set it to **start at boot** (it runs as you, not as root) and to open the port in **ufw** or **firewalld** if either is running.
4. It prints the address to open on other devices, e.g. `http://192.168.1.50:8765/`.

Manage it over SSH with the `horan-rms` command:

| Command | What it does |
| --- | --- |
| `horan-rms status` | Version, data folder, network on or off, and the addresses to use |
| `horan-rms passcode` | Change the passcode (signs every device out) |
| `horan-rms network on` / `off` | Let other devices connect, or not |
| `horan-rms restart` / `stop` | Restart or stop the server |
| `horan-rms logs` | Show the most recent log lines |
| `horan-rms users` | List the people who can sign in |
| `horan-rms reset-pin "Name" --admin` | Give someone a new PIN (and make them an admin) |
| `horan-rms headless on\|off` | Server mode: lets admins install updates from any device. The installer turns it on; it's remembered however the server is restarted |

**Updating a server.** From version 1.15, an admin can update it from any signed-in device. Go to **Settings → Software update → Install update from file…** and choose the new zip. The server backs up its data and the current version, installs the update and restarts, and every device then uses the new version. **Roll back** and **Restore from backup** work the same way. (Without users, anyone signed in with the passcode counts as the admin.)

To get a server running an older version onto 1.15 the first time, update it over SSH: copy the zip to the server, then run `unzip -o horan-event-tracking-1.15.0.zip && cd horan-event-tracking && bash install.sh --headless`. Your data and passcode are kept. After that, use Settings. If Settings still says updates are installed on the server itself, it isn't in server mode: run `horan-rms headless on` on the server once (this also restarts it).

In a container without `sudo` (common with Debian on Proxmox), the installer still installs and starts it but can't make it start at boot. Run the installer as root, or install sudo and add yourself to the sudo group, then run it again.

Network access and the passcode are still changed over SSH, with `horan-rms network on|off` and `horan-rms passcode`. That way nobody can lock everyone out from a browser. Backups are in `~/.local/share/horan-rms/data/backups`; download one any time from **Settings → Your data**.

## Removing

On a Mac, drag the app from Applications to the Bin. On Linux (or a Terminal install on a Mac), run `bash uninstall.sh` from the unzipped folder. This keeps your data. Add `--purge` to delete the data too.

## Troubleshooting

- **The app won't open (Linux).** Run `horan-rms` in a terminal, or check `journalctl --user -u horan-rms`.
- **The app won't open (Mac).** Check `~/Library/Logs/Horan Event Tracking.log`, or run `bash install.sh` again.
- **Your browser opens the wrong app.** Set a default browser in System Settings, or run `HORAN_RMS_BROWSER=firefox horan-rms`.

---
Horan Event Tracking v1.23.0 · © 2026 Horan AV (James Horan) · MIT licence · written with AI — see [AI_DISCLOSURE.md](AI_DISCLOSURE.md)
