/**
 * Reads a CSS custom property's live value for Chart.js/Canvas code that
 * can't reference `var(...)` directly. Must read from `document.body`, not
 * `document.documentElement` — the dark-mode overrides are scoped to
 * `body.dark-theme` in src/styles.css, and custom properties don't inherit
 * upward from body to html.
 */
export function themeColor(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}
