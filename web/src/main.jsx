import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { SupportProvider } from './support/SupportProvider.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <SupportProvider>
        <App />
      </SupportProvider>
    </AuthProvider>
  </React.StrictMode>,
);
