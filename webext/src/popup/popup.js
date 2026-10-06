import { findMatchingTab } from "../match.js"

const listEl = document.getElementById("list")
const stateEl = document.getElementById("state")
const searchEl = document.getElementById("search")
const addEl = document.getElementById("add-current")
const addStatusEl = document.getElementById("add-status")
const viewList = document.getElementById("view-list")
const viewWarning = document.getElementById("view-warning")
const editor = document.getElementById("editor")
const editorName = document.getElementById("editor-name")
const editorMeta = document.getElementById("editor-meta")
const editorCancel = document.getElementById("editor-cancel")
const fTitle = document.getElementById("f-title")
const fMatch = document.getElementById("f-match")
const fUrl = document.getElementById("f-url")
const fNavigate = document.getElementById("f-navigate")

let targets = []
let openTabs = []
// Last-seen favicon per target id, persisted in browser.storage.local so a
// target keeps its icon even when no tab for it is open.
let faviconCache = {}
let editing = null

const send = (message) => browser.runtime.sendMessage(message)

const showState = (text) => {
  stateEl.textContent = text
  stateEl.hidden = false
  listEl.hidden = true
}

// Deterministic hue per target so each monogram is distinct yet stable.
//
// MONOGRAM_LIGHTNESS is the part that matters and it is not a taste choice:
// the label is white, and white over hsl(h 60% 45%) fell to 2.12:1 at yellow.
// Sweeping the whole hue circle, 30% is the highest lightness at which white
// clears 4.5:1 at *every* hue (worst case 4.51:1, at hue 60). Raise it and the
// yellows and greens silently fail again.
//
// Picking the text colour per hue instead — white on dark hues, ink on light
// ones — looks like the cleverer fix and does not work: at the crossover hue
// neither colour is far enough from the background, and the best achievable
// worst case is 4.16:1. It was measured, not assumed.
const MONOGRAM_LIGHTNESS = 30

const hueFor = (key) => {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

// A target is "open" when any live tab matches it (by match, not by saved
// url, so redirects still count). The open cue is a separate indicator in
// the row, never a different icon, so it agrees with this same signal.
const isOpen = (target) => Boolean(findMatchingTab(target, openTabs))

const orderedTargets = () => {
  const openFirst = (a, b) => Number(isOpen(b)) - Number(isOpen(a))
  return [
    ...targets.filter((t) => t.favorite).sort(openFirst),
    ...targets.filter((t) => !t.favorite).sort(openFirst),
  ]
}

const filtered = () => {
  const query = searchEl.value.trim().toLowerCase()
  if (!query) return orderedTargets()
  return orderedTargets().filter((t) =>
    `${t.name} ${t.title ?? ""} ${t.match}`.toLowerCase().includes(query),
  )
}

const monogramFor = (target) => {
  const monogram = document.createElement("span")
  monogram.className = "monogram"
  monogram.style.background = `hsl(${hueFor(target.name)} 60% ${MONOGRAM_LIGHTNESS}%)`
  monogram.textContent = (target.title ?? target.name).slice(0, 1)
  return monogram
}

const forgetFavicon = async (id) => {
  if (!(id in faviconCache)) return
  delete faviconCache[id]
  try {
    await browser.storage.local.set({ favicons: faviconCache })
  } catch {}
}

// Prefer the live tab's favicon, else the last-seen one from the cache; the
// monogram is only for targets never seen open. A dead icon (cached url gone)
// falls back to the monogram and is dropped from the cache.
const iconFor = (target) => {
  const favicon =
    findMatchingTab(target, openTabs)?.favIconUrl ?? faviconCache[target.name]
  if (!favicon) return monogramFor(target)
  const img = document.createElement("img")
  img.className = "favicon"
  img.src = favicon
  img.alt = ""
  img.addEventListener(
    "error",
    () => {
      img.replaceWith(monogramFor(target))
      forgetFavicon(target.name)
    },
    { once: true },
  )
  return img
}

const rowButton = (cls, glyph, label, onClick) => {
  const el = document.createElement("button")
  el.type = "button"
  // reveal-on-hover shows these on hover *and* on keyboard focus. They used to
  // be opacity: 0 with no focus rule, so tabbing moved through three invisible
  // buttons.
  el.className = `btn-icon reveal-on-hover ${cls}`
  el.textContent = glyph
  el.setAttribute("aria-label", label)
  el.addEventListener("click", (event) => {
    event.stopPropagation()
    onClick()
  })
  return el
}

const renderRow = (target) => {
  const row = document.createElement("li")
  row.className = "row-bleed"
  row.dataset.name = target.name

  // The row's primary action is a real button rather than a click listener on
  // the <li>. A bare list item is not in the tab order, so the main action of
  // the most developed popup here could not be reached by keyboard at all.
  const main = document.createElement("button")
  main.type = "button"
  main.className = "row-main"

  const text = document.createElement("span")
  text.className = "row-text"
  const name = document.createElement("div")
  name.className = "row-name"
  name.textContent = target.title ?? target.name
  const match = document.createElement("div")
  match.className = "row-match"
  match.textContent = target.match
  text.append(name, match)

  const fav = rowButton(
    target.favorite ? "fav is-on" : "fav",
    target.favorite ? "★" : "☆",
    "Toggle favourite",
    async () => {
      const ack = await send({ type: "favorite", name: target.name })
      if (ack?.ok) refresh(ack.targets)
    },
  )
  fav.setAttribute("aria-pressed", String(Boolean(target.favorite)))
  const edit = rowButton("edit", "✎", "Edit target", () => openEditor(target))
  const remove = rowButton("remove", "×", "Delete target", async () => {
    const ack = await send({ type: "remove", name: target.name })
    if (ack?.ok) refresh(ack.targets)
  })

  const icon = document.createElement("span")
  icon.className = "row-icon"
  icon.append(iconFor(target))
  // Open state is a separate shape, never a swapped icon: a badge on the
  // icon's corner when a tab is open, nothing when not, labelled for
  // assistive tech. Presence carries the meaning, so it reads without colour.
  if (isOpen(target)) {
    const dot = document.createElement("span")
    dot.className = "open-dot"
    dot.setAttribute("role", "img")
    dot.setAttribute("aria-label", "Open")
    dot.title = "Open"
    icon.append(dot)
  }
  main.append(icon, text)
  main.addEventListener("click", () => focus(target))
  row.append(main, edit, remove, fav)
  return row
}

const render = () => {
  const rows = filtered()
  listEl.replaceChildren(...rows.map(renderRow))
  searchEl.parentElement.hidden = targets.length === 0
  if (!targets.length) {
    showState("No targets yet. Add the current tab to get started.")
  } else if (!rows.length) {
    showState("No matches.")
  } else {
    stateEl.hidden = true
    listEl.hidden = false
  }
}

const refresh = (next) => {
  if (Array.isArray(next)) targets = next
  render()
  rememberFavicons()
}

const focus = async (target) => {
  const ack = await send({ type: "focus", target })
  if (ack?.ok) window.close()
}

const openEditor = (target) => {
  editing = target
  // The id is shown read-only: renaming would break `foxhop focus <name>`
  // and the generated Raycast script, so the editor offers no name field.
  editorName.textContent = target.title ?? target.name
  editorMeta.textContent = `${target.name} · Raycast: focus-${target.name}`
  fUrl.value = target.url ?? ""
  fTitle.value = target.title ?? ""
  fMatch.value = target.match ?? ""
  fNavigate.checked = Boolean(target.navigate)
  viewList.hidden = true
  editor.hidden = false
}

const closeEditor = () => {
  editing = null
  editor.hidden = true
  viewList.hidden = false
}

editor.addEventListener("submit", async (event) => {
  event.preventDefault()
  const next = {
    ...editing,
    url: fUrl.value.trim() || undefined,
    title: fTitle.value.trim() || undefined,
    match: fMatch.value.trim(),
    navigate: fNavigate.checked || undefined,
  }
  const ack = await send({ type: "upsert", target: next })
  if (ack?.ok) {
    refresh(ack.targets)
    closeEditor()
  }
})

editorCancel.addEventListener("click", closeEditor)

// Record the favicon of every target with a matching open tab, persisting
// the cache so icons survive closed tabs and restarts. Entries for ids that
// no longer exist are dropped, so a removed target leaves nothing behind.
const rememberFavicons = async () => {
  let changed = false
  const ids = new Set(targets.map((target) => target.name))
  for (const id of Object.keys(faviconCache)) {
    if (ids.has(id)) continue
    delete faviconCache[id]
    changed = true
  }
  for (const target of targets) {
    const icon = findMatchingTab(target, openTabs)?.favIconUrl
    if (icon && faviconCache[target.name] !== icon) {
      faviconCache[target.name] = icon
      changed = true
    }
  }
  if (!changed) return
  try {
    await browser.storage.local.set({ favicons: faviconCache })
  } catch {}
}

addEl.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return
  const ack = await send({ type: "add", url: tab.url, title: tab.title }).catch(
    () => null,
  )
  if (ack?.ok) {
    refresh(ack.targets)
    reportAdd(ack)
  } else showState("Couldn't add the current tab.")
})

