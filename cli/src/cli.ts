import { defineCommand, runMain } from "citty"
import { spawn } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import {
  readConfig,
  findTarget,
  writeExampleConfig,
  upsertTarget,
  removeTarget,
  toggleFavorite,
  editTarget,
  deriveTarget,
  nameForAdd,
  CONFIG_PATH,
  STRATEGIES,
  PICKS,
  type Strategy,
  type Pick,
  type TargetPatch,
} from "./config.js"
import { sendToHost } from "./client.js"
import { SOCKET_PATH } from "./constants.js"
import { install } from "./install.js"
import { sync, clearScripts, autoSync } from "./sync.js"
import { defaultScriptsDir } from "./paths.js"
import { fileURLToPath } from "node:url"
import { bold, dim, cyan, yellow, ok, fail } from "./ui.js"

const browserApp = () => process.env.FOXHOP_BROWSER ?? "Firefox Nightly"
// Use the absolute path: `open` lives in /usr/bin, which isn't always on PATH
// (e.g. when invoked from Raycast). Swallow spawn errors so they never crash the CLI.
const runOpen = (args: string[]) => {
  const child = spawn("/usr/bin/open", args, {
    stdio: "ignore",
    detached: true,
  })
  child.on("error", () => {})
  child.unref()
}
const foreground = () => runOpen(["-a", browserApp()])
const openUrl = (url: string) => runOpen([url])

// Regenerate the Raycast scripts after a mutation — and after the one-time
// id migration, which readConfig reports through this callback. Only runs
// once the user has opted in by generating scripts at least once.
const resync = () =>
  autoSync(process.execPath, fileURLToPath(import.meta.url))

