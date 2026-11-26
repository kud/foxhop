import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "foxhop-container-"))
  cfg = await import("../src/config.js")
})

beforeEach(() => {
  if (existsSync(cfg.CONFIG_PATH)) rmSync(cfg.CONFIG_PATH)
  cfg.upsertTarget({
    name: "shop",
    title: "Shop",
    match: "shop.example.com",
    container: "Shopping",
  })
})

const shop = () => cfg.findTarget(cfg.readConfig(), "shop")

describe("target container", () => {
  it("survives a write and read of the config", () => {
    expect(shop()?.container).toBe("Shopping")
  })

  it("is set by editTarget without touching other fields", () => {
    cfg.editTarget("shop", { container: "Banking" })
    expect(shop()).toMatchObject({
      container: "Banking",
      title: "Shop",
      match: "shop.example.com",
    })
  })

  it("is cleared by editTarget with undefined", () => {
    cfg.editTarget("shop", { container: undefined })
    expect(shop()).not.toHaveProperty("container")
    expect(shop()?.title).toBe("Shop")
  })

  it("is kept when an edit leaves it out", () => {
    cfg.editTarget("shop", { title: "Online Shop" })
    expect(shop()?.container).toBe("Shopping")
  })

  it("is declared as a string in the written JSON schema", () => {
    const schema = JSON.parse(readFileSync(cfg.SCHEMA_PATH, "utf8"))
    const target = schema.properties.targets.items
    expect(target.additionalProperties).toBe(false)
    expect(target.properties.container.type).toBe("string")
  })
})
