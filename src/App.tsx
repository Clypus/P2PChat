import { useState, useEffect } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { ServerSidebar } from './components/ServerSidebar';
import { ChatArea } from './components/ChatArea';
import { PeerProvider } from './context/PeerContext';
import { WelcomeScreen } from './components/WelcomeScreen';
import { IncomingCallModal } from './components/IncomingCallModal';
import { SettingsModal } from './components/SettingsModal';
import { RemoteAudioPlayback } from './components/VideoGrid';
import { ScreenSharePicker } from './components/ScreenSharePicker';
import { TitleBar } from './components/TitleBar';
import { usePeer } from './context/PeerContext';
import type { UpdaterState } from './electron';
import { applyStoredTheme } from './utils/theme';

// Applied before React mounts so there is no flash of the default palette.
applyStoredTheme();

// The main process owns the close-to-tray behaviour; hand it the stored
// preference as soon as the renderer boots.
window.electronAPI?.setCloseToTray?.(localStorage.getItem('p2p_chat_close_to_tray') !== 'false');

interface PeerIdentity {
  name: string;
  id: string;
}

function App() {
  const [identity, setIdentity] = useState<PeerIdentity | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {

    const saved = localStorage.getItem('p2p_chat_identity');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setIdentity({ name: parsed.name || parsed.displayName || 'User', id: parsed.id || parsed.peerId || '' });
      } catch { }
    }
  }, []);

  const handleSetupComplete = (name: string) => {
    const newId = name.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Math.random().toString(36).substring(2, 6);
    const newIdentity = { name, id: newId };
    localStorage.setItem('p2p_chat_identity', JSON.stringify(newIdentity));
    setIdentity(newIdentity);
  };

  if (!identity) {
    return (
      <>
        <TitleBar />
        <WelcomeScreen onComplete={handleSetupComplete} />
      </>
    );
  }

  return (
    <PeerProvider initialId={identity.id} displayName={identity.name}>
      <TitleBar />
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
        <ScreenSharePicker />
        <SignalStatusBanner />
        <UpdateBanner />
        <AudioManager />
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </div>
    </PeerProvider>
  );
}

// Always-mounted component that plays remote audio streams

function AudioManager() {
  const { remoteStreams, isDeafened, peerVolumes, audioSettings } = usePeer();
  return <RemoteAudioPlayback streams={remoteStreams} isDeafened={isDeafened} peerVolumes={peerVolumes} masterVolume={audioSettings.masterVolume} />;
}

// Auto-update prompt. Only the packaged desktop build reports anything; the
// browser and dev builds render nothing at all.
function UpdateBanner() {
    const [status, setStatus] = useState<UpdaterState | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        const updater = window.electronAPI?.updater;
        if (!updater) return;
        const off = updater.onStatus((payload) => {
            setStatus(payload);
            if (payload.state === 'available' || payload.state === 'ready') setDismissed(false);
        });
        updater.check().catch(() => { });
        // Re-check every six hours for long-running sessions.
        const timer = setInterval(() => { updater.check().catch(() => { }); }, 6 * 60 * 60 * 1000);
        return () => { off(); clearInterval(timer); };
    }, []);

    if (!status || dismissed) return null;
    if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'ready') return null;

    return (
        <div className="update-banner">
            {status.state === 'available' && (
                <>
                    <span>Version {status.version || 'unknown'} is available.</span>
                    <button className="update-banner-btn" onClick={() => window.electronAPI?.updater.download()}>Download</button>
                    <button className="update-banner-dismiss" onClick={() => setDismissed(true)}>Later</button>
                </>
            )}
            {status.state === 'downloading' && (
                <>
                    <span>Downloading update… {status.percent ?? 0}%</span>
                    <div className="update-banner-bar"><div style={{ width: (status.percent ?? 0) + '%' }} /></div>
                </>
            )}
            {status.state === 'ready' && (
                <>
                    <span>Update {status.version || ''} is ready.</span>
                    <button className="update-banner-btn" onClick={() => window.electronAPI?.updater.install()}>Restart now</button>
                    <button className="update-banner-dismiss" onClick={() => setDismissed(true)}>Later</button>
                </>
            )}
        </div>
    );
}

// Thin banner shown while the connection to the signaling server is down
function SignalStatusBanner() {
  const { signalStatus } = usePeer();
  if (signalStatus !== 'reconnecting') return null;
  return (
    <div className="signal-banner">
      <span className="signal-banner-dot" />
      Connection to signaling server lost — reconnecting... Existing calls and chats keep working.
    </div>
  );
}

export default App;
