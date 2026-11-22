# Third-Party Notices

TerminalHub is released under the [MIT License](LICENSE). It builds on the work of others, listed here with their licenses.

## Bundled in the app

| Software | Use | License |
|---|---|---|
| [Electron](https://github.com/electron/electron) | App window and system access | MIT |
| [xterm.js](https://github.com/xtermjs/xterm.js) and its fit, search and web-links addons | Drawing the terminal | MIT |
| [node-pty](https://github.com/microsoft/node-pty) | Starting shell processes | MIT |
| [electron-store](https://github.com/sindresorhus/electron-store) | Saving snippets and app state | MIT |

## Bundled fonts

| Font | Use | License |
|---|---|---|
| [Figtree](https://github.com/erikdkennedy/figtree) by Erik Kennedy | Default interface font | SIL Open Font License 1.1 |
| [Cascadia Mono](https://github.com/microsoft/cascadia-code) by Microsoft, Arabic subset | Arabic letters in the terminal | SIL Open Font License 1.1 |

Both fonts are packaged by [Fontsource](https://fontsource.org). The SIL Open Font License allows the fonts to be used, bundled and redistributed with software, as long as they are not sold on their own. The full license text is at https://openfontlicense.org.

## Used to build the app

These tools are needed to build TerminalHub but are not part of the finished app.

| Software | Use | License |
|---|---|---|
| [esbuild](https://github.com/evanw/esbuild) | Bundling the page script | MIT |
| [@electron/packager](https://github.com/electron/packager) | Building the `.app` | BSD-2-Clause |
| [electron-rebuild](https://github.com/electron/rebuild) | Building node-pty for Electron | MIT |

## Full license texts

The complete license of every dependency ships inside its folder under `node_modules/` after `npm install`. A packaged app also includes Chromium's licenses in `LICENSES.chromium.html`.

## A note on appearance

The color palette and layout were inspired by the look of Claude's apps. TerminalHub is an independent project. It is not affiliated with or endorsed by Anthropic, and it does not include Anthropic's fonts, logos or other assets.
