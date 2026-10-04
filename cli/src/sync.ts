import { createHash } from "node:crypto"
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
import { readConfig, type Target } from "./config.js"
import { defaultScriptsDir } from "./paths.js"
import { ICON_PNG_BASE64 } from "./icon.js"

const MARKER = "@foxhop.generated"
const ICON_PATTERN = /^foxhop(-[0-9a-f]{8})?\.png$/

const iconBytes = () => Buffer.from(ICON_PNG_BASE64, "base64")

export const iconFileName = () =>
  `foxhop-${createHash("sha256").update(iconBytes()).digest("hex").slice(0, 8)}.png`

export { defaultScriptsDir }

// Keep the generated hotkey scripts mirrored to the targets after a mutation —
// but only once the user has opted in by generating them at least once (the
// scripts dir exists). No opt-in → nothing is created, so there's no clutter.
export const autoSync = (node: string, cli: string) => {
  if (existsSync(defaultScriptsDir())) {
    sync(node, cli)
  }
}

const stableNode = (node: string) => {
  const index = node.indexOf("/installs/node/")
  if (index === -1) return node
  const shim = node.slice(0, index) + "/shims/node"
  return existsSync(shim) ? shim : node
}

const scriptBody = (
  node: string,
  cli: string,
  target: Target,
  iconFile: string,
) => {
  const title = target.title ?? target.name
  return `#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Focus ${title}
# @raycast.mode silent
# @raycast.packageName Fox Hop
# @raycast.icon ${iconFile}

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
  const iconFile = iconFileName()
  const iconPath = join(dir, iconFile)
  if (!existsSync(iconPath) || !readFileSync(iconPath).equals(iconBytes())) {
    writeFileSync(iconPath, iconBytes())
  }

  const entries = existsSync(dir) ? readdirSync(dir) : []
  for (const file of entries) {
    if (ICON_PATTERN.test(file) && file !== iconFile) rmSync(join(dir, file))
  }

  const wanted = new Set(targets.map((target) => `focus-${target.name}.sh`))
  const removed = entries
    .filter((file) => file.startsWith("focus-") && file.endsWith(".sh"))
    .filter((file) => !wanted.has(file) && isGenerated(join(dir, file)))
  for (const file of removed) rmSync(join(dir, file))

  for (const target of targets) {
    const file = join(dir, `focus-${target.name}.sh`)
    const body = scriptBody(node, cli, target, iconFile)
    if (existsSync(file) && readFileSync(file, "utf8") === body) continue
    writeFileSync(file, body)
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
  for (const file of readdirSync(dir)) {
    if (ICON_PATTERN.test(file)) rmSync(join(dir, file))
  }
  return { dir, written: 0, removed: removed.length }
}
