import React from 'react';
import { usePeer } from '../context/PeerContext';
import { MonitorUp, X, AppWindow } from 'lucide-react';
import './VideoGrid.css';

// Electron-only modal: pick which screen or window to share.
// Browsers use the native getDisplayMedia picker instead.
export const ScreenSharePicker: React.FC = () => {
    const { screenShareSources, selectScreenShareSource } = usePeer();

    if (!screenShareSources) return null;

    const screens = screenShareSources.filter(s => s.id.startsWith('screen'));
    const windows = screenShareSources.filter(s => !s.id.startsWith('screen'));

    const renderSource = (source: { id: string; name: string; thumbnail?: string }) => (
        <button key={source.id} className="screen-picker-item" onClick={() => selectScreenShareSource(source.id)}>
            {source.thumbnail ? (
                <img src={source.thumbnail} alt="" className="screen-picker-thumb" />
            ) : (
                <div className="screen-picker-thumb placeholder">
                    {source.id.startsWith('screen') ? <MonitorUp size={28} /> : <AppWindow size={28} />}
                </div>
            )}
            <span className="screen-picker-name">{source.name}</span>
        </button>
    );

    return (
        <div className="screen-picker-overlay" onClick={() => selectScreenShareSource(null)}>
            <div className="screen-picker-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="screen-picker-header">
                    <h3><MonitorUp size={18} /> Share your screen</h3>
                    <button className="screen-picker-close" onClick={() => selectScreenShareSource(null)} title="Cancel">
                        <X size={18} />
                    </button>
                </div>
                <div className="screen-picker-scroll">
                    {screens.length > 0 && (
                        <>
                            <div className="screen-picker-section-title">Screens</div>
                            <div className="screen-picker-grid">{screens.map(renderSource)}</div>
                        </>
                    )}
                    {windows.length > 0 && (
                        <>
                            <div className="screen-picker-section-title">Windows</div>
                            <div className="screen-picker-grid">{windows.map(renderSource)}</div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
