import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './ui/App';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement == null) {
  throw new Error('Missing #root element for webview app.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
