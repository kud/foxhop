# @kud/foxhop-cli

The CLI and native-messaging host for [foxhop](https://github.com/kud/foxhop) — focus a
specific Firefox tab from anywhere on macOS.

> Requires the foxhop Firefox extension. See the
> [project README](https://github.com/kud/foxhop#readme) for the full setup.

## Install

```sh
npm install -g @kud/foxhop-cli
foxhop install        # register the native messaging host with Firefox
foxhop init           # seed ~/.config/foxhop/tabs.json
```

## Usage

```sh
foxhop focus chatgpt                       # focus a saved target, foregrounding Firefox
foxhop focus --match figma.com --url https://figma.com
foxhop list                                # saved targets (--json for machine output)
foxhop tabs                                # currently open Firefox tabs (--json)
foxhop add https://mail.google.com --title Gmail   # id: gmail (slug of the title)
foxhop edit gmail --url https://mail.google.com/mail/u/1   # change fields, never the id
foxhop remove gmail
foxhop sync                                # generate per-tab Raycast hotkey scripts
```

Targets live in `~/.config/foxhop/tabs.json` (the source of truth). Each has `name`,
`match`, optional `url`, `strategy` (hostname·prefix·exact·search) and `pick`
(recent·first·pinned). Set `FOXHOP_BROWSER` if you don't run Firefox Nightly.

MIT © Erwann Mest
