import React, { useState, useEffect } from 'react';
import { usePeer } from '../context/PeerContext';
import { X, User, Shield, HardDrive, Download, Upload, Mic, Palette } from 'lucide-react';
import './SettingsModal.css';

interface SettingsModalProps {
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const { peerId, displayName, setDisplayName, avatarUrl, setAvatarUrl, audioSettings, updateAudioSettings, killSwitchKeyword, setKillSwitchKeyword, aboutMe, setAboutMe, pttEnabled, setPttEnabled, pttKey, setPttKey, peerLatencies, connections } = usePeer();

    const [editName, setEditName] = useState(displayName);
    const [editAvatar, setEditAvatar] = useState(avatarUrl || '');
    const [activeTab, setActiveTab] = useState<'profile' | 'voice' | 'privacy' | 'account' | 'appearance'>('profile');
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [editKeyword, setEditKeyword] = useState(killSwitchKeyword);
    const [editAboutMe, setEditAboutMe] = useState(aboutMe);
    const [theme, setTheme] = useState(() => localStorage.getItem('p2p_chat_theme') || 'dark');

    const applyTheme = (t: string) => {
        setTheme(t);
        localStorage.setItem('p2p_chat_theme', t);
        document.documentElement.setAttribute('data-theme', t);
    };

    useEffect(() => {
        if (activeTab === 'voice') {
            navigator.mediaDevices.enumerateDevices().then(devices => {
                const mics = devices.filter(d => d.kind === 'audioinput');
                setAudioDevices(mics);
            }).catch(console.error);
        }
    }, [activeTab]);

    const handleSaveProfile = (e: React.FormEvent) => {
        e.preventDefault();
        setDisplayName(editName);
        setAvatarUrl(editAvatar);
        setAboutMe(editAboutMe);

        const identity = { displayName: editName, peerId, avatarUrl: editAvatar, aboutMe: editAboutMe };
        localStorage.setItem('p2p_chat_identity', JSON.stringify(identity));
    };

