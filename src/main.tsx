import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

function reportRendererError(message: string, stack?: string) {
  if (typeof window !== 'undefined' && window.timelapser?.reportRendererError) {
    window.timelapser.reportRendererError(message, stack);
  }
}

window.addEventListener('error', (e) => {
  reportRendererError(String(e.message), e.error?.stack);
});

window.addEventListener('unhandledrejection', (e) => {
  reportRendererError(`Unhandled rejection: ${e.reason}`, typeof e.reason?.stack === 'string' ? e.reason.stack : undefined);
});

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

