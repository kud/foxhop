import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let cfg: typeof import("../src/config.js")
let host: typeof import("../src/host.js")

beforeAll(async () => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "foxhop-add-"))
  cfg = await import("../src/config.js")
  host = await import("../src/host.js")
})

beforeEach(() => {
  if (existsSync(cfg.CONFIG_PATH)) rmSync(cfg.CONFIG_PATH)
})

type AddReply = {
  ok: boolean
  targets: { name: string; title?: string; url?: string }[]
  name: string
  created: boolean
  urlChanged: boolean
}

const add = (url: string, title: string): AddReply =>
  host.handleConfigMutation({ cfgId: 1, op: "config:add", url, title }) as AddReply

describe("config:add feedback", () => {
  it("reports a first add as created", () => {
    const reply = add("https://example.com/a", "Example")
    expect(reply.ok).toBe(true)
    expect(reply.name).toBe("example")
    expect(reply.created).toBe(true)
    expect(reply.urlChanged).toBe(false)
    expect(reply.targets).toHaveLength(1)
  })

  it("re-adding the same url is not new and the url is unchanged", () => {
    const first = add("https://example.com/a", "Example")
    const again = add("https://example.com/a", "Example")
    expect(again.ok).toBe(true)
    expect(again.name).toBe(first.name)
    expect(again.created).toBe(false)
    expect(again.urlChanged).toBe(false)
    expect(again.targets).toHaveLength(1)
  })

  it("re-adding the same site with a different url reports a link update", () => {
    const first = add("https://example.com/a", "Example")
    const again = add("https://example.com/b", "Example")
    expect(again.ok).toBe(true)
    expect(again.name).toBe(first.name)
    expect(again.created).toBe(false)
    expect(again.urlChanged).toBe(true)
    expect(again.targets).toHaveLength(1)
    expect(cfg.findTarget(cfg.readConfig(), first.name)?.url).toBe(
      "https://example.com/b",
    )
  })

  it("still returns the targets list", () => {
    const reply = add("https://example.com/a", "Example")
    expect(reply.targets).toEqual(cfg.readConfig().targets)
  })
})
