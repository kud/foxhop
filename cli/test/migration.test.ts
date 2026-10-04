import { describe, it, expect, beforeAll } from "vitest"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")
let syncMod: typeof import("../src/sync.js")
let configHome: string

const legacyTargets = [
  {
    name: "calendar.notion.so",
    title: "Calendar",
    match: "calendar.notion.so",
    url: "https://calendar.notion.so/xyz",
    favorite: true,
  },
  { name: "bsky", title: "Bluesky", match: "bsky.app" },
  { name: "todoist", title: "Todoist", match: "todoist.com" },
  { name: "x1", title: "Same", match: "one.example.com" },
  { name: "x2", title: "Same!", match: "two.example.com" },
]

const seedLegacy = () => {
  mkdirSync(cfg.CONFIG_DIR, { recursive: true })
  writeFileSync(
    cfg.CONFIG_PATH,
    JSON.stringify({ targets: legacyTargets }, null, 2) + "\n",
  )
}

beforeAll(async () => {
  configHome = mkdtempSync(join(tmpdir(), "foxhop-migrate-"))
  process.env.XDG_CONFIG_HOME = configHome
  cfg = await import("../src/config.js")
  syncMod = await import("../src/sync.js")
})

describe("migration", () => {
  it("renames legacy ids to title slugs, keeping fields and favourites", () => {
    seedLegacy()
    const { targets } = cfg.readConfig()
    const names = targets.map((target) => target.name).sort()
    expect(names).toEqual(
      ["bluesky", "calendar", "same", "same-2", "todoist"].sort(),
    )

    const calendar = cfg.findTarget({ targets }, "calendar")
    expect(calendar?.url).toBe("https://calendar.notion.so/xyz")
    expect(calendar?.favorite).toBe(true)
    expect(calendar?.title).toBe("Calendar")
    expect(cfg.findTarget({ targets }, "bluesky")?.match).toBe("bsky.app")
  })

  it("leaves already-migrated targets alone", () => {
    expect(
      cfg.migrateTargetNames(cfg.readConfig().targets).changed,
    ).toBe(false)
  })

  it("persists the migration to tabs.json with the marker set", () => {
    const stored = JSON.parse(readFileSync(cfg.CONFIG_PATH, "utf8"))
    expect(stored.version).toBe(2)
    expect(
      stored.targets.map((target: { name: string }) => target.name).sort(),
    ).toEqual(["bluesky", "calendar", "same", "same-2", "todoist"].sort())
  })

  it("old ids no longer resolve", () => {
    const config = cfg.readConfig()
    expect(cfg.findTarget(config, "calendar.notion.so")).toBeUndefined()
    expect(cfg.findTarget(config, "bsky")).toBeUndefined()
    expect(cfg.findTarget(config, "calendar")).toBeDefined()
  })

  it("replaces stale scripts with the migrated ones on resync", () => {
    seedLegacy()
    const dir = join(cfg.CONFIG_DIR, "scripts")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "focus-calendar.notion.so.sh"),
      "#!/bin/bash\n# @foxhop.generated\n",
    )

    // The migration reports through a callback; the caller regenerates the
    // scripts, mirroring what cli.ts and host.ts pass in production.
    cfg.readConfig(() => syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js"))

    const scripts = () =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".sh"))
        .sort()
    expect(scripts()).not.toContain("focus-calendar.notion.so.sh")
    expect(scripts()).toContain("focus-calendar.sh")
    expect(readFileSync(join(dir, "focus-calendar.sh"), "utf8")).toContain(
      "focus calendar",
    )
  })
})

describe("marker gate", () => {
  const seedStamped = (targets: unknown[]) => {
    mkdirSync(cfg.CONFIG_DIR, { recursive: true })
    writeFileSync(
      cfg.CONFIG_PATH,
      JSON.stringify({ version: 2, targets }, null, 2) + "\n",
    )
  }

  it("never renames a stamped file, even when the name is no slug of the title", () => {
    seedStamped([
      { name: "my-custom-id", title: "Totally Different", match: "example.com" },
    ])
    const { targets } = cfg.readConfig()
    expect(targets.map((target) => target.name)).toEqual(["my-custom-id"])
  })

  it("a later write leaves a custom id alone", () => {
    seedStamped([
      { name: "my-custom-id", title: "Totally Different", match: "example.com" },
    ])
    cfg.toggleFavorite("my-custom-id")
    const { targets } = cfg.readConfig()
    expect(targets.map((target) => target.name)).toEqual(["my-custom-id"])
    expect(targets[0].favorite).toBe(true)
  })

  it("editing a title via upsert after migration keeps the id", () => {
    seedLegacy()
    cfg.readConfig()
    cfg.upsertTarget({
      name: "calendar",
      title: "Work Calendar",
      match: "calendar.notion.so",
    })
    const { targets } = cfg.readConfig()
    const edited = cfg.findTarget({ targets }, "calendar")
    expect(edited?.title).toBe("Work Calendar")
    expect(targets.map((target) => target.name)).not.toContain(
      "work-calendar",
    )
  })

  it("migration runs once: a second read changes nothing", () => {
    seedLegacy()
    const first = cfg.readConfig()
    const before = readFileSync(cfg.CONFIG_PATH, "utf8")
    const { mtimeMs } = statSync(cfg.CONFIG_PATH)
    expect(cfg.readConfig()).toEqual(first)
    expect(readFileSync(cfg.CONFIG_PATH, "utf8")).toBe(before)
    expect(statSync(cfg.CONFIG_PATH).mtimeMs).toBe(mtimeMs)
  })

  it("a file without the marker migrates and gains it", () => {
    seedLegacy()
    expect(JSON.parse(readFileSync(cfg.CONFIG_PATH, "utf8")).version).toBeUndefined()
    cfg.readConfig()
    const stored = JSON.parse(readFileSync(cfg.CONFIG_PATH, "utf8"))
    expect(stored.version).toBe(2)
    expect(
      stored.targets.map((target: { name: string }) => target.name),
    ).toContain("calendar")
  })
})
