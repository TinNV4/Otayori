import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PrivacyAndGuideView } from './components/PrivacyAndGuideView.tsx';
import './index.css';

// The privacy page is linked from the bot's welcome message and must work without LINE login.
const isPublicPrivacy = new URLSearchParams(window.location.search).get('tab') === 'privacy';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPublicPrivacy ? <div className="min-h-screen bg-slate-50"><PrivacyAndGuideView /></div> : <App />}</StrictMode>,
);
