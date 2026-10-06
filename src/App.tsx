/**
 * @file App.tsx
 * @brief Root component for DynoDbModeler desktop application.
 */

import React from 'react';

/**
 * @brief Root component for DynoDbModeler application layout.
 * @return {React.ReactElement} The rendered root React element.
 */
export default function App(): React.ReactElement {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg-base)] text-[var(--color-text-main)]">
      <header className="flex h-10 items-center border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-toolbar)] px-4">
        <h1 className="text-sm font-semibold tracking-wide">DynoDbModeler</h1>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-lg text-center">
          <h2 className="text-lg font-medium text-[var(--color-accent-blue)]">DynoDbModeler Initialized</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Tauri v2 + React 19 + Tailwind CSS desktop database modeling environment.
          </p>
        </div>
      </main>
    </div>
  );
}
