import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")
let host: typeof import("../src/host.js")

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "foxhop-paste-read-"))
  cfg = await import("../src/config.js")
  host = await import("../src/host.js")
})

beforeEach(() => {
  if (existsSync(cfg.CONFIG_PATH)) rmSync(cfg.CONFIG_PATH)
})

describe("into / from selectors", () => {
  it("saves both on a target", () => {
    cfg.upsertTarget({ name: "review", title: "Review", match: "example.com" })
    cfg.editTarget("review", { into: "#comment", from: "article" })
    const edited = cfg.findTarget(cfg.readConfig(), "review")
    expect(edited).toMatchObject({ into: "#comment", from: "article" })
  })

  it("clears each when the patch value is undefined", () => {
    cfg.upsertTarget({
      name: "review",
      title: "Review",
      match: "example.com",
      into: "#comment",
      from: "article",
    })
    cfg.editTarget("review", { into: undefined, from: undefined })
    const edited = cfg.findTarget(cfg.readConfig(), "review")
    expect(edited).not.toHaveProperty("into")
    expect(edited).not.toHaveProperty("from")
  })

  it("an edit to another field leaves the selectors alone", () => {
    cfg.upsertTarget({
      name: "review",
      title: "Review",
      match: "example.com",
      from: "article",
    })
    cfg.editTarget("review", { title: "PR Review" })
    const edited = cfg.findTarget(cfg.readConfig(), "review")
    expect(edited?.from).toBe("article")
  })

  it("ride along to the schema written on every config save", () => {
    cfg.upsertTarget({ name: "review", match: "example.com", into: "#a", from: "b" })
    const schema = JSON.parse(readFileSync(cfg.SCHEMA_PATH, "utf8"))
    const properties = schema.properties.targets.items.properties
    expect(properties.into).toMatchObject({ type: "string" })
    expect(properties.from).toMatchObject({ type: "string" })
  })
})

describe("requestTimeout", () => {
  it("defaults to the base request timeout", () => {
    expect(host.requestTimeout({})).toBe(3000)
  })

  it("gives a request's own timeout 5s of transport slack", () => {
    expect(host.requestTimeout({ timeoutMs: 20000 })).toBe(25000)
  })

  it("never drops below the base timeout", () => {
    expect(host.requestTimeout({ timeoutMs: 1000 })).toBe(3000)
  })

  it("caps at 310s", () => {
    expect(host.requestTimeout({ timeoutMs: 999999 })).toBe(310000)
  })
})
