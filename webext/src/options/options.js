// The toolbar icon variants under src/icons/toolbar/, stored under
// "toolbarIcon" in browser.storage.local. The background script applies the
// choice, so writing the key is the whole of this page's job.
const TOOLBAR_ICONS = ["leaping-fox", "fox-head", "fox-tab", "tail-hop"]
const DEFAULT_TOOLBAR_ICON = "leaping-fox"
const iconPicker = document.getElementById("icon-picker")

const checkToolbarIcon = (id) => {
  const choice = TOOLBAR_ICONS.includes(id) ? id : DEFAULT_TOOLBAR_ICON
  const picked = iconPicker.querySelector(`input[value="${choice}"]`)
  if (picked) picked.checked = true
}

iconPicker.addEventListener("change", (event) => {
  if (!TOOLBAR_ICONS.includes(event.target.value)) return
  browser.storage.local.set({ toolbarIcon: event.target.value }).catch(() => {})
})

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "toolbarIcon" in changes) {
    checkToolbarIcon(changes.toolbarIcon.newValue)
  }
})

const load = async () => {
  try {
    const stored = await browser.storage.local.get("toolbarIcon")
    checkToolbarIcon(stored?.toolbarIcon)
  } catch {}
}

load()
