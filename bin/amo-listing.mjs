#!/usr/bin/env node
import { createHmac, randomUUID } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

export const AMO_API = "https://addons.mozilla.org/api/v5"

/** @param {string} guid */
export const addonUrl = (guid) => `${AMO_API}/addons/addon/${guid}/`

/** @param {string} guid */
export const previewsUrl = (guid) => `${AMO_API}/addons/addon/${guid}/previews/`

/** @param {string} guid @param {number|string} id */
export const previewUrl = (guid, id) =>
  `${AMO_API}/addons/addon/${guid}/previews/${id}/`

/** Listing fields managed in listing.json. */
export const LISTING_FIELDS = [
  "name",
  "summary",
  "description",
  "homepage",
  "support_url",
  "support_email",
  "categories",
  "tags",
]

export const SCOPES = ["listing", "icon", "previews"]

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"])

/**
 * @param {string | Uint8Array | Buffer} input
 * @returns {string} base64url without padding
 */
export function base64urlEncode(input) {
  const buf =
    typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input)
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/**
 * Authenticated reads skip AMO's public cache, which can serve a listing
 * from before the last apply (and so plan the same screenshot upload twice).
 *
 * @param {Record<string, string | undefined>} env
 */
export function liveReadHeaders(env) {
  const issuer = env["WEB_EXT_API_KEY"]
  const secret = env["WEB_EXT_API_SECRET"]
  if (!issuer || !secret) return {}
  return { Authorization: `JWT ${createJwt({ issuer, secret })}` }
}

/**
 * Build an AMO JWT (HS256, `{iss, jti, iat, exp}`). `nowMs`/`jti` are
 * injectable so tests stay deterministic.
 *
 * @param {{ issuer: string, secret: string, nowMs?: number, jti?: string }} args
 */
export function createJwt({
  issuer,
  secret,
  nowMs = Date.now(),
  jti = randomUUID(),
}) {
  if (!issuer) throw new Error("missing AMO JWT issuer")
  if (!secret) throw new Error("missing AMO JWT secret")
  const iat = Math.floor(nowMs / 1000)
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = base64urlEncode(
    JSON.stringify({ iss: issuer, jti, iat, exp: iat + 60 }),
  )
  const signature = base64urlEncode(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest(),
  )
  return `${header}.${payload}.${signature}`
}

/**
 * AMO rewrites description links through an outgoing proxy; recover the
 * original URL from the path so the diff has no false positives.
 *
 * @param {string} value
 */
export function normalizeOutgoingUrls(value) {
  return value.replace(
    /https:\/\/prod\.outgoing\.prod\.webservices\.mozgcp\.net\/v1\/[0-9a-f]+\/([^"'\s<>]+)/g,
    (_match, embedded) => {
      try {
        const decoded = decodeURIComponent(embedded)
        return /^https?:\/\//.test(decoded) ? decoded : embedded
      } catch {
        return embedded
      }
    },
  )
}

/**
 * AMO returns HTML entities in text fields; listing.json keeps the plain form.
 *
 * @param {string} value
 */
export function decodeHtmlEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
  return value.replace(
    /&(amp|lt|gt|quot|apos|nbsp);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (match, name, decimal, hex) => {
      if (name) return named[name]
      const code = decimal
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hex, 16)
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    },
  )
}

/** @param {unknown} value */
export function normalizeText(value) {
  return decodeHtmlEntities(normalizeOutgoingUrls(String(value ?? "")))
}

/** @param {unknown} a @param {unknown} b */
export function sameText(a, b) {
  return normalizeText(a).trim() === normalizeText(b).trim()
}

