import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Strategy = "hostname" | "prefix" | "exact" | "search"
export type Pick = "recent" | "first" | "pinned"

export interface Target {
  name: string
  title?: string
  match: string
  url?: string
  strategy?: Strategy
  pick?: Pick
  favorite?: boolean
}

export interface Config {
  targets: Target[]
}

const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
export const CONFIG_DIR = join(xdgConfigHome, "foxhop")
export const CONFIG_PATH = join(CONFIG_DIR, "tabs.json")
export const SCHEMA_PATH = join(CONFIG_DIR, "tabs.schema.json")

export const readConfig = (): Config => {
  if (!existsSync(CONFIG_PATH)) return { targets: [] }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
    return { targets: Array.isArray(parsed?.targets) ? parsed.targets : [] }
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
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      { $schema: "./tabs.schema.json", targets: config.targets },
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

export const upsertTarget = (target: Target): Config => {
  const { targets } = readConfig()
  const next = {
    targets: [
      ...targets.filter((existing) => existing.name !== target.name),
      target,
    ],
  }
  writeConfig(next)
  return next
}

export const removeTarget = (
  name: string,
): { targets: Target[]; removed: boolean } => {
  const { targets } = readConfig()
  const filtered = targets.filter((target) => target.name !== name)
  const removed = filtered.length !== targets.length
  if (removed) writeConfig({ targets: filtered })
  return { targets: filtered, removed }
}

export const toggleFavorite = (
  name: string,
): { favorite: boolean; found: boolean } => {
  const { targets } = readConfig()
  let favorite = false
  let found = false
  const next = targets.map((target) => {
    if (target.name !== name) return target
    found = true
    favorite = !target.favorite
    const { favorite: _was, ...rest } = target
    return favorite ? { ...rest, favorite: true } : rest
  })
  if (found) writeConfig({ targets: next })
  return { favorite, found }
}

// Derive a name / match / title from a URL (or bare hostname) so the user only
// has to supply a URL. The hostname is the match; the first non-generic label
// becomes the name; the name title-cased is the title. All overridable.
export const deriveTarget = (
  url: string,
): { name: string; match: string; title: string } => {
  let host = url.trim()
  try {
    host = new URL(url).hostname
  } catch {
    host = url.replace(/^[a-z]+:\/\//i, "").split("/")[0] || url
  }
  const labels = host.split(".").filter(Boolean)
  const generic = new Set(["www", "app", "web", "m", "my", "go"])
  const candidates = labels.length > 1 ? labels.slice(0, -1) : labels
  const name = (
    candidates.find((label) => !generic.has(label)) ??
    candidates[0] ??
    host
  ).toLowerCase()
  const title = name.charAt(0).toUpperCase() + name.slice(1)
  return { name, match: host, title }
}
