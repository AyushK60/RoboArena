import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import { store } from './state/store';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// E2E/diagnostics hook (also used by the browser test journeys).
(window as unknown as Record<string, unknown>).__store = store;
