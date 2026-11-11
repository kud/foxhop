// The extension holds <all_urls> as an optional permission, granted from its
// settings page. Without it, paste and read answer with this error, which the
// CLI turns into a hint saying where to grant it.
export const NO_PAGE_ACCESS = "no page access"

export const PAGE_ACCESS_HINT =
  "foxhop needs page access for paste/read: open Fox Hop's settings (toolbar button → Settings) and click Grant"

export const describeAckError = (
  error: string | undefined,
  fallback: string,
): string => (error === NO_PAGE_ACCESS ? PAGE_ACCESS_HINT : (error ?? fallback))
