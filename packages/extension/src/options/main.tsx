import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Options from './Options';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('[cborg] options: #root element not found');
}

createRoot(container).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
