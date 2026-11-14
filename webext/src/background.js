import { matchesTarget } from "./match.js"
import { pasteInPage, readInPage } from "./page.js"

const HOST_NAME = "io.kud.foxhop"

const matchesTab = (tab, match, strategy) =>
  matchesTarget({ match, strategy }, tab)

const mostRecent = (tabs) =>
  tabs.reduce((best, tab) =>
    (tab.lastAccessed ?? 0) > (best.lastAccessed ?? 0) ? tab : best,
  )

const chooseTab = (matches, pick) => {
  if (pick === "first") {
    return [...matches].sort(
      (a, b) => a.windowId - b.windowId || a.index - b.index,
    )[0]
  }
  if (pick === "pinned") {
    const pinned = matches.filter((tab) => tab.pinned)
    return mostRecent(pinned.length ? pinned : matches)
  }
  return mostRecent(matches)
}

// Tab choosing shared by focus, paste and read: filter by the target's match,
// then pick. Null when nothing matches.
const findTab = async ({ match, strategy = "hostname", pick = "recent" }) => {
  const tabs = await browser.tabs.query({})
  const matches = tabs.filter((tab) => matchesTab(tab, match, strategy))
  return matches.length ? { tab: chooseTab(matches, pick), matches } : null
}

const focusWindow = async (windowId) => {
  const win = await browser.windows.get(windowId)
  await browser.windows.update(windowId, {
    focused: true,
    ...(win.state === "minimized" ? { state: "normal" } : {}),
  })
}

const normaliseUrl = (url) => {
  try {
    const parsed = new URL(url)
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

// The scope guard: a target may only navigate to a URL its own match would
// select, so a ChatGPT target can never repoint an unrelated tab.
const isInScope = (url, match, strategy) => matchesTab({ url }, match, strategy)

// `navigateTo` is deliberately not the saved `navigate` flag: the popup sends
// the whole saved target into focusTab(), so keying navigation off the config
// field would make a popup click navigate an opted-in target's tab.
const focusTab = async ({
  match,
  strategy = "hostname",
  pick = "recent",
  url,
  navigateTo,
}) => {
  const destination = navigateTo ? normaliseUrl(navigateTo) : null
  if (
    navigateTo &&
    (!destination || !isInScope(destination, match, strategy))
  ) {
    return {
      ok: false,
      error: `url out of scope for this target: ${navigateTo}`,
    }
  }

  const found = await findTab({ match, strategy, pick })

  if (found) {
    const { tab, matches } = found
    const navigated =
      Boolean(destination) && normaliseUrl(tab.url) !== destination
    await browser.tabs.update(tab.id, {
      active: true,
      ...(navigated ? { url: destination } : {}),
    })
    await focusWindow(tab.windowId)
    return {
      action: navigated ? "navigated" : "focused",
      ...(destination ? { navigated } : {}),
      tabId: tab.id,
      windowId: tab.windowId,
      matchCount: matches.length,
    }
  }

  const openUrl = destination ?? url
  if (openUrl) {
    const created = await browser.tabs.create({ url: openUrl })
    await focusWindow(created.windowId)
    return {
      action: "opened",
      ...(destination ? { navigated: false } : {}),
      tabId: created.id,
      windowId: created.windowId,
    }
  }

  return { action: "not-found" }
}

// A just-opened tab has no DOM to inject into yet — wait (bounded) for its
// load to finish so executeScript finds a document.
const waitForComplete = (tabId, boundMs = 15000) =>
  new Promise((resolve) => {
    const finish = () => {
      browser.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve()
    }
    const listener = (updatedId, change) => {
      if (updatedId === tabId && change.status === "complete") finish()
    }
    const timer = setTimeout(finish, boundMs)
    browser.tabs.onUpdated.addListener(listener)
  })

// <all_urls> is an optional permission granted from the options page, so
// paste and read check for it before touching a tab. The CLI recognises this
// exact error and explains how to grant it.
const NO_PAGE_ACCESS = "no page access"
const PAGE_ACCESS = { origins: ["<all_urls>"] }
const hasPageAccess = () =>
  browser.permissions.contains(PAGE_ACCESS).catch(() => false)

// Runs inside the target's tab (which focusTab has just brought forward) and
// returns whatever pasteInPage decided.
const paste = async ({ text, into, ...target }) => {
  if (!(await hasPageAccess())) return { ok: false, error: NO_PAGE_ACCESS }
  const focused = await focusTab(target)
  if (focused.action === "not-found")
    return { ok: false, error: "no matching tab and no url to open" }
  if (focused.action === "opened") await waitForComplete(focused.tabId)
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: focused.tabId },
      func: pasteInPage,
      args: [text, into ?? null],
    })
    return injection?.result ?? { ok: false, error: "the page returned nothing" }
  } catch (error) {
    return { ok: false, error: `cannot access that tab: ${error.message}` }
  }
}

