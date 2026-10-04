import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")
let host: typeof import("../src/host.js")

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "foxhop-edit-"))
  cfg = await import("../src/config.js")
  host = await import("../src/host.js")
})

beforeEach(() => {
  if (existsSync(cfg.CONFIG_PATH)) rmSync(cfg.CONFIG_PATH)
})

const names = () => cfg.readConfig().targets.map((target) => target.name)

describe("editTarget", () => {
  beforeEach(() => {
    cfg.upsertTarget({
      name: "notion-calendar",
      title: "Notion Calendar",
      match: "calendar.notion.so",
      url: "https://calendar.notion.so/",
      navigate: true,
      favorite: true,
    })
    cfg.upsertTarget({
      name: "todoist",
      title: "Todoist",
      match: "todoist.com",
    })
  })

  it("changes the given fields and never the id", () => {
    const { found } = cfg.editTarget("notion-calendar", {
      title: "Work Calendar",
      match: "cal.example.com",
    })
    expect(found).toBe(true)
    const edited = cfg.findTarget(cfg.readConfig(), "notion-calendar")
    expect(edited).toMatchObject({
      name: "notion-calendar",
      title: "Work Calendar",
      match: "cal.example.com",
      url: "https://calendar.notion.so/",
      navigate: true,
      favorite: true,
    })
    expect(names()).toEqual(["notion-calendar", "todoist"])
  })

  it("clears a field whose patch value is undefined", () => {
    cfg.editTarget("notion-calendar", { url: undefined, navigate: undefined })
    const edited = cfg.findTarget(cfg.readConfig(), "notion-calendar")
    expect(edited).not.toHaveProperty("url")
    expect(edited).not.toHaveProperty("navigate")
    expect(edited?.favorite).toBe(true)
  })

  it("reports an unknown id without writing", () => {
    const before = readFileSync(cfg.CONFIG_PATH, "utf8")
    expect(cfg.editTarget("nope", { title: "X" }).found).toBe(false)
    expect(readFileSync(cfg.CONFIG_PATH, "utf8")).toBe(before)
  })

  it("refuses an empty match", () => {
    expect(() => cfg.editTarget("todoist", { match: " " })).toThrow()
  })
})

describe("nameForAdd", () => {
  const targets = [
    {
      name: "notion-calendar",
      title: "Notion Calendar",
      match: "calendar.notion.so",
    },
    { name: "example", title: "Example", match: "other.example.com" },
  ]

  it("reuses the id of a target with the same match, whatever the title", () => {
    expect(
      cfg.nameForAdd(targets, {
        title: "Calendar",
        match: "Calendar.Notion.so",
      }),
    ).toBe("notion-calendar")
  })

  it("suffixes a taken id whose match differs", () => {
    expect(
      cfg.nameForAdd(targets, { title: "Example", match: "example.com" }),
    ).toBe("example-2")
  })

  it("folds accents and falls back to the match for emoji-only titles", () => {
    expect(cfg.nameForAdd([], { title: "Café Crème", match: "cafe.fr" })).toBe(
      "cafe-creme",
    )
    expect(cfg.nameForAdd([], { title: "🦊", match: "fox.example" })).toBe(
      "fox-example",
    )
  })

  it("honours an explicit id even when the site is saved", () => {
    expect(
      cfg.nameForAdd(targets, {
        name: "Second Calendar",
        title: "Calendar",
        match: "calendar.notion.so",
      }),
    ).toBe("second-calendar")
  })
})

describe("config file safety", () => {
  it("a first write with no file keeps the given id", () => {
    cfg.upsertTarget({
      name: "custom",
      title: "Something Else",
      match: "a.com",
    })
    expect(names()).toEqual(["custom"])
  })

  it("a malformed tabs.json throws and is left untouched", () => {
    mkdirSync(cfg.CONFIG_DIR, { recursive: true })
    writeFileSync(cfg.CONFIG_PATH, "{ not json")
    expect(() => cfg.readConfig()).toThrow(/not valid JSON/)
    expect(() => cfg.upsertTarget({ name: "x", match: "x.com" })).toThrow()
    expect(readFileSync(cfg.CONFIG_PATH, "utf8")).toBe("{ not json")
  })

  it("replacing a target keeps its position", () => {
    cfg.upsertTarget({ name: "a", match: "a.com" })
    cfg.upsertTarget({ name: "b", match: "b.com" })
    cfg.upsertTarget({ name: "a", title: "A", match: "a.com" })
    expect(names()).toEqual(["a", "b"])
  })
})

describe("host edits", () => {
  it("config:upsert never creates a target", () => {
    const reply = host.handleConfigMutation({
      cfgId: 1,
      op: "config:upsert",
      target: { name: "invented", match: "x.com" },
    })
    expect(reply.ok).toBe(false)
    expect(names()).toEqual([])
  })

  it("config:add on a saved site keeps its title and id", () => {
    cfg.upsertTarget({
      name: "gmail",
      title: "Gmail",
      match: "mail.google.com",
    })
    const reply = host.handleConfigMutation({
      cfgId: 2,
      op: "config:add",
      url: "https://mail.google.com/mail/u/0/#inbox",
      title: "Inbox (3) - Gmail",
    })
    expect(reply.ok).toBe(true)
    expect(cfg.readConfig().targets).toEqual([
      {
        name: "gmail",
        title: "Gmail",
        match: "mail.google.com",
        url: "https://mail.google.com/mail/u/0/#inbox",
      },
    ])
  })
})
