const THEME_PREF_KEY = "visionflow_theme_preference";
const THEME_ACTIVE_KEY = "visionflow_theme_active";

export function getThemePreference() {
  return localStorage.getItem(THEME_PREF_KEY) || "light";
}

export function setThemePreference(theme) {
  localStorage.setItem(THEME_PREF_KEY, theme);
}

export function getActiveTheme() {
  return localStorage.getItem(THEME_ACTIVE_KEY) || "light";
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(theme === "light" ? "theme-light" : "theme-dark");
}

export function saveAndApplyTheme(theme) {
  localStorage.setItem(THEME_ACTIVE_KEY, theme);
  applyTheme(theme);
}

export function initTheme() {
  applyTheme(getActiveTheme());
}
