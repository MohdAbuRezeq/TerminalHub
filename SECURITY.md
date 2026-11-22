# Security Policy

TerminalHub starts shell processes and shows whatever they print. A flaw here can matter, so reports are taken seriously.

## Supported versions

Fixes are made on the latest release and the `main` branch. Older versions do not get updates.

## Report a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:

1. Go to the [Security tab](https://github.com/MohdAbuRezeq/TerminalHub/security) of this repository.
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

If that option is not available, contact the maintainer through the options on their [GitHub profile](https://github.com/MohdAbuRezeq) and ask for a private channel. Do not include the details in a public message.

## What to expect

- A first reply within 7 days.
- An assessment of the report, and a plan if it is confirmed.
- Credit in the release notes when the fix ships, unless you prefer to stay unnamed.

Please give a reasonable amount of time for a fix before you publish details.

## What counts

Reports that are especially useful:

- Text printed in a terminal that makes the app run a command, read a file, or leave its sandbox
- A way for page content to reach Node.js or Electron APIs beyond what `preload.js` exposes
- A way for one terminal to read from or write to another that it does not own
- Saved data (`state.json`, `snippets.json`) that can make the app run code when it is loaded
- A dependency with a known flaw that can be reached from this app

## What does not count

- A command that does damage after you typed or pasted it yourself. A terminal runs what it is given.
- Snippets you saved yourself that run harmful commands.
- The macOS warning about an unsigned app. This is expected, and the README explains it.
- Problems that need an attacker who already controls your user account.

## How the app is built to limit damage

- The page runs with `contextIsolation` on and `nodeIntegration` off.
- A content security policy blocks remote content, inline scripts and network connections from the page.
- The page can only call the functions listed in `preload.js`.
- Each terminal belongs to the page that created it. The main process checks this on every input, resize and close.
- Text from users and from the shell is placed in the page with `textContent`, not `innerHTML`.
- Saved tabs are validated when they are loaded. A folder that no longer exists falls back to the home folder.
