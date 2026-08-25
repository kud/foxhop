import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let installMod: typeof import("../src/install.js")
let constants: typeof import("../src/constants.js")
let cfg: typeof import("../src/config.js")
let home: string
let distDir: string

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "foxhop-install-"))
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = join(home, ".config")

  distDir = join(home, "node_modules", "@kud", "foxhop-cli", "dist")
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, "host-cli.js"), "")

  installMod = await import("../src/install.js")
  constants = await import("../src/constants.js")
  cfg = await import("../src/config.js")
})

describe("install", () => {
  it("keeps the launcher out of the package directory an npm upgrade replaces", () => {
    installMod.install(distDir)

    expect(existsSync(join(distDir, "host-launch.sh"))).toBe(false)
    expect(existsSync(join(cfg.CONFIG_DIR, "host-launch.sh"))).toBe(true)
  })

  it("points the manifest at that launcher", () => {
    installMod.install(distDir)

    const manifest = JSON.parse(readFileSync(constants.MANIFEST_PATH, "utf8"))
    expect(manifest.path).toBe(join(cfg.CONFIG_DIR, "host-launch.sh"))
    expect(manifest.allowed_extensions).toEqual([constants.EXTENSION_ID])
  })

  it("still launches when the interpreter captured at install time is gone", () => {
    const shim = join(home, ".local", "share", "mise", "shims", "node")
    mkdirSync(join(home, ".local", "share", "mise", "shims"), {
      recursive: true,
    })
    writeFileSync(shim, '#!/bin/sh\necho "shim ran: $*"\n')
    chmodSync(shim, 0o755)

    const launcher = join(home, "stranded-launcher.sh")
    writeFileSync(
      launcher,
      installMod.wrapperScript(
        join(home, "removed", "node", "24.12.0", "bin", "node"),
        join(distDir, "host-cli.js"),
      ),
    )
    chmodSync(launcher, 0o755)

    const output = execFileSync(launcher, {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home },
    })
    expect(output).toContain("shim ran:")
    expect(output).toContain(join(distDir, "host-cli.js"))
  })
})