let addStatusTimer = 0

const showAddStatus = (text) => {
  addStatusEl.textContent = text
  addStatusEl.hidden = false
  clearTimeout(addStatusTimer)
  addStatusTimer = setTimeout(() => {
    addStatusEl.hidden = true
    addStatusEl.textContent = ""
    addStatusEl.classList.remove("is-created")
  }, 2500)
}

// After an add, scroll the landing row into view with a brief flash and a
// transient status line. An older host replies without name/created, and then
// there is nothing to point at, so the add just refreshes as before.
const reportAdd = (ack) => {
  if (ack?.name == null || typeof ack?.created !== "boolean") return
  const added = (ack.targets ?? []).find((target) => target.name === ack.name)
  const title = added?.title ?? ack.name
  const row = listEl.querySelector(`[data-name="${CSS.escape(ack.name)}"]`)
  if (row) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    row.scrollIntoView({ block: "nearest", ...(reduced ? {} : { behavior: "smooth" }) })
    row.classList.add("is-added")
    setTimeout(() => row.classList.remove("is-added"), 1000)
  }
  let text = ack.created ? `Added ${title}` : `${title} is already saved`
  if (!ack.created && ack.urlChanged) text += " — link updated"
  addStatusEl.classList.toggle("is-created", ack.created)
  showAddStatus(text)
}

searchEl.addEventListener("input", render)

const showWarning = () => {
  viewList.hidden = true
  viewWarning.hidden = false
}

const load = async () => {
  const status = await send({ type: "status" }).catch(() => null)
  if (!status?.connected) {
    showWarning()
    return
  }
  try {
    const stored = await browser.storage.local.get("favicons")
    if (stored?.favicons) faviconCache = stored.favicons
  } catch {}
  openTabs = await browser.tabs.query({})
  const ack = await send({ type: "targets" }).catch(() => null)
  if (!ack?.ok) {
    showWarning()
    return
  }
  refresh(ack.targets ?? [])
}

load()