// Rejects an unknown --strategy / --pick instead of saving a value the
// extension would silently treat as the default.
const oneOf = <T extends string>(
  flag: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined => {
  if (value === undefined) return undefined
  if (allowed.includes(value as T)) return value as T
  console.error(fail(`--${flag} must be one of: ${allowed.join(" | ")}`))
  process.exit(1)
}

const focus = defineCommand({
  meta: {
    name: "focus",
    description: "Focus a Firefox tab by saved target name, or an ad-hoc match",
  },
  args: {
    name: {
      type: "positional",
      required: false,
      description: "Saved target name (see `foxhop list`)",
    },
    match: {
      type: "string",
      description:
        "Ad-hoc match sent to the extension (hostname: host equals match or is a subdomain)",
    },
    url: {
      type: "string",
      description:
        "URL to open when no tab matches — or, for a target with `navigate: true`, the URL to repoint its matching tab to",
    },
    strategy: {
      type: "string",
      description: "hostname | prefix | exact | search",
    },
    pick: {
      type: "string",
      description: "recent | first | pinned (which tab when several match)",
    },
  },
  run: async ({ args }) => {
    const request = args.match
      ? {
          op: "focus",
          match: args.match,
          url: args.url,
          strategy: args.strategy ?? "hostname",
          pick: args.pick ?? "recent",
        }
      : resolveNamed(String(args.name ?? ""), args.url)

    if (!request) {
      console.error(
        fail(
          `no target named "${args.name}". Edit ${CONFIG_PATH}, or run \`foxhop list\` / \`foxhop init\`.`,
        ),
      )
      process.exit(1)
    }

    try {
      const ack = await sendToHost(request)
      if (ack?.ok && ack.action !== "not-found") {
        foreground()
        // An extension predating navigation ignores navigateTo and just
        // focuses — the user asked for a specific page, so say so.
        if ("navigateTo" in request && ack.navigated === undefined) {
          console.error(
            fail(
              "the foxhop extension is too old to navigate tabs — update it; the tab was only focused",
            ),
          )
        }
      } else
        console.error(fail(ack?.error ?? "no matching tab and no url to open"))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      // A stale socket (host died without cleanup) refuses connections. Never
      // silently open a fresh tab on every press — that spawns endless tabs.
      // Remove the dead socket and tell the user how to repair the host.
      if (code === "ECONNREFUSED" || code === "ENOENT") {
        if (existsSync(SOCKET_PATH)) {
          try {
            unlinkSync(SOCKET_PATH)
          } catch {}
        }
        console.error(
          fail(
            "foxhop host not running. Run `foxhop install`, then restart Firefox (or reload the extension).",
          ),
        )
        process.exit(1)
      }
      // Genuine timeout (host reachable but extension never answered) — fall
      // back to opening the URL once so the action still does something.
      if ("url" in request && request.url) {
        openUrl(request.url)
      } else {
        console.error(
          fail(
            "cannot reach the host — is Firefox running with the foxhop extension?",
          ),
        )
        process.exit(1)
      }
    }
  },
})

// A named target given --url navigates its matching tab there only when the
// target opts in (`navigate: true`); otherwise --url just replaces the
// fallback-open URL, so existing tabs are never silently repointed.
const resolveNamed = (name: string, url?: string) => {
  const target = findTarget(readConfig(resync), name)
  if (!target) return null
  return {
    op: "focus",
    match: target.match,
    url: url ?? target.url,
    strategy: target.strategy ?? "hostname",
    pick: target.pick ?? "recent",
    ...(url && target.navigate ? { navigateTo: url } : {}),
  }
}

const list = defineCommand({
  meta: { name: "list", description: "List saved focus targets" },
  args: { json: { type: "boolean", description: "Output JSON" } },
  run: ({ args }) => {
    const { targets } = readConfig(resync)
    if (args.json) {
      process.stdout.write(JSON.stringify(targets, null, 2) + "\n")
      return
    }
    if (!targets.length) {
      console.log(
        dim(
          `No targets yet. Run \`foxhop init\` for an example, or edit ${CONFIG_PATH}.`,
        ),
      )
      return
    }
    const ordered = [
      ...targets.filter((target) => target.favorite),
      ...targets.filter((target) => !target.favorite),
    ]
    const width = Math.max(...ordered.map((target) => target.name.length))
    for (const target of ordered) {
      const star = target.favorite ? yellow("★") : " "
      console.log(
        `${star} ${cyan(target.name.padEnd(width))}  ${dim(target.match)}`,
      )
    }
  },
})

const tabs = defineCommand({
  meta: { name: "tabs", description: "List currently open Firefox tabs" },
  args: { json: { type: "boolean", description: "Output JSON" } },
  run: async ({ args }) => {
    const ack = await sendToHost({ op: "list" }).catch(() => null)
    const openTabs = ack?.tabs ?? []
    if (args.json) {
      process.stdout.write(JSON.stringify(openTabs, null, 2) + "\n")
      return
    }
    if (!openTabs.length) {
      console.error(
        fail("no tabs — is Firefox running with the foxhop extension?"),
      )
      process.exit(1)
    }
    for (const tab of openTabs) {
      console.log(`${bold(tab.title)}\n  ${dim(tab.url)}`)
    }
  },
})

const init = defineCommand({
  meta: {
    name: "init",
    description: "Write an example config to ~/.config/foxhop/tabs.json",
  },
  run: () => {
    const path = writeExampleConfig()
    console.log(ok(`wrote example config + schema → ${dim(path)}`))
  },
})

const installCommand = defineCommand({
  meta: {
    name: "install",
    description: "Register the native messaging host manifest with Firefox",
  },
  run: () => install(),
})

const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description:
      "Generate a Raycast script command per saved target (for per-tab hotkeys)",
  },
  args: {
    dir: {
      type: "string",
      description: `Output directory (default: ${defaultScriptsDir()})`,
    },
    clean: {
      type: "boolean",
      description: "Remove all generated scripts instead of writing them",
    },
    json: { type: "boolean", description: "Output the result as JSON" },
  },
  run: ({ args }) => {
    if (args.clean) {
      const cleared = clearScripts(args.dir)
      if (args.json) {
        process.stdout.write(JSON.stringify(cleared) + "\n")
        return
      }
      console.log(
        ok(
          `removed ${bold(String(cleared.removed))} script(s) → ${dim(cleared.dir)}`,
        ),
      )
      return
    }
    const result = sync(
      process.execPath,
      fileURLToPath(import.meta.url),
      args.dir,
    )
    if (args.json) {
      process.stdout.write(JSON.stringify(result) + "\n")
      return
    }
    console.log(
      ok(
        `wrote ${bold(String(result.written))} script(s)` +
          (result.removed ? `, removed ${result.removed} stale` : "") +
          ` → ${dim(result.dir)}`,
      ),
    )
    console.log(
      dim(
        "Add that folder in Raycast → Extensions → Script Commands → Add Directories, then assign hotkeys.",
      ),
    )
  },
})

