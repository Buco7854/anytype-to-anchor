const KEY = "anytype-anchor-theme";
type Theme = "light" | "dark";
const validTheme = (value: unknown): Theme | undefined =>
  value === "light" || value === "dark" ? value : undefined;

export function initTheme() {
  const device = matchMedia("(prefers-color-scheme: dark)");
  const button = document.getElementById("theme-toggle") as HTMLButtonElement;
  let preference: Theme | undefined;
  try {
    preference = validTheme(localStorage.getItem(KEY));
  } catch {
    /* Storage can be disabled. */
  }
  const apply = () => {
    const theme = preference ?? (device.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#111111" : "#f9fbfc");
    button.setAttribute("aria-pressed", String(theme === "dark"));
    button.title =
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  };
  apply();
  button.addEventListener("click", () => {
    preference =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, preference);
    } catch {
      /* Keep the choice for this tab without storage. */
    }
    apply();
    document.getElementById("status")!.textContent =
      `${preference === "dark" ? "Dark" : "Light"} theme enabled.`;
  });
  device.addEventListener("change", () => {
    if (!preference) apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) {
      preference = event.key === null ? undefined : validTheme(event.newValue);
      apply();
    }
  });
}
