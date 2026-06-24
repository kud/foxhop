# foxhop

Focus a specific Firefox tab from **anywhere on macOS** — a global hotkey, a Raycast
command, or the terminal. Press the key and Firefox comes forward with your ChatGPT /
Todoist / whatever tab active. If the tab isn't open, foxhop opens it.

By default foxhop does nothing: it just connects Firefox to the rest of the OS. You decide
which tabs matter by listing them in `~/.config/foxhop/tabs.json` — the single source of
truth, editable by hand, by the `foxhop` CLI, or from the Raycast extension.

## Why it works this way

Firefox exposes no AppleScript on macOS, so you can't select its tabs with `osascript`, and
`open -a Firefox <url>` opens a _duplicate_ instead of focusing the existing tab. The only
API that can activate an arbitrary tab by URL is the WebExtension `tabs` API — but an
extension can't open a listening socket, so an external trigger needs a bridge.

```
caller ──► foxhop CLI ──► unix socket ──► native host ──► Firefox extension
(hotkey/Raycast/term)      ~/.foxhop.sock   (cli/)         tabs.update + windows.update
                                                            fallback: tabs.create
```

The **CLI + extension are one inseparable unit** (the bridge), so they live in this one repo.
The **Raycast extension is a separate client** and lives in the `raycast/extensions` monorepo.

## Layout

| Path         | What it is                                                           |
| ------------ | -------------------------------------------------------------------- |
| `cli/`       | `@kud/foxhop-cli` — the `foxhop` CLI + the `foxhop-host` native host |
| `extension/` | the Firefox WebExtension (MV2) that focuses the tab                  |
| `assets/`    | brand icon source                                                    |

The Raycast extension (a thin GUI over the CLI) is published separately under
`raycast/extensions/foxhop`.

## Install

```sh
# 1. Build the CLI + host, put `foxhop` / `foxhop-host` on PATH
cd cli && npm install && npm run build && npm link

# 2. Register the native-messaging host with Firefox
foxhop install

# 3. Load the extension (no signing key needed)
#    Firefox Nightly: about:debugging#/runtime/this-firefox → Load Temporary Add-on
#    → select extension/manifest.json   (persists until you restart Firefox)
#    For a throwaway test profile instead:  cd extension && npm install && npm run dev

# 4. Seed an example config (optional)
foxhop init
```

## Configure — `~/.config/foxhop/tabs.json`

```json
{
  "$schema": "./tabs.schema.json",
  "targets": [
    {
      "name": "chatgpt",
      "title": "ChatGPT",
      "match": "chatgpt.com",
      "url": "https://chatgpt.com"
    },
    {
      "name": "todoist",
      "title": "Todoist",
      "match": "todoist.com",
      "pick": "pinned"
    }
  ]
}
```

| Field      | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `name`     | id used by `foxhop focus <name>`                                                 |
| `title`    | human label (shown in Raycast)                                                   |
| `match`    | substring matched against tab URLs                                               |
| `url`      | opened if no tab matches                                                         |
| `strategy` | how to match: `hostname` (default) · `prefix` · `exact` · `search` (url + title) |
| `pick`     | which tab when several match: `recent` (default) · `first` · `pinned`            |

## Use

```sh
foxhop focus chatgpt          # focus a saved target (foregrounds Firefox)
foxhop focus --match figma.com --url https://figma.com   # ad-hoc, no config entry
foxhop list                   # saved targets   (--json for machine output)
foxhop tabs                   # currently open Firefox tabs   (--json)
foxhop add gmail --match mail.google.com --url https://mail.google.com --title Gmail
foxhop remove gmail
foxhop sync                   # generate per-tab Raycast hotkey scripts
foxhop install                # (re)register the native host manifest
```

Set `FOXHOP_BROWSER` if you don't run Firefox Nightly (e.g. `FOXHOP_BROWSER=Firefox`).

## Raycast — two ways, both driven by `tabs.json`

1. **Per-tab hotkeys (scripts):** `foxhop sync` writes one Raycast Script Command per target
   into `~/.config/foxhop/scripts`. Add that folder in Raycast → Extensions → Script Commands
   → Add Directories, then assign a global hotkey to each. Re-run `foxhop sync` after editing
   your tabs.
2. **The Raycast extension** (`raycast/extensions/foxhop`): a single "Focus Tab" command to
   search, focus, add, edit, and delete targets, plus a "Generate Hotkey Scripts" command that
   runs `sync` for you.

## Development

```sh
cd cli && npm run dev        # run the CLI from source (tsx)
cd cli && npm test           # vitest (framing, config, sync)
cd extension && npm run dev  # launch Firefox Nightly with the extension loaded
cd extension && npm run lint # web-ext lint
```

## Gotchas

- **Firefox Nightly** is the default target; `npm run dev` uses `--firefox=nightly`. Temporary
  add-ons need a **reload** (`about:debugging`) after changing `extension/src/background.js`.
- No signing key needed for personal use (temporary add-on). For a permanent install on
  Nightly / Developer Edition, set `xpinstall.signatures.required = false` and install the
  built `.xpi`.
- The native-messaging manifest's `path` is absolute — if you move this repo, re-run
  `foxhop install`. Generated scripts embed the mise Node shim, so they survive Node upgrades.
- A WebExtension can raise its own window but not its app, so the CLI foregrounds Firefox via
  `open -a "$FOXHOP_BROWSER"` after a successful focus.

## Licence

MIT © Erwann Mest
