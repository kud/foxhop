// Self-contained functions injected into the page by
// browser.scripting.executeScript. They are serialised at the call site, so
// they must never close over module scope — everything they need arrives as
// an argument.

export const pasteInPage = (text, selector) => {
  const TEXT_LIKE = ["text", "search", "email", "url", "tel", "password", "number"]

  const isTextLikeInput = (el) =>
    el.tagName === "INPUT" &&
    TEXT_LIKE.includes((el.getAttribute("type") ?? "text").toLowerCase())

  const isEditable = (el) => {
    if (!(el instanceof HTMLElement)) return false
    if (el.isContentEditable) return true
    if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly
    return isTextLikeInput(el) && !el.disabled && !el.readOnly
  }

  const isVisible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = window.getComputedStyle(el)
    return style.visibility !== "hidden" && style.display !== "none"
  }

  const fillInput = (el) => {
    // React and friends own "value", so write through the native setter and
    // announce the change, or the framework never notices.
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value",
    )?.set
    if (setter) setter.call(el, text)
    else el.value = text
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  }

  const fillContentEditable = (el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    // execCommand goes through the editor's own undo stack where it works.
    if (document.execCommand("insertText", false, text)) return
    el.textContent = text
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }

  const fill = (el) => {
    el.focus()
    if (el.isContentEditable) fillContentEditable(el)
    else fillInput(el)
  }

  // An explicit selector wins even when it matches something the fallbacks
  // would reject — the user said which box to fill.
  if (selector) {
    let el
    try {
      el = document.querySelector(selector)
    } catch (error) {
      return { ok: false, error: `bad selector ${selector}: ${error.message}` }
    }
    if (!el) return { ok: false, error: `nothing matches ${selector} on that tab` }
    if (!isEditable(el)) return { ok: false, error: "no text box on that tab" }
    fill(el)
    return { ok: true, filled: true }
  }

  const active = document.activeElement
  if (active && isEditable(active)) {
    fill(active)
    return { ok: true, filled: true }
  }

  const area = (el) => {
    const rect = el.getBoundingClientRect()
    return rect.width * rect.height
  }
  const candidates = [
    ...document.querySelectorAll("textarea, input, [contenteditable]"),
  ].filter((el) => isEditable(el) && isVisible(el))
  const largest = candidates.reduce(
    (best, el) => (!best || area(el) > area(best) ? el : best),
    null,
  )
  if (!largest) return { ok: false, error: "no text box on that tab" }
  fill(largest)
  return { ok: true, filled: true }
}

export const readInPage = async (selector, last, wait, timeoutMs) => {
  const read = () => {
    let nodes
    try {
      nodes = document.querySelectorAll(selector)
    } catch (error) {
      return { ok: false, error: `bad selector ${selector}: ${error.message}` }
    }
    const texts = [...nodes].map((el) => (el.innerText ?? "").trim())
    if (!texts.length)
      return { ok: false, error: `nothing matches ${selector} on that tab` }
    return {
      ok: true,
      texts: last ? [texts[texts.length - 1]] : texts,
    }
  }

  if (!wait) return read()

  // Poll until the picked text (last match, else the joined blocks) has been
  // unchanged and non-empty for QUIET_MS, bounded by the caller's timeout.
  const TICK_MS = 250
  const QUIET_MS = 1500
  const joined = (result) => (result.ok ? result.texts.join("\n\n") : "")
  const deadline = Date.now() + timeoutMs
  let previous = joined(read())
  let quietFor = 0
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TICK_MS))
    const current = joined(read())
    if (current === previous && current.trim() !== "") {
      quietFor += TICK_MS
      if (quietFor >= QUIET_MS) return read()
    } else {
      quietFor = 0
      previous = current
    }
  }
  return { ok: false, error: `text still changing after ${Math.round(timeoutMs / 1000)}s` }
}
