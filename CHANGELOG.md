# Changelog

All notable changes to `@kud/foxhop-cli` are documented here.

---

## [1.1.3] — 2026-06-26

### Fixed

- **Hotkeys now focus your tab instead of opening an endless stream of new ones.** When Firefox is launched from the Dock, its `PATH` is stripped down and hides version-managed Node (mise, nvm, asdf) and Homebrew — so the native host could never start, and every hotkey press silently opened a fresh tab instead of focusing the one already open. `foxhop install` now writes a launcher that hard-codes Node's absolute path, so the host starts the same way no matter how Firefox was opened. (Re-run `foxhop install` after a Node upgrade to refresh the path.)
- When the bridge genuinely is unreachable, `foxhop focus` now clears the stale socket and prints a clear "host not running" message instead of opening a tab. The host also removes its socket on exit, so a dead socket can't linger and trigger the fallback.

## [1.1.2] — 2026-06-24

### Changed

- Nicer CLI output — `list` aligns to the longest name and colours the favourite star, name, and match; `tabs` and status lines gain colour and ✓/✗ glyphs. Colour is disabled automatically when piped or when `NO_COLOR` is set.

## [1.1.1] — 2026-06-24

### Fixed

- `add` no longer requires a URL — pass a URL **or** `--match`, so url-less targets (name + match only) can still be created and edited.

## [1.1.0] — 2026-06-24

### Added

- `foxhop fav <name>` toggles a target's favourite; `foxhop list` now shows favourites first (★).
- URL-first `add` — `foxhop add <url>` derives the name, match, and title from the URL (flags still override).
- `foxhop sync --clean` removes all generated hotkey scripts.
- Generated scripts stay mirrored to your targets automatically — once you've run `sync` once, `add`/`remove` keep the scripts folder up to date with no manual step.

## [1.0.3] — 2026-06-24

### Changed

- Generated Raycast hotkey scripts now group under "Fox Hop" (was "foxhop"); re-run `foxhop sync` to update existing scripts.

## [1.0.2] — 2026-06-24

### Highlights

- **Full project launch.** Foxhop is a macOS native-messaging bridge that lets you focus a specific Firefox tab from anywhere — CLI, Raycast hotkey, or shell script. The stack: a TypeScript CLI (`@kud/foxhop-cli`), a native-messaging host, and a Firefox WebExtension (MV2) that wires them together. ([9bc973f](https://github.com/kud/foxhop/commit/9bc973f))

- **Config-driven tab registry.** Tabs are declared in `~/.config/foxhop/tabs.json` with per-entry `match` and `pick` strategies, giving you precise control over which tab wins when multiple candidates match. The `init` command bootstraps the config file, `add` and `remove` manage entries, and `list` shows what is registered.

- **Rich command surface.** Eight commands ship in 1.0: `focus` (activate a tab by name), `list` (show registered tabs), `tabs` (inspect all open Firefox tabs), `add` / `remove` (manage the registry), `sync` (generate Raycast hotkey scripts for every tab), `init` (first-run setup), and `install` (register the native-messaging host with Firefox).

- **Raycast integration.** `sync` writes per-tab Raycast script commands into a scripts directory, including an embedded PNG icon so no external asset is needed. Scripts are ready to assign global hotkeys immediately. The companion Raycast extension lives alongside the CLI in the same repository. ([36f04af](https://github.com/kud/foxhop/commit/36f04af))

- **Machine-readable output.** `sync` gained a `--json` flag for scripting and automation use cases. ([36f04af](https://github.com/kud/foxhop/commit/36f04af))

### Fixes

- **Raycast crash on focus.** `foxhop focus` was crashing with an unhandled `error` event when spawned from environments (such as Raycast) that do not have `/usr/bin` on `PATH`. Fixed by using the absolute path `/usr/bin/open` and attaching an error handler to suppress spawn errors rather than letting them bubble up. ([679f853](https://github.com/kud/foxhop/commit/679f853))

- **Bare invocation no longer silently exits.** Running `foxhop` with no subcommand now prints a concise usage hint instead of doing nothing. ([b759d65](https://github.com/kud/foxhop/commit/b759d65))

### Internal

- CI (GitHub Actions) covers test and lint on every push. Extension publishing uses `web-ext` with an AMO Developer Hub fallback; `web-ext` bumped to 10.4.0 and data-collection permissions added to the manifest for AMO compliance. ([25092fb](https://github.com/kud/foxhop/commit/25092fb), [c86d09b](https://github.com/kud/foxhop/commit/c86d09b))
- Package configured for public npm publishing under the `@kud` scope with `prepublishOnly` build guard. ([e98f22b](https://github.com/kud/foxhop/commit/e98f22b))
- Documentation extracted into `docs/*.mdx` pages with a slimmed hero README. ([879a42f](https://github.com/kud/foxhop/commit/879a42f))
