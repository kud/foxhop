import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import {
  base64urlEncode,
  buildListingPatch,
  createJwt,
  diffListing,
  formatApiError,
  liveReadHeaders,
  parseArgs,
  planPreviewSync,
  planRequests,
  redactHeaders,
  redactSecrets,
  resolveInputs,
} from "../../bin/amo-listing.mjs"
import listing from "../../webext/amo/listing.json"

const decodePart = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8"))

const liveAddon = () => ({
  name: { "en-US": "Fox Hop" },
  summary: { "en-US": "Focus a specific Firefox tab on command" },
  description: {
    "en-US":
      'Focus <a href="https://prod.outgoing.prod.webservices.mozgcp.net/v1/0123456789abcdef/https%3A//github.com/kud/foxhop">github.com/kud/foxhop</a> &amp; more',
  },
  homepage: { "en-US": null },
  support_url: { "en-US": "https://github.com/kud/foxhop" },
  categories: { firefox: ["tabs"] },
  tags: [],
  previews: [],
})

const localListing = () => ({
  name: { "en-US": "Fox Hop" },
  summary: { "en-US": "Focus a specific Firefox tab on command" },
  description: {
    "en-US":
      'Focus <a href="https://github.com/kud/foxhop">github.com/kud/foxhop</a> & more',
  },
  homepage: null,
  support_url: { "en-US": "https://github.com/kud/foxhop" },
  categories: ["tabs"],
  tags: [],
})

describe("createJwt", () => {
  const args = {
    issuer: "user:1:2",
    secret: "s3cret",
    nowMs: 1_700_000_000_123,
    jti: "fixed-jti",
  }

  it("emits a verifiable HS256 token with exp = iat + 60", () => {
    const token = createJwt(args)
    const [header, payload, signature] = token.split(".")
    expect(decodePart(header)).toEqual({ alg: "HS256", typ: "JWT" })
    const body = decodePart(payload)
    expect(body).toMatchObject({ iss: "user:1:2", jti: "fixed-jti" })
    expect(body.iat).toBe(1_700_000_000)
    expect(body.exp - body.iat).toBe(60)
    const expected = base64urlEncode(
      createHmac("sha256", "s3cret").update(`${header}.${payload}`).digest(),
    )
    expect(signature).toBe(expected)
  })

  it("uses a unique jti per token by default", () => {
    const a = decodePart(createJwt({ issuer: "i", secret: "s" }).split(".")[1])
    const b = decodePart(createJwt({ issuer: "i", secret: "s" }).split(".")[1])
    expect(a.jti).not.toBe(b.jti)
  })

  it("rejects a signature made with another secret", () => {
    const token = createJwt(args)
    const [header, payload, signature] = token.split(".")
    const wrong = base64urlEncode(
      createHmac("sha256", "other").update(`${header}.${payload}`).digest(),
    )
    expect(signature).not.toBe(wrong)
  })
})

describe("diffListing", () => {
  it("reports no diff when live matches the local listing (proxy links and entities normalised)", () => {
    expect(diffListing(localListing(), liveAddon())).toEqual([])
  })

  it("reports no diff for the shipped listing.json against its live-shaped fixture", () => {
    const live = {
      ...liveAddon(),
      summary: listing.summary,
      description: {
        "en-US": (listing.description as { "en-US": string })["en-US"]
          .replaceAll(
            "https://github.com/kud/foxhop",
            "https://prod.outgoing.prod.webservices.mozgcp.net/v1/0123456789abcdef/https%3A//github.com/kud/foxhop",
          )
          .replaceAll("&", "&amp;"),
      },
      homepage: { url: listing.homepage, outgoing: listing.homepage },
      support_email: listing.support_email,
    }
    expect(diffListing(listing, live)).toEqual([])
  })

  it("detects changed text fields and builds a patch with only those", () => {
    const changed = diffListing(
      { ...localListing(), name: { "en-US": "Fox Hop 2" } },
      liveAddon(),
    )
    expect(changed).toHaveLength(1)
    expect(changed[0].field).toBe("name")
    expect(buildListingPatch(changed)).toEqual({
      name: { "en-US": "Fox Hop 2" },
    })
  })

  it("detects category and tag changes, ignores order", () => {
    const live = { ...liveAddon(), tags: ["b", "a"] }
    expect(diffListing({ ...localListing(), tags: ["a", "b"] }, live)).toEqual(
      [],
    )
    const changed = diffListing({ ...localListing(), tags: ["a"] }, live)
    expect(changed.map((entry) => entry.field)).toEqual(["tags"])
  })

  it("treats null and { en-US: null } homepages as equal", () => {
    expect(
      diffListing({ ...localListing(), homepage: null }, liveAddon()),
    ).toEqual([])
  })

  it("follows the nested support_url { url, outgoing } shape", () => {
    const live = {
      ...liveAddon(),
      homepage: null,
      support_url: {
        url: { "en-US": "https://github.com/kud/foxhop" },
        outgoing: {
          "en-US": "https://prod.outgoing.../https%3A//github.com/kud/foxhop",
        },
      },
    }
    expect(diffListing(localListing(), live)).toEqual([])
  })
})

describe("planPreviewSync", () => {
  it("skips sync when there are no local screenshots", () => {
    expect(
      planPreviewSync([], [{ id: 7, caption: { "en-US": "old" } }]),
    ).toEqual({
      inSync: true,
      deletes: [],
      uploads: [],
    })
  })

  it("stays in sync when captions match in order", () => {
    const plan = planPreviewSync(
      [{ file: "a.png", caption: "A" }],
      [{ id: 1, caption: { "en-US": "A" } }],
    )
    expect(plan.inSync).toBe(true)
  })

  it("replaces all previews when counts or captions differ", () => {
    const plan = planPreviewSync(
      [
        { file: "a.png", caption: "A" },
        { file: "b.png", caption: null },
      ],
      [{ id: 1, caption: { "en-US": "A" } }],
    )
    expect(plan.inSync).toBe(false)
    expect(plan.deletes).toEqual([1])
    expect(plan.uploads).toEqual([
      { file: "a.png", caption: "A" },
      { file: "b.png", caption: null },
    ])
  })
})