/**
 * Localized GET values look like `{ "en-US": "..." }` (or null); accept a
 * bare string too and return the en-US text (or null when empty).
 * `support_url` arrives nested as `{ url: { "en-US": ... }, outgoing: ... }`.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function localizedEnUs(value) {
  if (value == null) return null
  if (typeof value === "string") return value
  if (typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value)
    if ("en-US" in record) {
      const text = record["en-US"]
      return text == null ? null : String(text)
    }
    if ("url" in record) return localizedEnUs(record["url"])
    return null
  }
  return String(value)
}

/**
 * Categories arrive as a slug list (sometimes `{ firefox: [...] }`) but PATCH
 * takes the plain slug list.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function categorySlugs(value) {
  const list = Array.isArray(value)
    ? value
    : value != null &&
        typeof value === "object" &&
        Array.isArray(/** @type {Record<string, unknown>} */ (value)["firefox"])
      ? /** @type {unknown[]} */ (
          /** @type {Record<string, unknown>} */ (value)["firefox"]
        )
      : []
  return list.map(String).slice().sort()
}

/** @param {string[]} a @param {string[]} b */
export function sameSlugs(a, b) {
  const sorted = [...a].sort()
  const other = [...b].sort()
  return (
    sorted.length === other.length &&
    sorted.every((slug, i) => slug === other[i])
  )
}

/**
 * Diff listing.json against a live GET response. Returns one entry per
 * changed field with the PATCH-ready value.
 *
 * @param {Record<string, unknown>} local listing.json content
 * @param {Record<string, unknown>} live GET /addons/addon/<guid>/ response
 * @returns {{ field: string, live: unknown, patch: unknown }[]}
 */
export function diffListing(local, live) {
  const changed = []
  for (const field of LISTING_FIELDS) {
    if (field === "categories" || field === "tags") {
      const localSlugs = Array.isArray(local[field])
        ? local[field].map(String)
        : []
      if (!sameSlugs(localSlugs, categorySlugs(live[field]))) {
        changed.push({ field, live: live[field] ?? null, patch: localSlugs })
      }
      continue
    }
    const localText = localizedEnUs(local[field])
    const liveText = localizedEnUs(live[field])
    if (localText == null && liveText == null) continue
    if (
      localText == null ||
      liveText == null ||
      !sameText(liveText, localText)
    ) {
      changed.push({ field, live: liveText, patch: local[field] ?? null })
    }
  }
  return changed
}

/**
 * @param {{ field: string, live: unknown, patch: unknown }[]} changed
 * @returns {Record<string, unknown>} PATCH JSON body with only changed fields
 */
export function buildListingPatch(changed) {
  return Object.fromEntries(changed.map(({ field, patch }) => [field, patch]))
}

/** @param {unknown} caption localized dict, string, or null */
export function extractCaption(caption) {
  return localizedEnUs(caption)
}

/**
 * @param {{ file: string, caption: string | null }[]} localShots name-sorted local screenshots
 * @param {{ id: number, caption: unknown }[]} livePreviews live previews in position order
 * @returns {{ inSync: boolean, deletes: number[], uploads: { file: string, caption: string | null }[] }}
 */
export function planPreviewSync(localShots, livePreviews) {
  if (localShots.length === 0) return { inSync: true, deletes: [], uploads: [] }
  const captionsMatch =
    localShots.length === livePreviews.length &&
    localShots.every(
      (shot, i) =>
        (shot.caption ?? "") ===
        (extractCaption(livePreviews[i].caption) ?? ""),
    )
  if (captionsMatch) return { inSync: true, deletes: [], uploads: [] }
  return {
    inSync: false,
    deletes: livePreviews.map((preview) => preview.id),
    uploads: localShots.map(({ file, caption }) => ({ file, caption })),
  }
}

/**
 * @typedef {{ method: string, url: string, kind: "json" | "icon" | "preview" | "delete", body?: unknown, file?: string, caption?: string | null }} PlannedRequest
 *
 * @param {{ guid: string, only: string[], patch: Record<string, unknown>, iconPath: string | null, previewPlan: { deletes: number[], uploads: { file: string, caption: string | null }[] } }} args
 * @returns {PlannedRequest[]} requests in send order; never contains credentials
 */
