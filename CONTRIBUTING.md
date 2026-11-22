# Contributing to TerminalHub

Thanks for taking the time. This guide covers how to report a problem, suggest an idea, and send a change.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Report a bug

Open an issue with the **Bug report** form. A good report includes:

- What you did, step by step
- What you expected to happen
- What happened instead
- Your macOS version and Mac model
- The program running in the terminal, if it matters (for example `vim`, `ssh`, a coding agent)
- A screenshot, if the problem is visual

Check the open issues first. If someone has reported it already, add your details there.

Please do not report security problems in public issues. See [SECURITY.md](SECURITY.md).

## Suggest a feature

Open an issue with the **Feature request** form. Describe the problem you have before the solution you want. "I lose track of which tab is running my build" is more useful than "add a progress bar", because there may be a better fix than the one you first thought of.

For anything larger than a small fix, open an issue before you write code. It saves you from building something that does not fit.

## Set up

You need macOS on Apple Silicon, Node.js 18 or newer, and the Xcode Command Line Tools.

```bash
git clone https://github.com/MohdAbuRezeq/TerminalHub.git
cd TerminalHub
npm install
npm start
```

`npm install` rebuilds `node-pty` for Electron. If a terminal fails to open with a native module error, run `npm run rebuild`.

## Make a change

1. Fork the repository and create a branch from `main`. Name it after the change, for example `fix-split-divider` or `add-tab-colors`.
2. Make your change. Keep it to one topic per pull request.
3. Add or update tests when you touch anything in `lib/`.
4. Run `npm test`. All tests must pass.
5. Run the app with `npm start` and try your change by hand.
6. Open a pull request and fill in the template.

### Where code goes

- **`lib/`** holds logic with no DOM and no Electron. If your change involves a decision that can be written as a plain function (how to name a tab, where the cursor should move, how to order a list), put it here and test it.
- **`renderer/renderer.js`** connects that logic to the page.
- **`main.js`** is the only place that touches the file system, shell processes and system features.
- **`preload.js`** is the bridge between the two. Add the smallest function that does the job. Never expose `ipcRenderer` itself.

### Style

- Match the code around you. There is no linter yet, so consistency is by hand.
- Two spaces, single quotes, semicolons.
- Write comments that explain why, not what. If a line exists because of a bug or a platform quirk, say so. Much of this code works around terminal and Electron behavior that is not obvious, and those comments are what keep it from breaking again.
- Text from users (tab names, snippet names, folder paths) goes into the page with `textContent`, never `innerHTML`.
- Use plain words in the interface. "Folder to start in", not "Working directory".

### Tests

Tests use Node's built-in runner, so there is nothing extra to install.

```bash
npm test
```

They cover `lib/` only. There are no automated tests for the interface yet, so describe in your pull request how you checked the change by hand.

### Things to try before you send

Terminal apps break in ways that tests do not catch. If your change touches input, drawing or tabs, check that these still work:

- Type at a shell prompt, then inside a full-screen program such as `vim` or `less`
- Split a tab, resize the divider, close one pane
- Quit and reopen the app, and confirm your tabs come back
- Run something that prints a lot, such as `seq 1 100000`, and scroll while it runs
- Resize the window while a program is drawing

### Commit messages

Use a short prefix and a plain description:

```
fix: keep the divider when the first pane closes
feat: color tabs by project
docs: explain the first launch warning
```

Common prefixes are `feat`, `fix`, `docs`, `refactor`, `perf`, `test` and `chore`.

## Releases

Maintainers publish a release by updating the version in `package.json` and `CHANGELOG.md`, then pushing a tag such as `v1.2.0`. A workflow builds the app, signs it ad hoc, and attaches the zip to a GitHub release. The tag must match the version in `package.json`.

## Pull requests

A pull request is easy to merge when it:

- Does one thing
- Explains what changed and why
- Says how it was tested
- Includes a screenshot or short recording for visual changes
- Updates the README or CHANGELOG when behavior changes

Reviews may ask for changes. That is normal and not a judgment of your work.

## Good first changes

Look for issues labeled `good first issue`. Ideas that are always welcome:

- Fixes for a terminal program that draws or behaves wrongly
- Tests for untested parts of `lib/`
- Clearer wording in the interface or the docs
- Support for Intel Macs or Linux

## License

By contributing, you agree that your work is released under the [MIT License](LICENSE), the same as the rest of the project.
