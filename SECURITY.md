# Security

Horan Event Tracking is built to run on your own computer or a server on a network you trust, such as your office or home network.

## Know before you run it

- **No encryption:** other devices connect over plain `http`, so don't turn on network access on public or venue Wi-Fi. To use it across the internet, put it behind a VPN, or behind a reverse proxy that adds HTTPS.
- **Sign-in:** other devices need a passcode, or a user name and password.
  - After five wrong attempts, that device waits five minutes.
  - After ten wrong passwords for one person, from any devices, that person waits fifteen minutes.
- **Passwords are never stored.** The app keeps only a salted hash of each password and of the network passcode (PBKDF2-HMAC-SHA256, 600,000 rounds), which can't be turned back into the password. Nobody, including admins, can read them, and they aren't in exports.
  - New passwords need at least 8 characters, and very common ones are refused.
  - Short PINs set before version 1.27 still work, and the app asks their owner to choose a password.
  - Changing a password signs that person out on their other devices.
- **Changes from another device:** network settings and the passcode can only be changed on the computer running the app, or over SSH on a server.
- **Admin-only actions:**
  - installing updates (from a file or from GitHub);
  - restoring backups;
  - changing settings.
- **Admins only, as well:** downloading backups and exports, seeing which devices are signed in and signing them out, and the Zoho Books connection.
- **In the browser:** the app only lets its own script files run, and no other website can show it in a frame. So even if a name or note containing code were ever shown without being made safe, the code could not run.
- **Your data folder** (the database and its backups) is readable only by the account that runs the app, on Mac and Linux.
- **Spreadsheet exports:** text that a spreadsheet would treat as a formula is exported as plain text.
- **Where updates come from** (the GitHub repository) can only be changed on the computer running the app, or on a server in server mode.
- **Updates:** from a file or from GitHub, the app first checks the download is a Horan Event Tracking release and that its code is readable. It then backs up your data and the current version, and you can roll back.
- **Zoho Books:** the connection details are stored only in your own database. They're never included in exports.

## Reporting a problem

Please report security problems privately. Use GitHub's **Security → Report a vulnerability** on this repository rather than opening a public issue. Say what you found, how to reproduce it, and which version you're on.
