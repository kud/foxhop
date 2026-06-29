const listEl = document.getElementById("list")
const stateEl = document.getElementById("state")
const searchEl = document.getElementById("search")
const addEl = document.getElementById("add-current")
const viewList = document.getElementById("view-list")
const viewWarning = document.getElementById("view-warning")
const editor = document.getElementById("editor")
const editorName = document.getElementById("editor-name")
const editorCancel = document.getElementById("editor-cancel")
const fTitle = document.getElementById("f-title")
const fMatch = document.getElementById("f-match")
const fUrl = document.getElementById("f-url")

let targets = []
let tabFavicons = {}
let editing = null

const send = (message) => browser.runtime.sendMessage(message)

const showState = (text) => {
  stateEl.textContent = text
  stateEl.hidden = false
  listEl.hidden = true
}

// Deterministic hue per target so each monogram is distinct yet stable, and
// legible on both light and dark backgrounds.
const hueFor = (key) => {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

const hostOf = (target) => {
  try {
    return new URL(target.url ?? `https://${target.match}`).hostname
  } catch {
    return target.match
  }
}

// A target is "open" if a live tab matches its host — the same signal that
// decides favicon vs monogram, so the cue and the ordering always agree.
const isOpen = (target) => Boolean(tabFavicons[hostOf(target)])

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

const iconFor = (target) => {
  const favicon = tabFavicons[hostOf(target)]
  if (favicon) {
    const img = document.createElement("img")
    img.className = "favicon"
    img.src = favicon
    img.alt = ""
    return img
  }
  const monogram = document.createElement("span")
  monogram.className = "monogram"
  monogram.style.background = `hsl(${hueFor(target.name)} 60% 45%)`
  monogram.textContent = (target.title ?? target.name).slice(0, 1)
  return monogram
}

const rowButton = (cls, glyph, label, onClick) => {
  const el = document.createElement("button")
  el.type = "button"
  el.className = `row-btn ${cls}`
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
  row.className = "row"

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
    target.favorite ? "fav on" : "fav",
    target.favorite ? "★" : "☆",
    "Toggle favourite",
    async () => {
      const ack = await send({ type: "favorite", name: target.name })
      if (ack?.ok) refresh(ack.targets)
    },
  )
  const edit = rowButton("edit", "✎", "Edit target", () => openEditor(target))
  const remove = rowButton("remove", "×", "Delete target", async () => {
    const ack = await send({ type: "remove", name: target.name })
    if (ack?.ok) refresh(ack.targets)
  })

  row.append(iconFor(target), text, fav, edit, remove)
  row.addEventListener("click", () => focus(target))
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
}

const focus = async (target) => {
  const ack = await send({ type: "focus", target })
  if (ack?.ok) window.close()
}

const openEditor = (target) => {
  editing = target
  editorName.textContent =
    target.title && target.title !== target.name
      ? `${target.title} (${target.name})`
      : target.name
  fUrl.value = target.url ?? ""
  fTitle.value = target.title ?? ""
  fMatch.value = target.match ?? ""
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
  }
  const ack = await send({ type: "upsert", target: next })
  if (ack?.ok) {
    refresh(ack.targets)
    closeEditor()
  }
})

editorCancel.addEventListener("click", closeEditor)

const buildTabFavicons = async () => {
  const tabs = await browser.tabs.query({})
  const map = {}
  for (const tab of tabs) {
    if (!tab.url || !tab.favIconUrl) continue
    try {
      map[new URL(tab.url).hostname] = tab.favIconUrl
    } catch {}
  }
  return map
}

addEl.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return
  const ack = await send({ type: "add", url: tab.url, title: tab.title }).catch(
    () => null,
  )
  if (ack?.ok) refresh(ack.targets)
  else showState("Couldn't add the current tab.")
})

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
  tabFavicons = await buildTabFavicons()
  const ack = await send({ type: "targets" }).catch(() => null)
  if (!ack?.ok) {
    showWarning()
    return
  }
  refresh(ack.targets ?? [])
}

load()
