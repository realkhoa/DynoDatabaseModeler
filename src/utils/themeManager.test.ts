/**
 * @file themeManager.test.ts
 * @brief Unit tests for theme persistence, DOM synchronization, and event dispatching.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getSavedTheme,
  setSavedTheme,
  applyTheme,
  initTheme,
  onThemeChange,
  THEME_STORAGE_KEY,
} from './themeManager';
import type { AppTheme } from '../types/theme';

describe('themeManager utility', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * @brief Verifies getSavedTheme falls back to 'dark' when localStorage is empty.
   */
  it('returns default dark theme when no preference is saved', () => {
    expect(getSavedTheme()).toBe('dark');
  });

  /**
   * @brief Verifies getSavedTheme returns saved valid theme from localStorage.
   */
  it('reads stored theme preference from localStorage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'gitingest');
    expect(getSavedTheme()).toBe('gitingest');

    localStorage.setItem(THEME_STORAGE_KEY, 'midnight');
    expect(getSavedTheme()).toBe('midnight');
  });

  /**
   * @brief Verifies invalid stored values fall back to default theme.
   */
  it('handles invalid stored theme gracefully by falling back to dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'non_existent_theme');
    expect(getSavedTheme()).toBe('dark');
  });

  /**
   * @brief Verifies setSavedTheme stores value into localStorage.
   */
  it('persists chosen theme into localStorage', () => {
    setSavedTheme('github-light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('github-light');
  });

  /**
   * @brief Verifies applyTheme updates document data-theme attribute and color-scheme.
   */
  it('applies data-theme attribute and color-scheme to documentElement', () => {
    applyTheme('gitingest');
    expect(document.documentElement.getAttribute('data-theme')).toBe('gitingest');
    expect(document.documentElement.style.colorScheme).toBe('light');

    applyTheme('midnight');
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  /**
   * @brief Verifies applyTheme dispatches custom event dyno-theme-changed.
   */
  it('dispatches dyno-theme-changed custom event with theme detail', () => {
    const handler = vi.fn();
    window.addEventListener('dyno-theme-changed', handler);

    applyTheme('github-light');

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<{ theme: AppTheme }>;
    expect(event.detail.theme).toBe('github-light');

    window.removeEventListener('dyno-theme-changed', handler);
  });

  /**
   * @brief Verifies onThemeChange subscribes to custom events and unbinds cleanly.
   */
  it('allows subscribing and unsubscribing via onThemeChange helper', () => {
    const callback = vi.fn();
    const unsubscribe = onThemeChange(callback);

    applyTheme('gitingest');
    expect(callback).toHaveBeenCalledWith('gitingest');

    unsubscribe();
    applyTheme('dark');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  /**
   * @brief Verifies initTheme restores saved preference on startup.
   */
  it('initializes and applies saved theme on app startup', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'gitingest');
    const initialized = initTheme();

    expect(initialized).toBe('gitingest');
    expect(document.documentElement.getAttribute('data-theme')).toBe('gitingest');
  });

  /**
   * @brief Verifies all four theme configurations contain complete metadata and canvas tokens.
   */
  it('registers complete canvas and visual styling tokens for all themes', async () => {
    const { THEMES } = await import('../types/theme');
    const expectedThemes: AppTheme[] = ['dark', 'gitingest', 'github-light', 'midnight'];

    expectedThemes.forEach((themeId) => {
      const meta = THEMES[themeId];
      expect(meta).toBeDefined();
      expect(meta.id).toBe(themeId);
      expect(meta.label).toBeTruthy();
      expect(meta.canvasBg).toBeTruthy();
      expect(meta.canvasDots).toBeTruthy();
      expect(meta.accentColor).toBeTruthy();
      expect(['light', 'dark']).toContain(meta.type);
    });

    // Verify GitIngest specifically uses warm cream paper styling
    expect(THEMES.gitingest.canvasBg).toBe('#faf8f5');
    expect(THEMES.gitingest.accentColor).toBe('#ea580c');
    expect(THEMES.gitingest.type).toBe('light');

    // Verify Midnight OLED specifically uses true black styling
    expect(THEMES.midnight.canvasBg).toBe('#000000');
    expect(THEMES.midnight.accentColor).toBe('#00f0ff');
    expect(THEMES.midnight.type).toBe('dark');
  });
});