export function planRequests({ guid, only, patch, iconPath, previewPlan }) {
  const requests = []
  if (only.includes("listing") && Object.keys(patch).length > 0) {
    requests.push({
      method: "PATCH",
      url: addonUrl(guid),
      kind: "json",
      body: patch,
    })
  }
  if (only.includes("icon") && iconPath) {
    requests.push({
      method: "PATCH",
      url: addonUrl(guid),
      kind: "icon",
      file: iconPath,
    })
  }
  if (only.includes("previews")) {
    for (const id of previewPlan.deletes) {
      requests.push({
        method: "DELETE",
        url: previewUrl(guid, id),
        kind: "delete",
      })
    }
    for (const upload of previewPlan.uploads) {
      requests.push({
        method: "POST",
        url: previewsUrl(guid),
        kind: "preview",
        file: upload.file,
        caption: upload.caption,
      })
    }
  }
  return requests
}

/** @param {Record<string, string>} headers */
export function redactHeaders(headers) {
  const redacted = { ...headers }
  if (redacted["Authorization"]) redacted["Authorization"] = "JWT <redacted>"
  return redacted
}

/**
 * Replace credential values in text meant for display so secrets never leak
 * into logs or error output.
 *
 * @param {string} text
 * @param {(string | undefined)[]} secrets
 */
export function redactSecrets(text, secrets) {
  let out = text
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("<redacted>")
  }
  return out
}

/**
 * Turn an AMO error response into a one-line message, keeping AMO's own
 * wording (`detail` or per-field errors).
 *
 * @param {number} status
 * @param {string} bodyText
 */
export function formatApiError(status, bodyText) {
  const hint =
    status === 401
      ? " — check WEB_EXT_API_KEY / WEB_EXT_API_SECRET"
      : status === 403
        ? " — the key lacks permission for this add-on"
        : status === 400
          ? " — the listing payload was rejected"
          : ""
  let detail = bodyText.trim().slice(0, 500)
  try {
    const parsed = JSON.parse(bodyText)
    if (typeof parsed?.detail === "string") {
      detail = parsed.detail
    } else if (parsed && typeof parsed === "object") {
      detail = Object.entries(parsed)
        .map(
          ([key, errors]) =>
            `${key}: ${Array.isArray(errors) ? errors.join(", ") : errors}`,
        )
        .join("; ")
        .slice(0, 500)
    }
  } catch {
    // keep the raw text
  }
  return `AMO rejected the request (HTTP ${status})${hint}: ${detail || "(empty response)"}`
}

const VALUE_FLAGS = {
  "--listing": "listing",
  "--guid": "guid",
  "--icon": "icon",
  "--screenshots": "screenshots",
}

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ mode: "dry" | "apply", only: string[], listing: string | null, guid: string | null, icon: string | null, screenshots: string | null }}
 */
export function parseArgs(argv) {
  let mode = "dry"
  let only = [...SCOPES]
  const values = { listing: null, guid: null, icon: null, screenshots: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--apply") {
      mode = "apply"
    } else if (arg === "--dry-run") {
      mode = "dry"
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage())
      process.exit(0)
    } else if (arg === "--only" || arg.startsWith("--only=")) {
      const raw =
        arg === "--only" ? (argv[++i] ?? "") : arg.slice("--only=".length)
      const scopes = raw
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
      const unknown = scopes.filter((scope) => !SCOPES.includes(scope))
      if (scopes.length === 0 || unknown.length > 0) {
        throw new Error(
          `--only must be a comma-separated list of ${SCOPES.join("|")}`,
        )
      }
      only = [...new Set(scopes)]
    } else if (
      arg in VALUE_FLAGS ||
      Object.keys(VALUE_FLAGS).some((flag) => arg.startsWith(`${flag}=`))
    ) {
      const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg
      const key = /** @type {"listing" | "guid" | "icon" | "screenshots"} */ (
        VALUE_FLAGS[flag]
      )
      if (!key) throw new Error(`unknown argument: ${arg}`)
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : (argv[++i] ?? "")
      if (!value) throw new Error(`${flag} needs a value`)
      values[key] = value
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { mode, only, ...values }
}

