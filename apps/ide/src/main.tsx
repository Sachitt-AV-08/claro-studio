import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { setOllamaTransport } from '@project/ai';
import './styles/global.css';

// In the packaged app the renderer origin is opaque ("null") and Ollama's CORS
// allowlist rejects it. Route Ollama API calls through the Electron main
// process, which has no origin and therefore no CORS. Falls back to direct
// fetch in dev / browser.
const aiFetch = window.electronAPI?.claroAiFetch;
if (aiFetch) {
  setOllamaTransport(async (path, init) => {
    const res = await aiFetch(path, init.method, init.body ? JSON.parse(init.body) : undefined);
    return { status: res.status, ok: res.ok, text: res.text };
  });
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);