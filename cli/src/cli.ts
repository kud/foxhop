import { defineCommand, runMain } from "citty"
import { spawn } from "node:child_process"
import {
  readConfig,
  findTarget,
  writeExampleConfig,
  upsertTarget,
  removeTarget,
  CONFIG_PATH,
  type Strategy,
  type Pick,
} from "./config.js"
import { sendToHost } from "./client.js"
import { install } from "./install.js"
import { sync, defaultScriptsDir } from "./sync.js"
import { fileURLToPath } from "node:url"

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
      description: "Ad-hoc substring to match against tab URLs",
    },
    url: { type: "string", description: "URL to open when no tab matches" },
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
      : resolveNamed(String(args.name ?? ""))

    if (!request) {
      console.error(
        `foxhop: no target named "${args.name}". Edit ${CONFIG_PATH}, or run \`foxhop list\` / \`foxhop init\`.`,
      )
      process.exit(1)
    }

    try {
      const ack = await sendToHost(request)
      if (ack?.ok && ack.action !== "not-found") foreground()
      else
        console.error(
          `foxhop: ${ack?.error ?? "no matching tab and no url to open"}`,
        )
    } catch {
      if ("url" in request && request.url) {
        openUrl(request.url)
      } else {
        console.error(
          "foxhop: cannot reach the host — is Firefox running with the foxhop extension?",
        )
        process.exit(1)
      }
    }
  },
})

const resolveNamed = (name: string) => {
  const target = findTarget(readConfig(), name)
  if (!target) return null
  return {
    op: "focus",
    match: target.match,
    url: target.url,
    strategy: target.strategy ?? "hostname",
    pick: target.pick ?? "recent",
  }
}

const list = defineCommand({
  meta: { name: "list", description: "List saved focus targets" },
  args: { json: { type: "boolean", description: "Output JSON" } },
  run: ({ args }) => {
    const { targets } = readConfig()
    if (args.json) {
      process.stdout.write(JSON.stringify(targets, null, 2) + "\n")
      return
    }
    if (!targets.length) {
      console.log(
        `No targets yet. Run \`foxhop init\` for an example, or edit ${CONFIG_PATH}.`,
      )
      return
    }
    for (const target of targets) {
      console.log(`${target.name.padEnd(16)} ${target.match}`)
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
        "foxhop: no tabs (is Firefox running with the foxhop extension?)",
      )
      process.exit(1)
    }
    for (const tab of openTabs) {
      console.log(`${tab.title}\n  ${tab.url}`)
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
    console.log(`foxhop: wrote example config and schema next to ${path}`)
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
    json: { type: "boolean", description: "Output the result as JSON" },
  },
  run: ({ args }) => {
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
      `foxhop: wrote ${result.written} script(s)` +
        (result.removed ? `, removed ${result.removed} stale` : "") +
        ` in ${result.dir}`,
    )
    console.log(
      "Add that folder in Raycast → Extensions → Script Commands → Add Directories, then assign hotkeys.",
    )
  },
})

const add = defineCommand({
  meta: { name: "add", description: "Add or update a target in tabs.json" },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Target id (used by `foxhop focus <name>`)",
    },
    match: {
      type: "string",
      required: true,
      description: "Substring matched against tab URLs",
    },
    url: { type: "string", description: "URL opened when no tab matches" },
    title: { type: "string", description: "Human-friendly label" },
    strategy: {
      type: "string",
      description: "hostname | prefix | exact | search",
    },
    pick: {
      type: "string",
      description: "recent | first | pinned (which tab when several match)",
    },
  },
  run: ({ args }) => {
    upsertTarget({
      name: String(args.name),
      match: String(args.match),
      url: args.url,
      title: args.title,
      strategy: args.strategy as Strategy | undefined,
      pick: args.pick as Pick | undefined,
    })
    console.log(`foxhop: saved "${args.name}"`)
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
    const { removed } = removeTarget(String(args.name))
    if (!removed) {
      console.error(`foxhop: no target named "${args.name}"`)
      process.exit(1)
    }
    console.log(`foxhop: removed "${args.name}"`)
  },
})

runMain(
  defineCommand({
    meta: {
      name: "foxhop",
      description: "Focus specific Firefox tabs from anywhere on macOS",
    },
    subCommands: {
      focus,
      list,
      tabs,
      add,
      remove,
      init,
      sync: syncCommand,
      install: installCommand,
    },
  }),
)
