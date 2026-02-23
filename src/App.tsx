import { useState, useEffect } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { ServerSidebar } from './components/ServerSidebar';
import { ChatArea } from './components/ChatArea';
import { PeerProvider } from './context/PeerContext';
import { WelcomeScreen } from './components/WelcomeScreen';
import { IncomingCallModal } from './components/IncomingCallModal';
import { SettingsModal } from './components/SettingsModal';

interface PeerIdentity {
  name: string;
  id: string;
}

function App() {
  const [identity, setIdentity] = useState<PeerIdentity | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Load saved identity from localStorage if exists
    const saved = localStorage.getItem('p2p_chat_identity');
    if (saved) {
      setIdentity(JSON.parse(saved));
    }
  }, []);

  const handleSetupComplete = (name: string) => {
    const newId = name.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Math.random().toString(36).substring(2, 6);
    const newIdentity = { name, id: newId };
    localStorage.setItem('p2p_chat_identity', JSON.stringify(newIdentity));
    setIdentity(newIdentity);
  };

  if (!identity) {
    return <WelcomeScreen onComplete={handleSetupComplete} />;
  }

  return (
    <PeerProvider initialId={identity.id} displayName={identity.name}>
      <div className={`app-container ${isMobileMenuOpen ? 'mobile-menu-open' : ''}`}>

        <ServerSidebar closeMobileMenu={() => setIsMobileMenuOpen(false)} />
        <Sidebar
          onOpenSettings={() => { setShowSettings(true); setIsMobileMenuOpen(false); }}
          closeMobileMenu={() => setIsMobileMenuOpen(false)}
        />

        {/* Mobile menu overlay backdrop - AFTER sidebars so it renders on top for click capture */}
        {isMobileMenuOpen && (
          <div className="mobile-overlay-backdrop" onClick={() => setIsMobileMenuOpen(false)}></div>
        )}

        <main className="main-content">
          <ChatArea onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)} />
        </main>

        <IncomingCallModal />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </div>
    </PeerProvider>
  );
}

export default App;
