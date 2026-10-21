/**
 * @file theme.ts
 * @brief Domain models, identifiers, and configuration metadata for DynoDbModeler visual themes.
 * @details Supports four distinct visual themes: Dark (Default), GitIngest (Warm/Amber),
 * GitHub Light, and Midnight OLED.
 */

/**
 * @brief Supported application visual theme identifiers.
 */
export type AppTheme = 'dark' | 'gitingest' | 'github-light' | 'midnight';

/**
 * @brief Detailed visual and functional metadata for an application theme.
 */
export interface ThemeMeta {
  /** @brief Unique theme identifier. */
  id: AppTheme;
  /** @brief Human-readable display label. */
  label: string;
  /** @brief Short description of the theme visual style. */
  description: string;
  /** @brief Color scheme category ('dark' or 'light'). */
  type: 'dark' | 'light';
  /** @brief Primary background color code used for preview badges in UI selectors. */
  previewColor: string;
  /** @brief Target Monaco Editor built-in theme ('vs-dark' or 'vs'). */
  monacoTheme: 'vs-dark' | 'vs';
  /** @brief Canvas background surface color. */
  canvasBg: string;
  /** @brief Background dot grid color for `@xyflow/react` ERD canvas. */
  canvasDots: string;
  /** @brief Primary accent highlight color. */
  accentColor: string;
}

/**
 * @brief Fallback default theme identifier.
 */
export const DEFAULT_THEME: AppTheme = 'dark';

/**
 * @brief Comprehensive directory of all registered application themes and styling metadata.
 */
export const THEMES: Record<AppTheme, ThemeMeta> = {
  dark: {
    id: 'dark',
    label: 'Dark (Default)',
    description: 'Modern sleek dark theme with blue accents',
    type: 'dark',
    previewColor: '#1e1f22',
    monacoTheme: 'vs-dark',
    canvasBg: '#1e1f22',
    canvasDots: '#35373c',
    accentColor: '#3a82f7',
  },
  gitingest: {
    id: 'gitingest',
    label: 'GitIngest',
    description: 'Warm cream paper aesthetic with amber accents',
    type: 'light',
    previewColor: '#faf8f5',
    monacoTheme: 'vs',
    canvasBg: '#faf8f5',
    canvasDots: '#d5cec2',
    accentColor: '#ea580c',
  },
  'github-light': {
    id: 'github-light',
    label: 'GitHub Light',
    description: 'Clean crisp light theme with blue highlights',
    type: 'light',
    previewColor: '#ffffff',
    monacoTheme: 'vs',
    canvasBg: '#ffffff',
    canvasDots: '#d0d7de',
    accentColor: '#0969da',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight OLED',
    description: 'True black high-contrast OLED mode with neon cyan',
    type: 'dark',
    previewColor: '#000000',
    monacoTheme: 'vs-dark',
    canvasBg: '#000000',
    canvasDots: '#1c1f2e',
    accentColor: '#00f0ff',
  },
};
