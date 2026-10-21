/**
 * @file themeManager.ts
 * @brief Utility functions for managing application themes, local persistence, and DOM synchronization.
 * @details Handles reading and persisting theme preferences in localStorage, toggling data-theme
 * attributes on document.documentElement, and broadcasting theme change events across the application.
 */

import type { AppTheme } from '../types/theme';
import { DEFAULT_THEME, THEMES } from '../types/theme';

/**
 * @brief LocalStorage key used to persist the user's active theme preference.
 */
export const THEME_STORAGE_KEY = 'dyno_theme_preference';

/**
 * @brief Custom DOM event name dispatched whenever the active theme is changed.
 */
export const THEME_CHANGE_EVENT = 'dyno-theme-changed';

/**
 * @brief Retrieves the saved theme preference from local storage.
 * @details Validates the stored value against known theme identifiers. If the value is
 * missing or invalid, falls back safely to DEFAULT_THEME.
 * @return Resolved AppTheme identifier.
 */
export function getSavedTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as AppTheme | null;
    if (saved && Object.prototype.hasOwnProperty.call(THEMES, saved)) {
      return saved;
    }
  } catch {
    // LocalStorage may throw in restricted sandboxes or private browsing mode
  }
  return DEFAULT_THEME;
}

/**
 * @brief Persists the selected theme into local storage.
 * @param theme Target theme identifier to save.
 */
export function setSavedTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Silently ignore storage quota or permission errors
  }
}

/**
 * @brief Applies the specified theme to the DOM document element and dispatches change notification.
 * @details Updates the root `data-theme` attribute, configures CSS `color-scheme`, and
 * broadcasts a `dyno-theme-changed` custom event for decoupled subscribers (Monaco, Canvas).
 * @param theme Target theme identifier to apply.
 */
export function applyTheme(theme: AppTheme): void {
  const meta = THEMES[theme] || THEMES[DEFAULT_THEME];

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = meta.type;
  }

  if (typeof window !== 'undefined') {
    const event = new CustomEvent<{ theme: AppTheme }>(THEME_CHANGE_EVENT, {
      detail: { theme },
    });
    window.dispatchEvent(event);
  }
}

/**
 * @brief Subscribes a listener callback to theme changes.
 * @param callback Handler receiving the newly applied AppTheme.
 * @return Unsubscribe cleanup function.
 */
export function onThemeChange(callback: (theme: AppTheme) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ theme: AppTheme }>;
    if (customEvent.detail && customEvent.detail.theme) {
      callback(customEvent.detail.theme);
    }
  };

  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handler);
  };
}

/**
 * @brief Initializes the theme on application mount.
 * @details Reads the stored theme preference (or default) and applies it to the DOM.
 * @return Active AppTheme applied.
 */
export function initTheme(): AppTheme {
  const theme = getSavedTheme();
  applyTheme(theme);
  return theme;
}