// Reads without focusing: findTab never opens a tab, so read is read-only.
const read = async ({ from, last, wait, timeoutMs, ...target }) => {
  if (!(await hasPageAccess())) return { ok: false, error: NO_PAGE_ACCESS }
  const found = await findTab(target)
  if (!found) return { ok: false, error: "no tab matches" }
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: found.tab.id },
      func: readInPage,
      args: [from, Boolean(last), Boolean(wait), Number(timeoutMs) || 60000],
    })
    return injection?.result ?? { ok: false, error: "the page returned nothing" }
  } catch (error) {
    return { ok: false, error: `cannot access that tab: ${error.message}` }
  }
}

const listTabs = async () => {
  const tabs = await browser.tabs.query({})
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned,
      lastAccessed: tab.lastAccessed,
      favIconUrl: tab.favIconUrl,
    })),
  }
}

const handle = async (request) => {
  if (request.op === "list") return { ok: true, ...(await listTabs()) }
  if (request.op === "paste") return paste(request)
  if (request.op === "read") return read(request)
  return { ok: true, ...(await focusTab(request)) }
}

let port

// --- Popup bridge ----------------------------------------------------------
// The popup can't read ~/.config/foxhop/tabs.json (browser sandbox), so it asks
// the native host for the targets and edits them through it. Focusing, by
// contrast, runs entirely here, so we call focusTab() directly — no host needed.
const cfgPending = new Map()
let cfgSequence = 0

const requestConfig = (op, extra = {}) =>
  new Promise((resolve, reject) => {
    if (!port) {
      reject(new Error("native host not connected"))
      return
    }
    const cfgId = ++cfgSequence
    cfgPending.set(cfgId, resolve)
    setTimeout(() => {
      if (cfgPending.delete(cfgId)) reject(new Error("host timeout"))
    }, 3000)
    port.postMessage({ cfgId, op, ...extra })
  })

browser.runtime.onMessage.addListener((message) => {
  switch (message?.type) {
    case "status":
      return Promise.resolve({ ok: true, connected: Boolean(port) })
    case "targets":
      return requestConfig("config:read")
    case "focus":
      return focusTab(message.target).then((result) => ({
        ok: true,
        ...result,
      }))
    case "add":
      return requestConfig("config:add", {
        url: message.url,
        title: message.title,
      })
    case "upsert":
      return requestConfig("config:upsert", { target: message.target })
    case "remove":
      return requestConfig("config:remove", { name: message.name })
    case "favorite":
      return requestConfig("config:favorite", { name: message.name })
    default:
      return Promise.resolve({ ok: false, error: "unknown message" })
  }
})

const connect = () => {
  port = browser.runtime.connectNative(HOST_NAME)

  port.onMessage.addListener(async (message) => {
    // Replies to popup-initiated config requests carry a cfgId.
    if (message.cfgId) {
      const resolve = cfgPending.get(message.cfgId)
      if (resolve) {
        cfgPending.delete(message.cfgId)
        resolve(message)
      }
      return
    }
    // Otherwise it's a host-initiated tab operation to actuate.
    const { reqId } = message
    try {
      const result = await handle(message)
      port.postMessage({ reqId, ...result })
    } catch (error) {
      port.postMessage({ reqId, ok: false, error: String(error) })
    }
  })

  port.onDisconnect.addListener(() => {
    port = undefined
    setTimeout(connect, 1000)
  })
}

connect()

// --- Toolbar icon ----------------------------------------------------------
// The toolbar icon is a user setting stored under "toolbarIcon" ("leaping-fox" by
// default). The default is the manifest icon, so path null restores theme_icons; any other
// choice points at its self-adapting SVG, which carries both toolbar colours.
const TOOLBAR_ICONS = ["leaping-fox", "fox-head", "fox-tab", "tail-hop"]
const DEFAULT_TOOLBAR_ICON = "leaping-fox"

const applyToolbarIcon = async (id) => {
  const choice = TOOLBAR_ICONS.includes(id) ? id : DEFAULT_TOOLBAR_ICON
  try {
    if (choice === DEFAULT_TOOLBAR_ICON) {
      await browser.browserAction.setIcon({ path: null })
    } else {
      await browser.browserAction.setIcon({
        path: browser.runtime.getURL(`src/icons/toolbar/${choice}.svg`),
      })
    }
  } catch {}
}

const loadToolbarIcon = async () => {
  try {
    const stored = await browser.storage.local.get("toolbarIcon")
    await applyToolbarIcon(stored?.toolbarIcon ?? DEFAULT_TOOLBAR_ICON)
  } catch {}
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "toolbarIcon" in changes) {
    applyToolbarIcon(changes.toolbarIcon.newValue)
  }
})

loadToolbarIcon()
