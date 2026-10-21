/**
 * @file monacoSetup.ts
 * @brief Wiring for the locally bundled Monaco editor.
 * @details `@monaco-editor/react` downloads Monaco from a public CDN unless it is given an existing
 * instance. Fetching executable JavaScript at runtime would let a third party (or anyone able to
 * intercept the request) run code inside a webview that can call every database IPC command. Monaco
 * and its workers are therefore bundled with the application and registered here before the first
 * editor mounts, which also makes the SQL workbench work offline.
 */

// Only the SQL grammar and the JSON language service are imported: pulling in `monaco-editor`
// directly would also bundle every other language worker (including a 7 MB TypeScript worker that
// this application never uses).
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

/**
 * @brief Provides the web worker Monaco asks for by label.
 * @details SQL colouring runs on the main thread, so only the core editor worker and the JSON worker
 * (used by the value inspector for JSON document values) are bundled.
 * @param _moduleId Module identifier supplied by Monaco.
 * @param label Worker label supplied by Monaco.
 * @return Worker instance matching the requested language service.
 */
function createEditorWorker(_moduleId: string, label: string): Worker {
  if (label === 'json') {
    return new jsonWorker();
  }
  return new editorWorker();
}

/**
 * @brief Registers the bundled editor worker factory on the global environment.
 */
export function configureMonacoEnvironment(): void {
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: createEditorWorker,
  };
}

/**
 * @brief Points the React wrapper at the bundled Monaco instance instead of the CDN build.
 */
export function configureMonacoLoader(): void {
  configureMonacoEnvironment();
  loader.config({ monaco });
}

configureMonacoLoader();
