import { describe, it, expect, beforeAll } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")
let syncMod: typeof import("../src/sync.js")
let host: typeof import("../src/host.js")
let configHome: string

beforeAll(async () => {
  configHome = mkdtempSync(join(tmpdir(), "foxhop-host-"))
  process.env.XDG_CONFIG_HOME = configHome
  cfg = await import("../src/config.js")
  syncMod = await import("../src/sync.js")
  host = await import("../src/host.js")
})

const scriptsDir = () => join(configHome, "foxhop", "scripts")

describe("host mutations", () => {
  it("config:add leaves no scripts behind before opt-in", () => {
    expect(existsSync(scriptsDir())).toBe(false)
    const reply = host.handleConfigMutation({
      cfgId: 1,
      op: "config:add",
      url: "https://calendar.notion.so/xyz",
      title: "Planning",
    })
    expect(reply.ok).toBe(true)
    expect(cfg.findTarget(cfg.readConfig(), "planning")?.title).toBe(
      "Planning",
    )
    expect(existsSync(scriptsDir())).toBe(false)
  })

  it("config:add derives the id from the title and regenerates scripts", () => {
    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js")
    const reply = host.handleConfigMutation({
      cfgId: 2,
      op: "config:add",
      url: "https://app.todoist.com/app",
      title: "My Tasks",
    })
    expect(reply.ok).toBe(true)
    const script = join(scriptsDir(), "focus-my-tasks.sh")
    expect(existsSync(script)).toBe(true)
    expect(readFileSync(script, "utf8")).toContain("focus my-tasks")
  })

  it("config:add refreshes the same site but suffixes a different one", () => {
    cfg.upsertTarget({
      name: "example",
      title: "Example",
      match: "other.example.com",
    })
    const reply = host.handleConfigMutation({
      cfgId: 3,
      op: "config:add",
      url: "https://example.com/page",
      title: "Example",
    })
    expect(reply.ok).toBe(true)
    expect(cfg.findTarget(cfg.readConfig(), "example")?.match).toBe(
      "other.example.com",
    )
    const added = cfg.findTarget(cfg.readConfig(), "example-2")
    expect(added?.match).toBe("example.com")
    expect(added?.url).toBe("https://example.com/page")
    expect(existsSync(join(scriptsDir(), "focus-example-2.sh"))).toBe(true)
  })

  it("config:upsert resyncs", () => {
    const script = join(scriptsDir(), "focus-my-tasks.sh")
    rmSync(script)
    const reply = host.handleConfigMutation({
      cfgId: 4,
      op: "config:upsert",
      target: {
        name: "my-tasks",
        title: "My Tasks",
        match: "app.todoist.com",
      },
    })
    expect(reply.ok).toBe(true)
    expect(existsSync(script)).toBe(true)
  })

  it("config:favorite resyncs", () => {
    const script = join(scriptsDir(), "focus-my-tasks.sh")
    rmSync(script)
    const reply = host.handleConfigMutation({
      cfgId: 5,
      op: "config:favorite",
      name: "my-tasks",
    })
    expect(reply.ok).toBe(true)
    expect(existsSync(script)).toBe(true)
  })

  it("config:remove prunes the stale script", () => {
    const script = join(scriptsDir(), "focus-my-tasks.sh")
    expect(existsSync(script)).toBe(true)
    const reply = host.handleConfigMutation({
      cfgId: 6,
      op: "config:remove",
      name: "my-tasks",
    })
    expect(reply.ok).toBe(true)
    expect(existsSync(script)).toBe(false)
  })
})