/**
 * Merge CLI flags with env fallbacks. Listing and guid are required.
 *
 * @param {{ listing: string | null, guid: string | null, icon: string | null, screenshots: string | null }} flags
 * @param {Record<string, string | undefined>} env
 * @returns {{ listingPath: string, guid: string, iconPath: string | null, screenshotsDir: string | null }}
 */
export function resolveInputs(flags, env) {
  const listingPath = flags.listing ?? env["AMO_LISTING"] ?? null
  const guid = flags.guid ?? env["AMO_GUID"] ?? null
  if (!listingPath || !guid) {
    throw new Error(
      "missing add-on listing and/or guid (--listing/AMO_LISTING, --guid/AMO_GUID)",
    )
  }
  return {
    listingPath,
    guid,
    iconPath: flags.icon ?? env["AMO_ICON"] ?? null,
    screenshotsDir: flags.screenshots ?? env["AMO_SCREENSHOTS"] ?? null,
  }
}

/** Print usage for --help and argument errors. */
export function usage() {
  return [
    "usage: node bin/amo-listing.mjs --listing <path> --guid <id> [--icon <png>] [--screenshots <dir>] [--dry-run] [--apply] [--only=listing|icon|previews]",
    "",
    "  --listing      listing.json path (or AMO_LISTING)",
    "  --guid         add-on GUID, e.g. my-addon@example.com (or AMO_GUID)",
    "  --icon         128x128 add-on icon PNG (or AMO_ICON)",
    "  --screenshots  previews directory (or AMO_SCREENSHOTS)",
    "  --dry-run      compare with the live AMO listing (default, no credentials needed)",
    "  --apply        send the changes to AMO (needs WEB_EXT_API_KEY / WEB_EXT_API_SECRET)",
    "  --only         restrict to listing, icon and/or previews (comma-separated)",
  ].join("\n")
}

const fail = (message) => {
  console.error(
    redactSecrets(`amo-listing: ${message}`, [
      process.env["WEB_EXT_API_SECRET"],
    ]),
  )
  process.exit(1)
}

