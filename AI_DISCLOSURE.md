# AI disclosure

Horan Event Tracking was written almost entirely by an AI model. This page explains who did what, which AI model wrote each version, and what that means for you if you use or change it.

## In short

- **Written by:** Anthropic's Claude, an AI model, working in Anthropic's Claude app. It writes, edits and tests code in a private cloud workspace.
- **Directed by:** James Horan (Horan AV), who owns the project. James decided what to build and how it should behave. He tried each version on his own computers and server and reported problems, often with screenshots. He chose what to release.
- **AI-written:** practically everything in this repository is. That covers the Python server, the JavaScript, HTML and CSS front end, the installers and shell scripts, the macOS package builder, the README, the in-app help text and the change log. Where James supplied wording or a design (for example the brand, the logo and the name), the AI built it into the app.
- **No third-party code is included.** The app uses only Python's standard library and plain browser JavaScript. See "Data and sources" below for the small amount of reference data that came from elsewhere.

## Which model wrote each version

The model was recorded only where the development logs still exist.

| Versions | Model | How we know |
| --- | --- | --- |
| **1.16.0 – 1.21.0** (3–5 Nov 2026) | **Claude Opus 5.5**, model ID `claude-opus-5-5` (Anthropic) | The development log records the model on every AI response. All 556 recorded responses in this period (counted when 1.21.0 was prepared) came from `claude-opus-5-5`. |
| **1.0.0 – 1.15.0** (to 3 Nov 2026) | **Claude (Anthropic): exact model not recorded** | These versions were made earlier in the same long project conversation. The detailed log of that part was later condensed into a summary to save space, and the summary didn't keep the model ID. The project was being worked on by Claude throughout, but we can't confirm which Claude model wrote each of these versions, so we don't claim one. |

The same information is in the app under **Settings → Change log**. Each version has a line starting 🤖. It's also in [`static/changelog.json`](static/changelog.json), in the `ai` field of each version. Future versions should keep filling in that field.

The change log for versions 1.0.0 to 1.18.0 was itself written by the AI in version 1.19.0. It rebuilt the history by comparing the README and files inside each earlier release zip. The descriptions are accurate to those files, but they were written after the fact.

## How the work was done

1. James described what he wanted in plain English. For example: "add the ability to attach sub hire into existing stock (e.g. I own 2 K12 but I sub hire 4)".
2. Claude read the existing code and wrote the change. It then tested the change in its workspace:
   - automated requests against a running copy of the server;
   - a real headless browser (Chromium, driven by Playwright) clicking through the screens, checking the results and taking screenshots;
   - Python 3.9 compatibility checks;
   - upgrade tests that open a database from the previous version.
3. Claude built the release files: the `.zip`, and the macOS `.pkg` (assembled on Linux). It wrote the change log entry and README updates.
4. James installed the release, used it, and asked for fixes or new features.

For facts about the outside world, Claude searched the web and read the official help pages before writing the code. Examples are the invoice import formats of QuickBooks Online, Xero, Zoho Books and Sage, and GitHub's releases API. Those pages are linked from the conversation where each feature was built. They aren't copied into the code.

## Data and sources

- **PDF font measurements:** invoice PDFs use the standard Helvetica font built into every PDF reader. To lay text out correctly, the app contains a table of Helvetica character widths (`HELV_W` and `HELV_BOLD_W` in `server.py`). These numbers were taken during development from Adobe's standard font metrics (the "Core 14" AFM data, read through the ReportLab library). They are measurements, not font files, and no font is included.
- **Sample data** (`--demo`) and all example names, companies and addresses are made up.

## What this means for you

- **Check it before relying on it.** The AI tested a great deal, but AI-written code can still contain mistakes. Like any open-source project, it comes with no warranty (see [LICENSE](LICENSE)). Check invoices, VAT and exports against your accounting software before relying on them.
- **Not tested by the AI**, because its workspace couldn't do these. James may have checked some of them on his own systems:
  - starting at boot with a real `systemd`;
  - signing into Zoho Books and sending a live invoice;
  - importing the exported files into a real QuickBooks, Xero, Zoho Books or Sage account;
  - checking a real GitHub repository for updates (a stand-in for GitHub's API was used);
  - installing the `.pkg` on a real Mac.
- **Network use:** it's built for a trusted local network. It uses plain `http`, not encrypted `https`. See [SECURITY.md](SECURITY.md).

## Contributing with or without AI

Contributions are welcome either way. If AI helped with a contribution, please say so in the pull request and name the tool and model if you know it. Add the same to the `ai` line of the change log entry. Commits made with Claude's help carry a `Co-Authored-By: Claude …` line, so the history shows it too.