    const handleExportAccount = () => {
        const servers = localStorage.getItem('p2p_chat_servers');
        const identity = localStorage.getItem('p2p_chat_identity');
        const friends = localStorage.getItem('p2p_chat_friends');

        const backup = {
            version: 2,
            identity: identity ? JSON.parse(identity) : null,
            servers: servers ? JSON.parse(servers) : [],
            friends: friends ? JSON.parse(friends) : {}
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `p2p_backup_${peerId.substring(0, 8)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="settings-overlay">
            <div className="settings-sidebar">
                <div className="settings-sidebar-header">
                    <h2>USER SETTINGS</h2>
                </div>
                <nav className="settings-nav">
                    <button
                        className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
                        onClick={() => setActiveTab('profile')}
                    >
                        <User size={18} /> My Account
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'voice' ? 'active' : ''}`}
                        onClick={() => setActiveTab('voice')}
                    >
                        <Mic size={18} /> Voice & Video
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'account' ? 'active' : ''}`}
                        onClick={() => setActiveTab('account')}
                    >
                        <HardDrive size={18} /> Backup & Restore
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'privacy' ? 'active' : ''}`}
                        onClick={() => setActiveTab('privacy')}
                    >
                        <Shield size={18} /> Privacy & Safety
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
                        onClick={() => setActiveTab('appearance')}
                    >
                        <Palette size={18} /> Appearance
                    </button>
                    <div className="settings-divider"></div>
                    <button className="settings-nav-item danger" onClick={() => {
                        if (window.confirm('Are you sure? This will delete all your data including messages, servers, and identity.')) {
                            localStorage.clear();
                            window.location.reload();
                        }
                    }}>
                        <Shield size={18} /> Log Out (Clear Data)
                    </button>
                </nav>
            </div>

            <div className="settings-content">
                <div className="settings-content-header">
                    <h2>{activeTab === 'profile' ? 'My Account' : activeTab === 'voice' ? 'Voice & Video' : activeTab === 'privacy' ? 'Privacy & Safety' : activeTab === 'appearance' ? 'Appearance' : 'Backup & Restore'}</h2>
                    <button className="settings-close-btn" onClick={onClose} title="Escape">
                        <X size={24} />
                        <span>ESC</span>
                    </button>
                </div>

                <div className="settings-scroll-area">
                    {activeTab === 'profile' && (
                        <div className="settings-section">
                            <div className="profile-card">
                                <div className="profile-card-header" style={{ backgroundColor: `hsl(${peerId.charCodeAt(0) * 10}, 60%, 40%)` }}></div>
                                <div className="profile-card-body">
                                    <div className="profile-avatar-wrapper">
                                        {editAvatar ? (
                                            <img src={editAvatar} alt="Avatar" className="profile-avatar-img" />
                                        ) : (
                                            <div className="profile-avatar-placeholder">
                                                {editName.substring(0, 2).toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                    <div className="profile-info">
                                        <h3>{displayName}</h3>
                                        <p>{peerId}</p>
                                    </div>
                                </div>
                            </div>

                            <form className="settings-form" onSubmit={handleSaveProfile}>
                                <div className="form-group">
                                    <label>DISPLAY NAME</label>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        placeholder="Enter your display name"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>AVATAR URL</label>
                                    <input
                                        type="text"
                                        value={editAvatar}
                                        onChange={(e) => setEditAvatar(e.target.value)}
                                        placeholder="https://example.com/avatar.png"
                                    />
                                    <small>Provide a valid image URL for your profile picture.</small>
                                </div>
                                <div className="form-group">
                                    <label>ABOUT ME</label>
                                    <textarea
                                        value={editAboutMe}
                                        onChange={(e) => setEditAboutMe(e.target.value.substring(0, 190))}
                                        placeholder="Tell others about yourself..."
                                        rows={3}
                                        style={{ resize: 'vertical', minHeight: '60px' }}
                                    />
                                    <small style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>This will be visible to others who view your profile.</span>
                                        <span>{editAboutMe.length}/190</span>
                                    </small>
                                </div>

                                <div className="form-actions">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            setEditName(displayName);
                                            setEditAvatar(avatarUrl || '');
                                            setEditAboutMe(aboutMe);
                                        }}
                                        disabled={editName === displayName && editAvatar === (avatarUrl || '') && editAboutMe === aboutMe}
                                    >
                                        Reset
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={editName === displayName && editAvatar === (avatarUrl || '')}
                                    >
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {activeTab === 'voice' && (
                        <div className="settings-section">
                            <h3 className="settings-subsection-title">VOICE PROCESSING</h3>

                            <div className="form-group" style={{ marginBottom: '24px' }}>
                                <label>MICROPHONE</label>
                                <select
                                    value={audioSettings.deviceId || ''}
                                    onChange={(e) => updateAudioSettings({ deviceId: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: 'var(--discord-bg-tertiary)',
                                        border: '1px solid rgba(0,0,0,0.3)',
                                        borderRadius: 'var(--radius-xs)',
                                        color: 'var(--discord-text-normal)',
                                        outline: 'none',
                                        marginTop: '8px'
                                    }}
                                >
                                    {audioDevices.length === 0 ? <option value="">Default Microphone</option> : null}
                                    {audioDevices.map((device, index) => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Microphone ${index + 1}`}
                                        </option>
                                    ))}
                                </select>
                                <small style={{ display: 'block', marginTop: '8px', color: 'var(--discord-text-muted)' }}>
                                    Changes will apply the next time you join a voice channel or call.
                                </small>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Noise Suppression</h4>
                                    <p>Filters out persistent background noise (fans, keyboards) for clearer audio.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={audioSettings.noiseSuppression}
                                        onChange={(e) => updateAudioSettings({ noiseSuppression: e.target.checked })}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Echo Cancellation</h4>
                                    <p>Prevents your microphone from picking up audio playing from your speakers.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={audioSettings.echoCancellation}
                                        onChange={(e) => updateAudioSettings({ echoCancellation: e.target.checked })}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Auto Gain Control</h4>
                                    <p>Automatically reduces your volume if you speak too loudly and boosts it if you are too quiet.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={audioSettings.autoGainControl}
                                        onChange={(e) => updateAudioSettings({ autoGainControl: e.target.checked })}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">INPUT MODE</h3>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Push to Talk</h4>
                                    <p>Hold a key to transmit voice instead of always-on microphone.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={pttEnabled}
                                        onChange={(e) => setPttEnabled(e.target.checked)}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            {pttEnabled && (
                                <div className="form-group" style={{ marginTop: '12px' }}>
                                    <label>PTT KEY</label>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ width: '100%', textAlign: 'left', fontFamily: 'monospace' }}
                                        onClick={() => {
                                            const handler = (e: KeyboardEvent) => {
                                                e.preventDefault();
                                                setPttKey(e.code);
                                                window.removeEventListener('keydown', handler);
                                            };
                                            window.addEventListener('keydown', handler);
                                        }}
                                    >
                                        {pttKey} — Click to change
                                    </button>
                                    <small>Click the button above, then press any key to set it as your PTT key.</small>
                                </div>
                            )}

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">CONNECTION QUALITY</h3>
                            {connections.length === 0 ? (
                                <p style={{ color: 'var(--discord-text-muted)', fontSize: '14px' }}>No active connections</p>
                            ) : (
                                connections.map(conn => {
                                    const lat = peerLatencies[conn.peer];
                                    const color = lat === undefined ? 'var(--discord-text-muted)' : lat < 100 ? '#3ba55d' : lat < 250 ? '#faa81a' : '#ed4245';
                                    return (
                                        <div key={conn.peer} className="info-row" style={{ padding: '6px 0' }}>
                                            <span style={{ fontSize: '13px', color: 'var(--discord-text-normal)' }}>{conn.peer.substring(0, 12)}...</span>
                                            <span style={{ fontSize: '13px', color, fontFamily: 'monospace', fontWeight: 600 }}>
                                                {lat !== undefined ? `${lat}ms` : '—'}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}

                    {activeTab === 'privacy' && (
                        <div className="settings-section">
                            <h3 className="settings-subsection-title">KILL SWITCH</h3>
                            <div className="form-group">
                                <label>KEYWORD</label>
                                <input
                                    type="text"
                                    value={editKeyword}
                                    onChange={(e) => setEditKeyword(e.target.value)}
                                    placeholder="papatya"
                                />
                                <small>When this keyword is typed as a message, all messages in the active chat will be deleted on both sides. The keyword itself will not be sent.</small>
                            </div>
                            <div className="form-actions">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setEditKeyword(killSwitchKeyword)}
                                    disabled={editKeyword === killSwitchKeyword}
                                >
                                    Reset
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={editKeyword === killSwitchKeyword}
                                    onClick={() => setKillSwitchKeyword(editKeyword)}
                                >
                                    Save Changes
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'account' && (
                        <div className="settings-section">
                            <div className="setting-item">
                                <div className="setting-info">
                                    <h4>Export Account Backup</h4>
                                    <p>Download a JSON file containing your identity, server list, and friends. You can use this to restore your account on another device.</p>
                                </div>
                                <button className="btn btn-primary" onClick={handleExportAccount}>
                                    <Download size={18} style={{ marginRight: 8 }} /> Export Data
                                </button>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-item">
                                <div className="setting-info">
                                    <h4>Import Backup</h4>
                                    <p>Restore your account from a previously exported JSON backup file. This must be done from the Welcome Screen during login.</p>
                                </div>
                                <button className="btn btn-secondary" disabled title="Import from the Welcome Screen">
                                    <Upload size={18} style={{ marginRight: 8 }} /> Import Data
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'appearance' && (
                        <div className="settings-section">
                            <h3 className="settings-subsection-title">THEME</h3>
                            <div className="theme-selector">
                                {[
                                    { id: 'dark', label: 'Dark', bg: '#313338', accent: '#5865f2' },
                                    { id: 'light', label: 'Light', bg: '#f2f3f5', accent: '#5865f2' },
                                    { id: 'midnight', label: 'Midnight', bg: '#111214', accent: '#5865f2' },
                                    { id: 'crimson', label: 'Crimson', bg: '#1c1214', accent: '#e03e3e' },
                                    { id: 'amoled', label: 'AMOLED', bg: '#000000', accent: '#5865f2' },
                                    { id: 'matrix', label: 'Matrix', bg: '#0d1117', accent: '#39d353' },
                                    { id: 'purple', label: 'Purple', bg: '#16131d', accent: '#9b7dbd' }
                                ].map(t => (
                                    <button
                                        key={t.id}
                                        className={`theme-option ${theme === t.id ? 'active' : ''}`}
                                        onClick={() => applyTheme(t.id)}
                                    >
                                        <div className="theme-preview">
                                            <div className="theme-preview-bg" style={{ backgroundColor: t.bg }} />
                                            <div className="theme-preview-accent" style={{ backgroundColor: t.accent }} />
                                        </div>
                                        <span>{t.label}</span>
                                        {theme === t.id && <div className="theme-check">✓</div>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};
