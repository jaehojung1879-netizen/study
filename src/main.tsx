import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { router } from './app/router';
import { StudyProvider } from './app/StudyProvider';
import './styles/global.css';
import './styles/features.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element is missing from index.html');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <StudyProvider>
      <RouterProvider router={router} />
    </StudyProvider>
  </React.StrictMode>,
);

// Offline-first: the question bank and UI stay usable without a network.
registerSW({ immediate: true });
