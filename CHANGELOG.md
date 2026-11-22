# Changelog

All notable changes to TerminalHub are listed here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 1.1.2 - 2026-11-22

### Fixed

- Text copied from programs that wrap their own paragraphs, such as Claude Code, came out with a line break at the end of every row. Copy now joins those rows back into whole paragraphs and keeps the real line breaks.
- The Snippets panel showed "No snippets yet" even when there were snippets.

## 1.1.1 - 2026-11-22

### Fixed

- The downloadable app from release 1.1.0 could not start any terminal ("posix_spawnp failed"). A helper program inside the app was not marked as executable. Builds made on your own Mac were not affected.

### Changed

- The release workflow now launches the finished app and checks that a terminal opens before it publishes.

## 1.1.0 - 2026-11-22

### Added

- Tabs come back after a restart, with their folders, names, order, split panes and the tab that was open.
- A blue dot, a Dock badge and a macOS notification when a background tab finishes or rings the bell. A switch under **View > Notify When a Tab Finishes** turns the notifications off.
- `⌘1` to `⌘9` jump to a tab.
- Drag tabs in the sidebar to reorder them.
- Tab names show the folder, and a second line shows the running program and the path.
- The window remembers its size, position and full-screen state.
- Snippets can carry a folder to start in, or be a folder with no command.
- A Fonts panel to choose the terminal font and the interface font, with a size control for each.
- Figtree as the default interface font, bundled with the app.
- A bundled monospace font for Arabic letters, and right-to-left word order for lines with Arabic or Hebrew.
- A confirmation before quitting the app and before deleting a snippet.
- A greeting screen when no tabs are open.
- `⌘A` then Backspace clears everything typed, also inside full-screen programs.

### Changed

- New look: a neutral dark palette with one accent color, larger rounded panels, and a quieter sidebar.
- Keyboard shortcuts in the sidebar are folded into one row that opens on click.
- `⌘A` selects the text being typed inside full-screen programs. Before, it selected the whole screen there.
- The terminal text size set with `⌘=` and `⌘-` is now saved.

### Fixed

- Option-key characters such as `@`, `[`, `]` and `|` could not be typed on non-US keyboard layouts.
- A program installed as a version-named file showed its version number in place of its name.
- A split tab was named after whichever pane printed last. It is now named after the pane with focus.
- The dots under some Arabic letters were cut off at the bottom of a line.

## 1.0.0 - 2026-04-03

### Added

- A sidebar of terminal tabs with rename and close.
- Split panes, side by side or top and bottom, with draggable dividers.
- Snippets: saved commands that can be pasted into a tab or used to start a new one.
- Search in terminal output.
- Open a new tab in a chosen folder.
- Click on the input line to move the cursor, and select then Backspace to delete.
- Drop a file onto a pane to paste its path.
- An activity dot on each tab that pulses while output is streaming.
