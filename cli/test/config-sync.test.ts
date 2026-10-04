import { describe, it, expect, beforeAll } from "vitest"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")
let syncMod: typeof import("../src/sync.js")
let configHome: string

beforeAll(async () => {
  configHome = mkdtempSync(join(tmpdir(), "foxhop-test-"))
  process.env.XDG_CONFIG_HOME = configHome
  cfg = await import("../src/config.js")
  syncMod = await import("../src/sync.js")
})

describe("config", () => {
  it("starts empty when no file exists", () => {
    expect(cfg.readConfig().targets).toEqual([])
  })

  it("upserts and finds a target", () => {
    cfg.upsertTarget({
      name: "chatgpt",
      title: "ChatGPT",
      match: "chatgpt.com",
      url: "https://chatgpt.com",
    })
    expect(cfg.findTarget(cfg.readConfig(), "chatgpt")?.match).toBe(
      "chatgpt.com",
    )
  })

  it("upsert replaces an existing target by name", () => {
    cfg.upsertTarget({
      name: "chatgpt",
      title: "ChatGPT",
      match: "chat.openai.com",
    })
    const matches = cfg
      .readConfig()
      .targets.filter((target) => target.name === "chatgpt")
    expect(matches).toHaveLength(1)
    expect(matches[0].match).toBe("chat.openai.com")
  })

  it("removes a target", () => {
    expect(cfg.removeTarget("chatgpt").removed).toBe(true)
    expect(cfg.findTarget(cfg.readConfig(), "chatgpt")).toBeUndefined()
  })
})

describe("sync", () => {
  it("writes one script per target and prunes stale ones", () => {
    cfg.upsertTarget({
      name: "todoist",
      title: "Todoist",
      match: "todoist.com",
    })
    cfg.upsertTarget({ name: "gmail", title: "Gmail", match: "mail.google.com" })
    const dir = join(configHome, "scripts")

    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    const scripts = () =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".sh"))
        .sort()
    expect(scripts()).toEqual(["focus-gmail.sh", "focus-todoist.sh"])
    expect(readFileSync(join(dir, "focus-todoist.sh"), "utf8")).toContain(
      "focus todoist",
    )

    cfg.removeTarget("gmail")
    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    expect(scripts()).toEqual(["focus-todoist.sh"])
  })

  it("prunes stale scripts, including ones with dots in the name", () => {
    const dir = join(configHome, "dot-scripts")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "focus-calendar.notion.so.sh"),
      "#!/bin/bash\n# @foxhop.generated\n",
    )

    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    const scripts = () =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".sh"))
        .sort()
    expect(scripts()).not.toContain("focus-calendar.notion.so.sh")
    expect(scripts()).toContain("focus-todoist.sh")
  })
})
