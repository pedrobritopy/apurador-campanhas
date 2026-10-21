import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './estilo.css';
import App from './App.jsx';

createRoot(document.getElementById('raiz')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
