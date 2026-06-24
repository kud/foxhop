import { describe, it, expect, beforeAll } from "vitest"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "foxhop-fav-"))
  cfg = await import("../src/config.js")
})

describe("deriveTarget", () => {
  it("derives name/match/title from a full URL", () => {
    expect(cfg.deriveTarget("https://chatgpt.com")).toEqual({
      name: "chatgpt",
      match: "chatgpt.com",
      title: "Chatgpt",
    })
  })

  it("skips generic subdomains when picking the name", () => {
    expect(cfg.deriveTarget("https://app.todoist.com").name).toBe("todoist")
  })

  it("uses the first meaningful label for multi-level hosts", () => {
    const derived = cfg.deriveTarget("https://gemini.google.com/app")
    expect(derived.name).toBe("gemini")
    expect(derived.match).toBe("gemini.google.com")
  })
})

describe("toggleFavorite", () => {
  it("toggles a target's favourite on and off", () => {
    cfg.upsertTarget({ name: "gem", match: "gemini.google.com" })
    expect(cfg.toggleFavorite("gem")).toEqual({ favorite: true, found: true })
    expect(cfg.findTarget(cfg.readConfig(), "gem")?.favorite).toBe(true)
    expect(cfg.toggleFavorite("gem")).toEqual({ favorite: false, found: true })
    expect(cfg.findTarget(cfg.readConfig(), "gem")?.favorite).toBeUndefined()
  })

  it("reports not found for unknown names", () => {
    expect(cfg.toggleFavorite("nope")).toEqual({
      favorite: false,
      found: false,
    })
  })
})
