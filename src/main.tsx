/**
 * @file main.tsx
 * @brief Application entry point mounting the root React component.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * @brief Initializes and mounts the React application tree into the root DOM node.
 * @return {void}
 */
function init(): void {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
}

init();
