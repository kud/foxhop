// Tiny ANSI helpers. Colour only when stdout is a TTY and NO_COLOR is unset, so
// piped / redirected output (and `--json`) stays clean and parseable.
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

const paint =
  (code: number) =>
  (text: string): string =>
    enabled ? `\x1b[${code}m${text}\x1b[0m` : text

export const bold = paint(1)
export const dim = paint(2)
export const red = paint(31)
export const green = paint(32)
export const yellow = paint(33)
export const cyan = paint(36)

export const ok = (message: string) => `${green("✓")} ${message}`
export const fail = (message: string) => `${red("✗")} ${message}`
