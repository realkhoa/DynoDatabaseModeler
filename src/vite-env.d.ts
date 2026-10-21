/// <reference types="vite/client" />

/**
 * @file vite-env.d.ts
 * @brief Ambient declarations for Vite-specific import suffixes.
 * @details Declares the `?worker` import shape used to bundle the Monaco editor worker locally, so
 * TypeScript understands the module while Vite emits a real worker chunk.
 */

declare module '*?worker' {
  /** @brief Worker constructor produced by Vite for a `?worker` import. */
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