describe("planRequests", () => {
  const base = {
    guid: "foxhop@kud.io",
    only: ["listing", "icon", "previews"],
    iconPath: null as string | null,
    previewPlan: {
      deletes: [] as number[],
      uploads: [] as { file: string; caption: string | null }[],
    },
  }

  it("emits nothing when there is nothing to send", () => {
    expect(planRequests({ ...base, patch: {} })).toEqual([])
  })

  it("sends only changed listing fields, then icon, then preview deletes before uploads", () => {
    const requests = planRequests({
      ...base,
      patch: { summary: { "en-US": "new" } },
      iconPath: "assets/icons/foxhop-128.png",
      previewPlan: {
        deletes: [3],
        uploads: [{ file: "a.png", caption: "A" }],
      },
    })
    expect(
      requests.map((request) => [request.method, request.url, request.kind]),
    ).toEqual([
      [
        "PATCH",
        "https://addons.mozilla.org/api/v5/addons/addon/foxhop@kud.io/",
        "json",
      ],
      [
        "PATCH",
        "https://addons.mozilla.org/api/v5/addons/addon/foxhop@kud.io/",
        "icon",
      ],
      [
        "DELETE",
        "https://addons.mozilla.org/api/v5/addons/addon/foxhop@kud.io/previews/3/",
        "delete",
      ],
      [
        "POST",
        "https://addons.mozilla.org/api/v5/addons/addon/foxhop@kud.io/previews/",
        "preview",
      ],
    ])
    expect(requests[0].body).toEqual({ summary: { "en-US": "new" } })
    for (const request of requests) {
      expect(JSON.stringify(request)).not.toContain("s3cret")
    }
  })

  it("honours --only scopes", () => {
    const requests = planRequests({
      ...base,
      only: ["icon"],
      patch: { summary: { "en-US": "new" } },
      iconPath: "assets/icons/foxhop-128.png",
    })
    expect(requests.map((request) => request.kind)).toEqual(["icon"])
  })
})

describe("secrets", () => {
  it("redacts the Authorization header and secret occurrences", () => {
    expect(redactHeaders({ Authorization: "JWT abc.def.ghi" })).toEqual({
      Authorization: "JWT <redacted>",
    })
    expect(
      redactSecrets("got 401 with s3cret here", ["s3cret", undefined]),
    ).toBe("got 401 with <redacted> here")
  })
})

describe("parseArgs", () => {
  it("defaults to a full dry run with no inputs", () => {
    expect(parseArgs([])).toEqual({
      mode: "dry",
      only: ["listing", "icon", "previews"],
      listing: null,
      guid: null,
      icon: null,
      screenshots: null,
    })
  })

  it("parses --apply, --only and value flags in both forms", () => {
    expect(
      parseArgs([
        "--apply",
        "--only=listing,icon",
        "--listing",
        "webext/amo/listing.json",
        "--guid=foxhop@kud.io",
      ]),
    ).toEqual({
      mode: "apply",
      only: ["listing", "icon"],
      listing: "webext/amo/listing.json",
      guid: "foxhop@kud.io",
      icon: null,
      screenshots: null,
    })
    expect(
      parseArgs(["--only", "previews", "--icon", "icon.png"]),
    ).toMatchObject({
      mode: "dry",
      only: ["previews"],
      icon: "icon.png",
    })
  })

  it("rejects unknown flags, scopes and empty values", () => {
    expect(() => parseArgs(["--send"])).toThrow()
    expect(() => parseArgs(["--only=banner"])).toThrow()
    expect(() => parseArgs(["--guid"])).toThrow()
  })
})

describe("resolveInputs", () => {
  const flags = { listing: null, guid: null, icon: null, screenshots: null }

  it("prefers flags over AMO_* env fallbacks", () => {
    expect(
      resolveInputs(
        { ...flags, listing: "l.json" },
        { AMO_LISTING: "e.json", AMO_GUID: "g" },
      ),
    ).toEqual({
      listingPath: "l.json",
      guid: "g",
      iconPath: null,
      screenshotsDir: null,
    })
  })

  it("fails clearly when listing or guid is missing", () => {
    expect(() => resolveInputs(flags, {})).toThrow(/--listing.*--guid/)
    expect(() => resolveInputs({ ...flags, listing: "l.json" }, {})).toThrow(
      /--listing.*--guid/,
    )
  })
})

describe("formatApiError", () => {
  it("keeps AMO's message and labels auth problems", () => {
    expect(
      formatApiError(401, JSON.stringify({ detail: "Unauthorized" })),
    ).toContain("HTTP 401")
    expect(
      formatApiError(401, JSON.stringify({ detail: "Unauthorized" })),
    ).toContain("Unauthorized")
    expect(formatApiError(403, "forbidden")).toContain("permission")
    expect(
      formatApiError(400, JSON.stringify({ description: ["Too long"] })),
    ).toContain("description: Too long")
  })
})

describe("liveReadHeaders", () => {
  it("authenticates the live read when credentials exist, so the public cache is bypassed", () => {
    const headers = liveReadHeaders({ WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "s3cret" })
    expect(headers.Authorization).toMatch(/^JWT [\w-]+\.[\w-]+\.[\w-]+$/)
  })

  it("stays anonymous without credentials", () => {
    expect(liveReadHeaders({})).toEqual({})
  })
})
