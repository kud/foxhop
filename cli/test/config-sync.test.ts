import { describe, it, expect, beforeAll } from "vitest"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ICON_PNG_BASE64 } from "../src/icon.js"

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

describe("sync icon", () => {
  const expectedIcon = () => {
    const hash = createHash("sha256")
      .update(Buffer.from(ICON_PNG_BASE64, "base64"))
      .digest("hex")
      .slice(0, 8)
    return `foxhop-${hash}.png`
  }

  it("names the icon by content hash and references it in scripts", () => {
    const dir = join(configHome, "icon-scripts")
    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    const icon = expectedIcon()
    expect(icon).toMatch(/^foxhop-[0-9a-f]{8}\.png$/)
    expect(existsSync(join(dir, icon))).toBe(true)
    expect(existsSync(join(dir, "foxhop.png"))).toBe(false)
    const scripts = readdirSync(dir).filter((file) =>
      file.startsWith("focus-"),
    )
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      expect(readFileSync(join(dir, script), "utf8")).toContain(
        `# @raycast.icon ${icon}`,
      )
    }
  })

  it("prunes stale icons but keeps unrelated files", () => {
    const dir = join(configHome, "icon-prune")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "foxhop.png"), "legacy")
    writeFileSync(join(dir, "foxhop-deadbeef.png"), "stale")
    writeFileSync(join(dir, "foxhop-backup.png"), "mine")
    writeFileSync(join(dir, "my-icon.png"), "mine")

    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    const icon = expectedIcon()
    expect(existsSync(join(dir, icon))).toBe(true)
    expect(existsSync(join(dir, "foxhop.png"))).toBe(false)
    expect(existsSync(join(dir, "foxhop-deadbeef.png"))).toBe(false)
    expect(existsSync(join(dir, "foxhop-backup.png"))).toBe(true)
    expect(existsSync(join(dir, "my-icon.png"))).toBe(true)
  })

  it("clearScripts removes the icons", () => {
    const dir = join(configHome, "icon-clear")
    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    writeFileSync(join(dir, "foxhop.png"), "legacy")
    const icon = expectedIcon()
    expect(existsSync(join(dir, icon))).toBe(true)

    syncMod.clearScripts(dir)
    expect(existsSync(join(dir, icon))).toBe(false)
    expect(existsSync(join(dir, "foxhop.png"))).toBe(false)
    expect(
      readdirSync(dir).filter((file) => file.startsWith("focus-")),
    ).toEqual([])
  })

  it("a second sync rewrites nothing when content is unchanged", () => {
    const dir = join(configHome, "icon-idempotent")
    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    const icon = expectedIcon()
    const backdate = new Date(Date.now() - 60_000)
    const tracked = readdirSync(dir).filter(
      (file) => file.startsWith("focus-") || file === icon,
    )
    expect(tracked.length).toBeGreaterThan(0)
    for (const file of tracked) utimesSync(join(dir, file), backdate, backdate)

    syncMod.sync("/usr/bin/node", "/opt/foxhop/cli.js", dir)
    for (const file of tracked) {
      expect(statSync(join(dir, file)).mtimeMs).toBe(backdate.getTime())
    }
  })
})
