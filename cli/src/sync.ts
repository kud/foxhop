import {
  mkdirSync,
  writeFileSync,
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"
import { readConfig, CONFIG_DIR, type Target } from "./config.js"
import { ICON_PNG_BASE64 } from "./icon.js"

const MARKER = "@foxhop.generated"
const ICON_FILE = "foxhop.png"

export const defaultScriptsDir = () => join(CONFIG_DIR, "scripts")

const stableNode = (node: string) => {
  const index = node.indexOf("/installs/node/")
  if (index === -1) return node
  const shim = node.slice(0, index) + "/shims/node"
  return existsSync(shim) ? shim : node
}

const scriptBody = (node: string, cli: string, target: Target) => {
  const title = target.title ?? target.name
  return `#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Focus ${title}
# @raycast.mode silent
# @raycast.packageName Fox Hop
# @raycast.icon ${ICON_FILE}

# Documentation:
# @raycast.description Focus the ${title} tab in Firefox (opens it if not already open).
# @raycast.author kud
# ${MARKER}

exec "${stableNode(node)}" "${cli}" focus ${target.name}
`
}

const isGenerated = (path: string) => {
  try {
    return readFileSync(path, "utf8").includes(MARKER)
  } catch {
    return false
  }
}

export const sync = (node: string, cli: string, dir = defaultScriptsDir()) => {
  const { targets } = readConfig()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, ICON_FILE), Buffer.from(ICON_PNG_BASE64, "base64"))

  const wanted = new Set(targets.map((target) => `focus-${target.name}.sh`))
  const removed = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((file) => file.startsWith("focus-") && file.endsWith(".sh"))
    .filter((file) => !wanted.has(file) && isGenerated(join(dir, file)))
  for (const file of removed) rmSync(join(dir, file))

  for (const target of targets) {
    const file = join(dir, `focus-${target.name}.sh`)
    writeFileSync(file, scriptBody(node, cli, target))
    chmodSync(file, 0o755)
  }

  return { dir, written: targets.length, removed: removed.length }
}

// Remove every generated script (and the icon) without writing new ones.
export const clearScripts = (dir = defaultScriptsDir()) => {
  if (!existsSync(dir)) return { dir, written: 0, removed: 0 }
  const removed = readdirSync(dir)
    .filter((file) => file.startsWith("focus-") && file.endsWith(".sh"))
    .filter((file) => isGenerated(join(dir, file)))
  for (const file of removed) rmSync(join(dir, file))
  const icon = join(dir, ICON_FILE)
  if (existsSync(icon)) rmSync(icon)
  return { dir, written: 0, removed: removed.length }
}
