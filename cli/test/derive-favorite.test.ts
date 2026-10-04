import { describe, it, expect, beforeAll } from "vitest"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "foxhop-fav-"))
  cfg = await import("../src/config.js")
})

describe("slugify", () => {
  it("slugs titles to kebab-case ids", () => {
    expect(cfg.slugify("Notion Calendar")).toBe("notion-calendar")
    expect(cfg.slugify("Todoist")).toBe("todoist")
    expect(cfg.slugify("Bluesky")).toBe("bluesky")
    expect(cfg.slugify("WhatsApp")).toBe("whatsapp")
    expect(cfg.slugify("ChatGPT")).toBe("chatgpt")
  })

  it("folds accents to ASCII", () => {
    expect(cfg.slugify("Café des Arts")).toBe("cafe-des-arts")
  })

  it("turns runs of non-alphanumerics into one hyphen and trims", () => {
    expect(cfg.slugify("Hello,  World!")).toBe("hello-world")
    expect(cfg.slugify("--Hi--")).toBe("hi")
  })
})

describe("deriveTarget", () => {
  it("derives the friendly word as title and its slug as id", () => {
    expect(cfg.deriveTarget("https://calendar.notion.so/xyz")).toEqual({
      name: "calendar",
      match: "calendar.notion.so",
      title: "Calendar",
    })
  })

  it("skips generic subdomains for the title but keeps the full match", () => {
    expect(cfg.deriveTarget("https://app.todoist.com")).toEqual({
      name: "todoist",
      match: "app.todoist.com",
      title: "Todoist",
    })
  })

  it("keeps a leading www. in the match only", () => {
    expect(cfg.deriveTarget("https://www.example.com/page")).toEqual({
      name: "example",
      match: "www.example.com",
      title: "Example",
    })
  })

  it("lowercases the hostname and accepts a bare hostname", () => {
    expect(cfg.deriveTarget("Gemini.Google.Com")).toEqual({
      name: "gemini",
      match: "gemini.google.com",
      title: "Gemini",
    })
  })

  it("falls back to the slug of the hostname when the title slugs to empty", () => {
    expect(cfg.deriveTarget("https://chatgpt.com")).toEqual({
      name: "chatgpt",
      match: "chatgpt.com",
      title: "Chatgpt",
    })
  })
})

describe("allocateTargetName", () => {
  it("returns a free id unchanged", () => {
    expect(cfg.allocateTargetName([], "chatgpt", "chatgpt.com")).toBe(
      "chatgpt",
    )
  })

  it("reuses the id when the match is the same", () => {
    const targets = [{ name: "chatgpt", match: "chatgpt.com" }]
    expect(cfg.allocateTargetName(targets, "chatgpt", "chatgpt.com")).toBe(
      "chatgpt",
    )
  })

  it("suffixes instead of overwriting a different target", () => {
    const targets = [{ name: "example", match: "other.example.com" }]
    expect(cfg.allocateTargetName(targets, "example", "example.com")).toBe(
      "example-2",
    )
  })

  it("increments the suffix past further collisions", () => {
    const targets = [
      { name: "example", match: "one.example.com" },
      { name: "example-2", match: "two.example.com" },
    ]
    expect(cfg.allocateTargetName(targets, "example", "example.com")).toBe(
      "example-3",
    )
  })

  it("reuses a suffixed id whose match is the same", () => {
    const targets = [
      { name: "example", match: "one.example.com" },
      { name: "example-2", match: "example.com" },
    ]
    expect(cfg.allocateTargetName(targets, "example", "example.com")).toBe(
      "example-2",
    )
  })
})

describe("toggleFavorite", () => {
  it("toggles a target's favourite on and off", () => {
    cfg.upsertTarget({
      name: "gem",
      title: "Gem",
      match: "gemini.google.com",
    })
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
