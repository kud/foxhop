import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { CONFIG_DIR, CONFIG_PATH, SCHEMA_PATH } from "./paths.js"

// Re-exported so existing import sites keep working; paths.ts owns them.
export { CONFIG_DIR, CONFIG_PATH, SCHEMA_PATH }

export type Strategy = "hostname" | "prefix" | "exact" | "search"
export type Pick = "recent" | "first" | "pinned"

export interface Target {
  name: string
  title?: string
  match: string
  url?: string
  strategy?: Strategy
  pick?: Pick
  navigate?: boolean
  favorite?: boolean
}

export interface Config {
  targets: Target[]
  version?: number
}

// Config format version. Set once the ids were migrated to title slugs;
// after that targets are never renamed again.
export const CONFIG_VERSION = 2

// After a migration the generated Raycast scripts name stale ids, so callers
// that own the node/cli paths (cli.ts, host.ts) pass onMigrated to regenerate
// them. config.ts takes a callback instead of importing sync.ts, which would
// reintroduce the config/sync import cycle.
export const readConfig = (onMigrated?: () => void): Config => {
  if (!existsSync(CONFIG_PATH)) return { targets: [] }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
    const stored = Array.isArray(parsed?.targets) ? parsed.targets : []
    // Migrated configs are returned untouched — ids stay fixed after creation.
    if (parsed?.version === CONFIG_VERSION)
      return { targets: stored, version: CONFIG_VERSION }
    const { targets, changed } = migrateTargetNames(stored)
    writeConfig({ targets, version: CONFIG_VERSION })
    if (changed) onMigrated?.()
    return { targets, version: CONFIG_VERSION }
  } catch {
    return { targets: [] }
  }
}

export const findTarget = (config: Config, name: string): Target | undefined =>
  config.targets.find((target) => target.name === name)

const SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "foxhop targets",
  type: "object",
  properties: {
    version: {
      type: "integer",
      description:
        "Config format version — set once target ids were migrated to title slugs",
    },
    targets: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "match"],
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            description: "Identifier used by `foxhop focus <name>`",
          },
          title: { type: "string", description: "Human-friendly label" },
          match: {
            type: "string",
            description: "Substring matched against tab URLs/titles",
          },
          url: { type: "string", description: "Opened when no tab matches" },
          strategy: {
            enum: ["hostname", "prefix", "exact", "search"],
            default: "hostname",
          },
          pick: {
            enum: ["recent", "first", "pinned"],
            default: "recent",
            description: "Which tab to focus when several match",
          },
          navigate: {
            type: "boolean",
            default: false,
            description:
              "Let `foxhop focus <name> --url <url>` repoint the matching tab to that URL instead of only focusing it. The URL must fall within this target's match.",
          },
          favorite: {
            type: "boolean",
            description: "Pin this target to the top of the list",
          },
        },
      },
    },
  },
}

const EXAMPLE: Config = {
  targets: [
    {
      name: "chatgpt",
      title: "ChatGPT",
      match: "chatgpt.com",
      url: "https://chatgpt.com",
    },
    {
      name: "todoist",
      title: "Todoist",
      match: "todoist.com",
      url: "https://app.todoist.com",
    },
  ],
}

const writeSchema = () => {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(SCHEMA_PATH, JSON.stringify(SCHEMA, null, 2) + "\n")
}

export const writeConfig = (config: Config): void => {
  writeSchema()
  // The marker is always preserved: stamped configs are written untouched so
  // ids stay fixed, while unstamped ones are migrated exactly once here.
  const targets =
    config.version === CONFIG_VERSION
      ? config.targets
      : migrateTargetNames(config.targets).targets
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      { $schema: "./tabs.schema.json", version: CONFIG_VERSION, targets },
      null,
      2,
    ) + "\n",
  )
}

export const writeExampleConfig = (): string => {
  writeSchema()
  if (!existsSync(CONFIG_PATH)) writeConfig(EXAMPLE)
  return CONFIG_PATH
}

export const upsertTarget = (
  target: Target,
  onMigrated?: () => void,
): Config => {
  const { targets, version } = readConfig(onMigrated)
  const next = {
    targets: [
      ...targets.filter((existing) => existing.name !== target.name),
      target,
    ],
    version,
  }
  writeConfig(next)
  return next
}