/** @param {Response} response @param {string} label */
async function readError(response, label) {
  const body = await response.text().catch(() => "")
  fail(`${label} — ${formatApiError(response.status, body)}`)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`)
  }
}

/**
 * @param {string | null} dir
 * @returns {{ file: string, caption: string | null, path: string }[] | null} null when no dir configured
 */
function readScreenshots(dir) {
  if (!dir) return null
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    fail(`cannot read screenshots dir ${dir}: ${error.message}`)
  }
  return entries
    .filter((entry) => {
      if (!entry.isFile()) return false
      const dot = entry.name.lastIndexOf(".")
      return (
        dot > 0 && IMAGE_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())
      )
    })
    .map((entry) => entry.name)
    .sort()
    .map((file) => {
      const dot = file.lastIndexOf(".")
      const captionPath = join(dir, `${file.slice(0, dot)}.txt`)
      let caption = null
      try {
        caption = readFileSync(captionPath, "utf8").trim() || null
      } catch {
        caption = null
      }
      return { file, caption, path: join(dir, file) }
    })
}

async function main() {
  let flags
  try {
    flags = parseArgs(process.argv.slice(2))
  } catch (error) {
    fail(`${error.message}\n${usage()}`)
  }
  let inputs
  try {
    inputs = resolveInputs(flags, process.env)
  } catch (error) {
    fail(`${error.message}\n${usage()}`)
  }
  const { mode, only } = flags
  const { listingPath, guid, iconPath: configuredIcon, screenshotsDir } = inputs

  const listing = readJson(listingPath)

  let live
  try {
    const response = await fetch(addonUrl(guid), {
      headers: liveReadHeaders(process.env),
    })
    if (!response.ok)
      await readError(response, "could not fetch the live listing")
    live = await response.json()
  } catch (error) {
    fail(`could not fetch the live listing: ${error.message}`)
  }

  const changed = diffListing(listing, live)
  const patch = buildListingPatch(changed)
  const shots = readScreenshots(screenshotsDir) ?? []
  const livePreviews = [...(live.previews ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((preview) => ({
      id: preview.id,
      caption: extractCaption(preview.caption),
    }))
  const previewPlan = planPreviewSync(
    shots.map(({ file, caption }) => ({ file, caption })),
    livePreviews,
  )

  let iconPath = null
  if (only.includes("icon")) {
    if (!configuredIcon) fail("icon scope needs --icon (or AMO_ICON)")
    try {
      if (!statSync(configuredIcon).isFile())
        fail(`icon not found: ${configuredIcon}`)
    } catch {
      fail(`icon not found: ${configuredIcon}`)
    }
    iconPath = configuredIcon
  }

  const requests = planRequests({ guid, only, patch, iconPath, previewPlan })

  const listingScope = only.includes("listing")
  console.log(
    `AMO listing for ${guid} (${mode === "apply" ? "--apply" : "--dry-run"})`,
  )
  if (listingScope) {
    if (changed.length === 0) {
      console.log("listing: no differences")
    } else {
      for (const { field, live: liveValue, patch: patchValue } of changed) {
        console.log(`listing: ${field} differs`)
        console.log(`  live:  ${JSON.stringify(liveValue)}`)
        console.log(`  local: ${JSON.stringify(patchValue)}`)
      }
    }
  }
  if (only.includes("previews")) {
    if (!screenshotsDir) {
      console.log(
        "previews: no screenshots dir configured (--screenshots or AMO_SCREENSHOTS), skipping",
      )
    } else if (shots.length === 0) {
      console.log(`previews: no screenshots in ${screenshotsDir}, skipping`)
    } else if (previewPlan.inSync) {
      console.log(`previews: in sync (${livePreviews.length})`)
    }
  }
  if (requests.length === 0) {
    console.log("nothing to send")
    return
  }
  console.log("planned requests:")
  for (const request of requests) {
    console.log(`  ${request.method} ${request.url}`)
    console.log(
      `    Authorization: ${redactHeaders({ Authorization: "JWT <token>" })["Authorization"]}`,
    )
    if (request.kind === "json")
      console.log(`    body: ${JSON.stringify(request.body)}`)
    if (request.kind === "icon")
      console.log(`    multipart: icon=${request.file}`)
    if (request.kind === "preview") {
      console.log(
        `    multipart: image=${request.file}` +
          (request.caption
            ? ` caption=${JSON.stringify({ "en-US": request.caption })}`
            : ""),
      )
    }
  }
  if (mode === "dry") return

  const key = process.env["WEB_EXT_API_KEY"]
  const secret = process.env["WEB_EXT_API_SECRET"]
  if (!key || !secret) {
    fail("--apply needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET")
  }
  const headers = { Authorization: `JWT ${createJwt({ issuer: key, secret })}` }
  const shotByFile = new Map(shots.map((shot) => [shot.file, shot]))

  for (const request of requests) {
    let response
    try {
      if (request.kind === "json") {
        response = await fetch(request.url, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        })
      } else if (request.kind === "icon") {
        const form = new FormData()
        form.append(
          "icon",
          new Blob([readFileSync(/** @type {string} */ (request.file))], {
            type: "image/png",
          }),
          basename(/** @type {string} */ (request.file)),
        )
        response = await fetch(request.url, {
          method: "PATCH",
          headers,
          body: form,
        })
      } else if (request.kind === "preview") {
        const shot = shotByFile.get(request.file)
        const form = new FormData()
        form.append(
          "image",
          new Blob([readFileSync(/** @type {string} */ (shot?.path))]),
          request.file,
        )
        if (request.caption) {
          form.append("caption", JSON.stringify({ "en-US": request.caption }))
        }
        response = await fetch(request.url, {
          method: "POST",
          headers,
          body: form,
        })
      } else {
        response = await fetch(request.url, { method: "DELETE", headers })
      }
    } catch (error) {
      fail(
        `request failed (${request.method} ${request.url}): ${error.message}`,
      )
    }
    if (!response.ok)
      await readError(response, `${request.method} ${request.url} failed`)
    console.log(
      `sent: ${request.method} ${request.url} → HTTP ${response.status}`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error))
  })
}