const add = defineCommand({
  meta: {
    name: "add",
    description:
      "Add or update a target — name/match/title derive from the URL",
  },
  args: {
    url: {
      type: "positional",
      required: false,
      description:
        "URL of the tab (e.g. https://gemini.google.com) — or use --match",
    },
    name: {
      type: "string",
      description: "Override the derived id (used by `foxhop focus <name>`)",
    },
    title: { type: "string", description: "Override the derived label" },
    match: {
      type: "string",
      description: "Override the derived match (default: the URL hostname)",
    },
    strategy: {
      type: "string",
      description: "hostname | prefix | exact | search",
    },
    pick: {
      type: "string",
      description: "recent | first | pinned (which tab when several match)",
    },
    favorite: { type: "boolean", description: "Pin to the top of the list" },
    navigate: {
      type: "boolean",
      description:
        "Let `focus <name> --url` repoint the matching tab (--no-navigate to turn off)",
    },
  },
  run: ({ args }) => {
    const url = args.url ? String(args.url) : undefined
    const matchArg = args.match ? String(args.match) : undefined
    // A target needs either a URL (derive everything) or a bare match. This keeps
    // url-less targets (name+match only) editable — url is optional in the schema.
    const source = url ?? matchArg
    if (!source) {
      console.error(fail("provide a URL or --match"))
      process.exit(1)
    }
    const strategy = oneOf<Strategy>("strategy", args.strategy, STRATEGIES)
    const pick = oneOf<Pick>("pick", args.pick, PICKS)
    const derived = deriveTarget(source)
    const match = matchArg ?? derived.match
    // The id is the slug of the title (or of --name when given). Re-adding a
    // site that is already saved updates it in place; a different target is
    // never overwritten: a taken id whose match differs gets a -2, -3, … suffix.
    const { targets } = readConfig(resync)
    const name = nameForAdd(targets, {
      name: args.name,
      title: args.title ?? derived.title,
      match,
    })
    // Updating an existing target keeps whatever the flags leave unsaid — its
    // title and url, the star (toggled with `fav`), strategy, pick and navigate.
    const existing = findTarget({ targets }, name)
    upsertTarget(
      {
        name,
        match,
        url: url ?? existing?.url,
        title: args.title ?? existing?.title ?? derived.title,
        strategy: strategy ?? existing?.strategy,
        pick: pick ?? existing?.pick,
        favorite: args.favorite || existing?.favorite ? true : undefined,
        navigate: (args.navigate ?? existing?.navigate) ? true : undefined,
      },
      resync,
    )
    console.log(ok(`saved ${bold(name)}`))
    resync()
  },
})

const edit = defineCommand({
  meta: {
    name: "edit",
    description:
      "Edit a saved target in place — the id never changes (pass \"\" to clear --title or --url)",
  },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Target id to edit (see `foxhop list`)",
    },
    title: { type: "string", description: "New label" },
    match: { type: "string", description: "New match" },
    url: { type: "string", description: "New fallback URL" },
    strategy: {
      type: "string",
      description: "hostname | prefix | exact | search",
    },
    pick: {
      type: "string",
      description: "recent | first | pinned (which tab when several match)",
    },
    navigate: {
      type: "boolean",
      description:
        "Let `focus <name> --url` repoint the matching tab (--no-navigate to turn off)",
    },
  },
  run: ({ args }) => {
    const name = String(args.name)
    const patch: TargetPatch = {}
    if (args.title !== undefined) patch.title = args.title.trim() || undefined
    if (args.url !== undefined) patch.url = args.url.trim() || undefined
    if (args.match !== undefined) {
      if (!args.match.trim()) {
        console.error(fail("--match cannot be empty"))
        process.exit(1)
      }
      patch.match = args.match.trim()
    }
    const strategy = oneOf<Strategy>("strategy", args.strategy, STRATEGIES)
    if (strategy) patch.strategy = strategy
    const pick = oneOf<Pick>("pick", args.pick, PICKS)
    if (pick) patch.pick = pick
    if (args.navigate !== undefined)
      patch.navigate = args.navigate ? true : undefined
    const { found } = editTarget(name, patch, resync)
    if (!found) {
      console.error(fail(`no target named "${name}"`))
      process.exit(1)
    }
    console.log(ok(`updated ${bold(name)}`))
    resync()
  },
})

const remove = defineCommand({
  meta: { name: "remove", description: "Remove a target from tabs.json" },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Target id to remove",
    },
  },
  run: ({ args }) => {
    const { removed } = removeTarget(String(args.name), resync)
    if (!removed) {
      console.error(fail(`no target named "${args.name}"`))
      process.exit(1)
    }
    console.log(ok(`removed ${bold(String(args.name))}`))
    resync()
  },
})

const fav = defineCommand({
  meta: {
    name: "fav",
    description: "Toggle a target's favourite (pins it to the top of the list)",
  },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Target id to toggle",
    },
  },
  run: ({ args }) => {
    const { favorite, found } = toggleFavorite(String(args.name), resync)
    if (!found) {
      console.error(fail(`no target named "${args.name}"`))
      process.exit(1)
    }
    console.log(
      ok(
        `${bold(String(args.name))} ${favorite ? yellow("favourited ★") : "unfavourited"}`,
      ),
    )
    resync()
  },
})

const NAME = "foxhop"
const subCommands = {
  focus,
  list,
  tabs,
  add,
  edit,
  remove,
  fav,
  init,
  sync: syncCommand,
  install: installCommand,
}

runMain(
  defineCommand({
    meta: {
      name: NAME,
      description: "Focus specific Firefox tabs from anywhere on macOS",
    },
    subCommands,
    run: ({ rawArgs }) => {
      if (rawArgs.some((arg) => arg in subCommands)) return
      console.log(
        `Usage: ${NAME} <command>\nRun \`${NAME} --help\` to list commands.`,
      )
    },
  }),
)
