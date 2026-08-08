import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { SupportProvider } from './support/SupportProvider.jsx';
import { initTheme } from './lib/theme.js';

/* Applied synchronously BEFORE React mounts so a light-mode load never flashes
   the dark shell first. Defaults to `system`, which is what a placement cell
   demoing on a projector in a bright room actually wants. */
initTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <SupportProvider>
        <App />
      </SupportProvider>
    </AuthProvider>
  </React.StrictMode>,
);