export const removeTarget = (
  name: string,
  onMigrated?: () => void,
): { targets: Target[]; removed: boolean } => {
  const { targets, version } = readConfig(onMigrated)
  const filtered = targets.filter((target) => target.name !== name)
  const removed = filtered.length !== targets.length
  if (removed) writeConfig({ targets: filtered, version })
  return { targets: filtered, removed }
}

export const toggleFavorite = (
  name: string,
  onMigrated?: () => void,
): { favorite: boolean; found: boolean } => {
  const { targets, version } = readConfig(onMigrated)
  let favorite = false
  let found = false
  const next = targets.map((target) => {
    if (target.name !== name) return target
    found = true
    favorite = !target.favorite
    const { favorite: _was, ...rest } = target
    return favorite ? { ...rest, favorite: true } : rest
  })
  if (found) writeConfig({ targets: next, version })
  return { favorite, found }
}

// The id of a target: the kebab-case slug of its title, set once at creation
// and never edited afterwards. Accents fold to ASCII (NFD splits them into
// base letter + combining mark, which is then stripped); anything else that is
// not a letter or digit becomes a single hyphen.
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

// Derive a match / title / id from a URL (or bare hostname) so the user only
// has to supply a URL. The match is the full lowercase hostname; the title is
// the friendly word (the first non-generic label); the id is the slug of that
// title, falling back to the slug of the hostname. All overridable.
export const deriveTarget = (
  url: string,
): { name: string; match: string; title: string } => {
  let host = url.trim()
  try {
    host = new URL(url).hostname
  } catch {
    host = url.replace(/^[a-z]+:\/\//i, "").split("/")[0] || url
  }
  host = host.toLowerCase()
  const title = friendlyWord(host)
  return { name: slugify(title) || slugify(host) || "target", match: host, title }
}

const genericLabels = new Set(["www", "app", "web", "m", "my", "go"])

const friendlyWord = (host: string): string => {
  const labels = host.split(".").filter(Boolean)
  const candidates = labels.length > 1 ? labels.slice(0, -1) : labels
  const word =
    candidates.find((label) => !genericLabels.has(label)) ??
    candidates[0] ??
    host
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// One-time migration from hostname-style ids to title slugs, gated by the
// config's version marker (see readConfig/writeConfig): it only ever runs on
// unstamped files. Each target is renamed to the slug of its current title
// (falling back to the slug of its match, then its current name); every other
// field — favourite included — moves along untouched. A slug claimed twice
// gets a -2, -3, … suffix so distinct targets keep distinct ids.
export const migrateTargetNames = (
  targets: Target[],
): { targets: Target[]; changed: boolean } => {
  const taken = new Set<string>()
  let changed = false
  const next = targets.map((target) => {
    const base =
      slugify(target.title ?? "") || slugify(target.match) || target.name
    let name = base
    let suffix = 2
    while (taken.has(name)) name = `${base}-${suffix++}`
    taken.add(name)
    if (name !== target.name) changed = true
    return name === target.name ? target : { ...target, name }
  })
  return { targets: next, changed }
}

// Resolves the CLI entry embedded in generated scripts (`exec <node> <cli>
// focus <name>`). The CLI knows its own path; the host bundle sits next to
// the CLI bundle, so it points at its sibling — embedding the host itself
// would produce scripts that start a host instead of focusing a tab.
export const cliEntryForScripts = (selfPath: string): string => {
  if (basename(selfPath) === "cli.js") return selfPath
  const sibling = join(dirname(selfPath), "cli.js")
  return existsSync(sibling) ? sibling : selfPath
}

// Adding must never overwrite a different target. Re-adding the same site
// (same match) reuses its id so the target updates in place; a colliding id
// whose match differs gets a -2, -3, … suffix instead.
export const allocateTargetName = (
  targets: Target[],
  baseName: string,
  match: string,
): string => {
  const existing = targets.find((target) => target.name === baseName)
  if (!existing || existing.match === match) return baseName
  let suffix = 2
  while (true) {
    const candidate = `${baseName}-${suffix}`
    const clash = targets.find((target) => target.name === candidate)
    if (!clash || clash.match === match) return candidate
    suffix += 1
  }
}
