import { describe, it, expect, vi } from "vitest"
import { resolveContainer } from "../../webext/src/container.js"
import {
  containerFlag,
  containerIgnored,
  CONTAINER_TOO_OLD,
} from "../src/container.js"

const containers = [
  { name: "Personal", cookieStoreId: "firefox-container-1" },
  { name: "Shopping", cookieStoreId: "firefox-container-2" },
  { name: "Banking", cookieStoreId: "firefox-container-3" },
]

const fake = (list: typeof containers) => ({
  query: vi.fn(async () => list),
  create: vi.fn(),
})

describe("resolveContainer", () => {
  it("returns the id and real name for an exact match", async () => {
    const api = fake(containers)
    expect(await resolveContainer(api, "Shopping")).toEqual({
      cookieStoreId: "firefox-container-2",
      name: "Shopping",
    })
  })

  it("ignores case and surrounding spaces and returns the container's own name", async () => {
    const api = fake(containers)
    expect(await resolveContainer(api, "  bANKing ")).toEqual({
      cookieStoreId: "firefox-container-3",
      name: "Banking",
    })
  })

  it("lists the available names for an unknown container", async () => {
    const api = fake(containers)
    const result = await resolveContainer(api, "Travel")
    expect(result).toHaveProperty("error")
    expect(result.error).toContain('"Travel"')
    expect(result.error).toContain("Personal, Shopping, Banking")
  })

  it("never creates a container, even for an unknown name", async () => {
    const api = fake(containers)
    await resolveContainer(api, "Travel")
    expect(api.create).not.toHaveBeenCalled()
  })

  it("says so when no containers exist", async () => {
    const result = await resolveContainer(fake([]), "Personal")
    expect(result.error).toContain("no containers exist")
    expect(result.error).not.toContain("available:")
  })

  it("reports containers as turned off when the query rejects", async () => {
    const api = {
      query: vi.fn(async () => {
        throw new Error("contextual identities are disabled")
      }),
      create: vi.fn(),
    }
    const result = await resolveContainer(api, "Personal")
    expect(result.error).toContain("turned off")
    expect(api.create).not.toHaveBeenCalled()
  })

  it("reports containers as turned off when the API is missing", async () => {
    for (const missing of [undefined, null, {}]) {
      const result = await resolveContainer(missing, "Personal")
      expect(result.error).toContain("turned off")
    }
  })

  it("rejects an empty or blank name without querying", async () => {
    const api = fake(containers)
    for (const name of ["", "   ", undefined]) {
      const result = await resolveContainer(api, name)
      expect(result.error).toContain("cannot be empty")
    }
    expect(api.query).not.toHaveBeenCalled()
  })
})

describe("containerIgnored", () => {
  const asked = { container: "Personal" }

  it("is true when a container was asked and the ack does not echo one", () => {
    expect(containerIgnored(asked, { ok: true, action: "focused" })).toBe(true)
  })

  it("is false when the ack echoes the container", () => {
    expect(
      containerIgnored(asked, {
        ok: true,
        action: "opened",
        container: "Personal",
      }),
    ).toBe(false)
  })

  it("is false when no container was asked", () => {
    expect(containerIgnored({}, { ok: true, action: "opened" })).toBe(false)
    expect(containerIgnored({ container: "" }, { ok: true })).toBe(false)
  })

  it("is false when the ack is not ok or missing", () => {
    expect(containerIgnored(asked, { ok: false })).toBe(false)
    expect(containerIgnored(asked, null)).toBe(false)
  })

  it("is false when nothing was found, since nothing was opened", () => {
    expect(containerIgnored(asked, { ok: true, action: "not-found" })).toBe(
      false,
    )
  })

  it("has a message pointing at updating the extension", () => {
    expect(CONTAINER_TOO_OLD).toContain("update")
  })
})

describe("containerFlag", () => {
  it("trims the value", () => {
    expect(containerFlag("  Banking ")).toBe("Banking")
  })

  it("turns empty and blank values into undefined", () => {
    expect(containerFlag("")).toBeUndefined()
    expect(containerFlag("   ")).toBeUndefined()
  })

  it("turns non-strings into undefined", () => {
    for (const value of [undefined, null, true, 3, ["Personal"]]) {
      expect(containerFlag(value)).toBeUndefined()
    }
  })
})
