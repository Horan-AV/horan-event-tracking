# Contributing

Thanks for helping. A few things keep this project easy to run anywhere.

## Ground rules

- **No dependencies:** the server uses only Python's standard library (Python 3.9 or newer), and the front end is plain JavaScript with no build step. Please keep it that way, so it installs anywhere with nothing extra.
- **Data is precious:** schema changes are added as new columns or tables in `init_db()`, and older databases must upgrade cleanly. Test by opening a database from the previous release.
- **Plain English:** wording in the app and README should be short and friendly, for people running a hire business rather than programmers.

## Running it while you work

```bash
python3 server.py --demo --data /tmp/het-dev --port 8765
```

Then open <http://127.0.0.1:8765>. `--demo` fills an empty database with sample stock, clients and jobs.

## Before opening a pull request

- `python3 -m py_compile server.py`, ideally with Python 3.9 as well as your usual version.
- `node --check static/app.js`
- Click through the screens you changed, in light and dark mode, and at phone width.
- Add a line to the top entry of `static/changelog.json`, or a new entry if you're preparing a release.

## AI-assisted contributions

These are welcome, and most of this project was written with AI (see [AI_DISCLOSURE.md](AI_DISCLOSURE.md)). Please say in your pull request if AI helped, and which tool and model if you know it. Fill in the `ai` field of the change log entry the same way. Review AI-written code as carefully as your own.

## Releasing (maintainers)

See "Publishing a new version" in the [README](README.md#publishing-a-new-version-for-maintainers).
