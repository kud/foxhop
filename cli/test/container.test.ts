import { describe, it, expect, vi } from "vitest"
import {
  resolveContainer,
  EXTENSION_CAPABILITIES,
  pickContainerWindow,
} from "../../webext/src/container.js"
import {
  containerFlag,
  supportsContainers,
  focusContainer,
  CAPABILITIES_REQUEST,
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

describe("supportsContainers", () => {
  it("is true when the extension lists the container capability", () => {
    expect(supportsContainers({ ok: true, capabilities: ["container"] })).toBe(
      true,
    )
  })

  it("is false for an old extension, which answers the probe as a focus that found nothing", () => {
    expect(supportsContainers({ ok: true, action: "not-found" } as never)).toBe(
      false,
    )
  })

  it("is false when the capability is missing, the ack failed or is absent", () => {
    expect(supportsContainers({ ok: true, capabilities: [] })).toBe(false)
    expect(supportsContainers({ ok: false, capabilities: ["container"] })).toBe(
      false,
    )
    expect(supportsContainers(null)).toBe(false)
  })

  it("probes with an op an old extension treats as a no-op focus", () => {
    expect(CAPABILITIES_REQUEST).toEqual({ op: "capabilities" })
    expect(CAPABILITIES_REQUEST).not.toHaveProperty("url")
    expect(CAPABILITIES_REQUEST).not.toHaveProperty("match")
  })

  it("says nothing was opened and points at updating", () => {
    expect(CONTAINER_TOO_OLD).toContain("update")
    expect(CONTAINER_TOO_OLD).toContain("nothing was opened")
  })
})

describe("the extension answers the capabilities probe", () => {
  it("lists the container capability", () => {
    expect(EXTENSION_CAPABILITIES).toContain("container")
  })
})

describe("focusContainer", () => {
  it("uses the saved container when no flag is given", () => {
    expect(focusContainer(undefined, "Shopping")).toBe("Shopping")
  })

  it("lets the flag override the saved container", () => {
    expect(focusContainer(" Personal ", "Shopping")).toBe("Personal")
  })

  it("treats an empty flag as the default container for this call", () => {
    expect(focusContainer("", "Shopping")).toBeUndefined()
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

describe("pickContainerWindow", () => {
  it("uses the last-focused window when it is not private", () => {
    expect(pickContainerWindow({ id: 1, incognito: false }, [])).toEqual({
      windowId: 1,
    })
  })

  it("falls back to a normal window when the focused one is private", () => {
    expect(
      pickContainerWindow({ id: 1, incognito: true }, [
        { id: 1, incognito: true },
        { id: 2, incognito: false },
      ]),
    ).toEqual({ windowId: 2 })
  })

  it("errors when every window is private", () => {
    const result = pickContainerWindow({ id: 1, incognito: true }, [
      { id: 1, incognito: true },
    ])
    expect(result).toHaveProperty("error")
  })
})
