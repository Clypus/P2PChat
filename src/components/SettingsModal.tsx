import React, { useState, useEffect } from 'react';
import { usePeer, Badge, KeybindAction, KEYBIND_LABELS, DEFAULT_KEYBINDS, describeKeyEvent, prettyKeybind, MAX_BADGES } from '../context/PeerContext';
import { X, User, Shield, HardDrive, Download, Upload, Mic, Palette, Bell, Keyboard, RefreshCw, Award, Trash2, MonitorUp, Play, Volume2, Network, Clock } from 'lucide-react';
import {
    getNotificationPrefs, updateNotificationPrefs, NotificationPrefs,
    SOUND_PACKS, SoundPackId, SoundEvent, getSoundPack, setSoundPack, previewSound,
} from '../utils/sounds';
import {
    applyTheme, readCustomTheme, saveCustomTheme, sanitizeCustomTheme,
    CUSTOM_THEME_FIELDS, CUSTOM_THEME_ID, DEFAULT_CUSTOM_THEME, THEME_KEY, CustomTheme,
} from '../utils/theme';
import type { UpdaterState } from '../electron';
import { IceConfig, OPEN_RELAY_PRESET, DEFAULT_ICE_CONFIG } from '../utils/ice';
import './SettingsModal.css';

const TENOR_KEY_STORAGE = 'p2p_chat_tenor_key';
const CLOSE_TO_TRAY_KEY = 'p2p_chat_close_to_tray';

const BADGE_PRESETS: { icon: string; label: string; color: string }[] = [
    { icon: '\u2b50', label: 'Founder', color: '#f0b232' },
    { icon: '\ud83d\udee1\ufe0f', label: 'Moderator', color: '#3498db' },
    { icon: '\ud83d\udc1b', label: 'Bug Hunter', color: '#23a55a' },
    { icon: '\ud83c\udfae', label: 'Gamer', color: '#9b7dbd' },
    { icon: '\ud83d\udc9c', label: 'Supporter', color: '#e91e63' },
];

interface SettingsModalProps {
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const {
        peerId, displayName, setDisplayName, avatarUrl, setAvatarUrl, audioSettings, updateAudioSettings,
        killSwitchKeyword, setKillSwitchKeyword, aboutMe, setAboutMe, pttEnabled, setPttEnabled, pttKey, setPttKey,
        peerLatencies, connections, micLevel, clearAllHistory, localStream,
        badges, setBadges, keybinds, setKeybind, resetKeybinds, globalKeybinds, setGlobalKeybinds, globalKeybindIssues,
        iceConfig, applyIceConfig, idleMinutes, setIdleMinutes,
    } = usePeer();

    const [editName, setEditName] = useState(displayName);
    const [editAvatar, setEditAvatar] = useState(avatarUrl || '');
    const [activeTab, setActiveTab] = useState<'profile' | 'voice' | 'notifications' | 'keybinds' | 'privacy' | 'account' | 'appearance'>('profile');
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
    const [editKeyword, setEditKeyword] = useState(killSwitchKeyword);
    const [editAboutMe, setEditAboutMe] = useState(aboutMe);
    const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
    const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(() => getNotificationPrefs());
    const [soundPack, setSoundPackState] = useState<SoundPackId>(() => getSoundPack());

    const chooseSoundPack = (id: SoundPackId) => {
        setSoundPack(id);
        setSoundPackState(id);
        // Play the new pack straight away so the choice is audible, not abstract.
        previewSound('message', id);
    };

    const PREVIEWABLE: { event: SoundEvent; label: string }[] = [
        { event: 'message', label: 'Message' },
        { event: 'ring', label: 'Incoming call' },
        { event: 'connect', label: 'Call connected' },
        { event: 'disconnect', label: 'Call ended' },
        { event: 'join', label: 'Someone joined' },
        { event: 'leave', label: 'Someone left' },
    ];
    const [customTheme, setCustomTheme] = useState<CustomTheme>(() => readCustomTheme());
    const [tenorKey, setTenorKey] = useState(() => localStorage.getItem(TENOR_KEY_STORAGE) || '');
    const [capturingBind, setCapturingBind] = useState<KeybindAction | null>(null);
    const [badgeDraft, setBadgeDraft] = useState({ icon: '\u2b50', label: '', color: '#5865f2' });
    const [closeToTray, setCloseToTray] = useState(() => localStorage.getItem(CLOSE_TO_TRAY_KEY) !== 'false');
    // Edited as a draft: every keystroke would otherwise tear down and rebuild
    // the peer connection.
    const [iceDraft, setIceDraft] = useState<IceConfig>(iceConfig);
    const iceDirty = JSON.stringify(iceDraft) !== JSON.stringify(iceConfig);

    const [appVersion, setAppVersion] = useState('');
    const [updateState, setUpdateState] = useState<UpdaterState | null>(null);

    useEffect(() => {
        window.electronAPI?.getAppVersion?.().then(setAppVersion).catch(() => { });
        const off = window.electronAPI?.updater?.onStatus?.(setUpdateState);
        return () => { if (off) off(); };
    }, []);

    // Capture the next key combination and store it against the pending action.
    useEffect(() => {
        if (!capturingBind) return;
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') { setCapturingBind(null); return; }
            const bind = describeKeyEvent(e);
            if (!bind) return; // a bare modifier — keep waiting for a real key
            setKeybind(capturingBind, bind);
            setCapturingBind(null);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [capturingBind, setKeybind]);

    const updateCustomThemeField = (key: keyof CustomTheme, value: string) => {
        const next = sanitizeCustomTheme({ ...customTheme, [key]: value });
        setCustomTheme(next);
        saveCustomTheme(next);
        if (theme === CUSTOM_THEME_ID) applyTheme(CUSTOM_THEME_ID, next);
    };

    const addBadge = () => {
        const label = badgeDraft.label.trim();
        if (!label && !badgeDraft.icon) return;
        if (badges.length >= MAX_BADGES) return;
        setBadges([...badges, { id: Math.random().toString(36).slice(2, 10), ...badgeDraft, label }]);
        setBadgeDraft({ icon: '\u2b50', label: '', color: '#5865f2' });
    };

    const removeBadge = (id: string) => setBadges(badges.filter((b: Badge) => b.id !== id));

    const toggleNotifPref = (key: keyof NotificationPrefs) => {
        const next = updateNotificationPrefs({ [key]: !notifPrefs[key] });
        setNotifPrefs({ ...next });
        if (key === 'desktopNotifications' && next.desktopNotifications && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    };

    const chooseTheme = (t: string) => {
        setTheme(t);
        localStorage.setItem(THEME_KEY, t);
        applyTheme(t, customTheme);
    };

    useEffect(() => {
        if (activeTab === 'voice') {
            navigator.mediaDevices.enumerateDevices().then(devices => {
                setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
                setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
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
        const readJson = (key: string, fallback: unknown) => {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            try { return JSON.parse(raw); } catch { return fallback; }
        };

        const backup = {
            version: 3,
            identity: readJson('p2p_chat_identity', null),
            servers: readJson('p2p_chat_servers', []),
            // v3: known peer names and the friends list live under separate keys
            friends: readJson('p2p_chat_known_peers', readJson('p2p_chat_friends', {})),
            friendsList: readJson('p2p_chat_friends_list', []),
            serverChannels: readJson('p2p_chat_server_channels', {})
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
                        className={`settings-nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
                        onClick={() => setActiveTab('notifications')}
                    >
                        <Bell size={18} /> Notifications
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'keybinds' ? 'active' : ''}`}
                        onClick={() => setActiveTab('keybinds')}
                    >
                        <Keyboard size={18} /> Keybinds
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'account' ? 'active' : ''}`}
                        onClick={() => setActiveTab('account')}
                    >
                        <HardDrive size={18} /> Backup & Updates
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
                    <h2>{activeTab === 'profile' ? 'My Account' : activeTab === 'voice' ? 'Voice & Video' : activeTab === 'notifications' ? 'Notifications' : activeTab === 'keybinds' ? 'Keybinds' : activeTab === 'privacy' ? 'Privacy & Safety' : activeTab === 'appearance' ? 'Appearance' : 'Backup & Updates'}</h2>
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
                                                {(editName || '?').substring(0, 2).toUpperCase()}
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

                                <div className="settings-divider"></div>

                                <h3 className="settings-subsection-title"><Award size={14} /> BADGES</h3>
                                <p className="settings-hint">
                                    Badges sit next to your name in chat and on your profile. They are cosmetic and
                                    shared with everyone you talk to. Up to {MAX_BADGES}.
                                </p>

                                <div className="badge-editor-list">
                                    {badges.length === 0 && <span className="badge-editor-empty">No badges yet.</span>}
                                    {badges.map((b: Badge) => (
                                        <span key={b.id} className="user-badge editable"
                                            style={{ backgroundColor: b.color + '22', color: b.color, borderColor: b.color + '55' }}>
                                            {b.icon && <span className="user-badge-icon">{b.icon}</span>}
                                            {b.label && <span className="user-badge-label">{b.label}</span>}
                                            <button type="button" className="badge-remove" title="Remove badge"
                                                onClick={() => removeBadge(b.id)}>
                                                <Trash2 size={11} />
                                            </button>
                                        </span>
                                    ))}
                                </div>

                                <div className="badge-presets">
                                    {BADGE_PRESETS.map(preset => (
                                        <button
                                            key={preset.label}
                                            type="button"
                                            className="badge-preset"
                                            style={{ borderColor: preset.color + '66', color: preset.color }}
                                            disabled={badges.length >= MAX_BADGES}
                                            onClick={() => setBadgeDraft({ ...preset })}
                                            title={`Use the ${preset.label} preset`}
                                        >
                                            {preset.icon} {preset.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="badge-draft-row">
                                    <input
                                        className="badge-draft-icon"
                                        value={badgeDraft.icon}
                                        maxLength={4}
                                        onChange={(e) => setBadgeDraft(d => ({ ...d, icon: e.target.value }))}
                                        placeholder="\u2b50"
                                        title="Emoji"
                                    />
                                    <input
                                        className="badge-draft-label"
                                        value={badgeDraft.label}
                                        maxLength={20}
                                        onChange={(e) => setBadgeDraft(d => ({ ...d, label: e.target.value }))}
                                        placeholder="Badge name"
                                    />
                                    <input
                                        type="color"
                                        className="badge-draft-color"
                                        value={badgeDraft.color}
                                        onChange={(e) => setBadgeDraft(d => ({ ...d, color: e.target.value }))}
                                        title="Badge colour"
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={addBadge}
                                        disabled={badges.length >= MAX_BADGES || (!badgeDraft.label.trim() && !badgeDraft.icon)}
                                    >
                                        Add
                                    </button>
                                </div>

                                <div className="settings-divider"></div>

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
                                        disabled={editName === displayName && editAvatar === (avatarUrl || '') && editAboutMe === aboutMe}
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

                            <h3 className="settings-subsection-title">VIDEO</h3>

                            <div className="form-group" style={{ marginBottom: '24px' }}>
                                <label>CAMERA</label>
                                <select
                                    value={audioSettings.videoDeviceId || ''}
                                    onChange={(e) => updateAudioSettings({ videoDeviceId: e.target.value })}
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
                                    {videoDevices.length === 0 ? <option value="">Default Camera</option> : null}
                                    {videoDevices.map((device, index) => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Camera ${index + 1}`}
                                        </option>
                                    ))}
                                </select>
                                <small style={{ display: 'block', marginTop: '8px', color: 'var(--discord-text-muted)' }}>
                                    Select which camera to use for video calls.
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

                            <h3 className="settings-subsection-title">INPUT SENSITIVITY</h3>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Automatic Input Sensitivity</h4>
                                    <p>Let the app decide when you are speaking instead of using a fixed threshold.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={audioSettings.inputSensitivity === -1}
                                        onChange={(e) => updateAudioSettings({ inputSensitivity: e.target.checked ? -1 : 50 })}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>
                            {audioSettings.inputSensitivity >= 0 && (
                                <div style={{ marginTop: '12px' }}>
                                    <div style={{ position: 'relative', height: '8px', borderRadius: '4px', background: 'linear-gradient(to right, #3ba55d 0%, #3ba55d 30%, #faa81a 60%, #ed4245 100%)', overflow: 'hidden' }}>
                                        <div style={{
                                            position: 'absolute',
                                            left: `${audioSettings.inputSensitivity}%`,
                                            top: '-4px',
                                            width: '16px',
                                            height: '16px',
                                            borderRadius: '50%',
                                            background: 'white',
                                            border: '2px solid var(--discord-blurple)',
                                            transform: 'translateX(-50%)',
                                            cursor: 'pointer',
                                            zIndex: 2
                                        }} />
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={audioSettings.inputSensitivity}
                                        onChange={(e) => updateAudioSettings({ inputSensitivity: Number(e.target.value) })}
                                        style={{ width: '100%', marginTop: '-14px', opacity: 0, cursor: 'pointer', height: '20px', position: 'relative', zIndex: 3 }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--discord-text-muted)', marginTop: '-4px' }}>
                                        <span>Sensitive</span>
                                        <span>Threshold: {audioSettings.inputSensitivity}%</span>
                                        <span>Strict</span>
                                    </div>
                                </div>
                            )}

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">VOLUME</h3>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--discord-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                                    Output Volume — {audioSettings.masterVolume ?? 100}%
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="200"
                                    value={audioSettings.masterVolume ?? 100}
                                    onChange={(e) => updateAudioSettings({ masterVolume: Number(e.target.value) })}
                                    style={{ width: '100%' }}
                                />
                                <small style={{ color: 'var(--discord-text-muted)' }}>
                                    Master volume for all incoming audio. 100% is normal, up to 200% boost.
                                </small>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--discord-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                                    Input Volume (Mic Boost) — {audioSettings.inputVolume ?? 100}%
                                </label>
                                <input
                                    type="range"
                                    min="0"
                                    max="200"
                                    value={audioSettings.inputVolume ?? 100}
                                    onChange={(e) => updateAudioSettings({ inputVolume: Number(e.target.value) })}
                                    style={{ width: '100%' }}
                                />
                                <small style={{ color: 'var(--discord-text-muted)' }}>
                                    Boost or reduce your microphone before sending. Applies live during calls.
                                </small>
                            </div>

                            {/* Live mic level meter — only meaningful while a stream is active */}
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--discord-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                                    Mic Level
                                </label>
                                <div style={{ position: 'relative', height: '12px', borderRadius: '6px', background: 'var(--discord-bg-tertiary)', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${localStream ? Math.max(0, Math.min(100, micLevel)) : 0}%`,
                                        background: 'linear-gradient(to right, #3ba55d 0%, #3ba55d 60%, #faa81a 80%, #ed4245 100%)',
                                        transition: 'width 50ms linear',
                                    }} />
                                    {audioSettings.inputSensitivity >= 0 && (
                                        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${audioSettings.inputSensitivity}%`, width: '2px', background: 'white', boxShadow: '0 0 4px rgba(0,0,0,0.5)' }} />
                                    )}
                                </div>
                                <small style={{ color: 'var(--discord-text-muted)', display: 'block', marginTop: '4px' }}>
                                    {localStream ? 'Speak to see your input level. White line = noise gate threshold.' : 'Join a voice channel or call to see live input.'}
                                </small>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>High-Pass Filter</h4>
                                    <p>Removes low-frequency rumble (fans, mic stand bumps) below 85Hz. Speech sits above this range, so it stays clean.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={audioSettings.highPassFilter ?? true}
                                        onChange={(e) => updateAudioSettings({ highPassFilter: e.target.checked })}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title"><Network size={14} /> CONNECTIVITY</h3>
                            <p className="settings-hint">
                                Calls and messages normally travel straight between the two of you. On strict networks
                                that direct path does not exist and the connection quietly never completes. A TURN relay
                                forwards the traffic instead. Everything stays end-to-end encrypted; a relay moves bytes
                                it cannot read, but it does see both IP addresses.
                            </p>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Use a TURN Relay</h4>
                                    <p>Fallback path for peers that cannot reach each other directly.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={iceDraft.turnEnabled}
                                        onChange={(e) => setIceDraft(d => ({ ...d, turnEnabled: e.target.checked }))}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            {iceDraft.turnEnabled && (
                                <>
                                    <div className="form-group" style={{ marginTop: '12px' }}>
                                        <label>SERVER URLS</label>
                                        <textarea
                                            value={iceDraft.urls}
                                            onChange={(e) => setIceDraft(d => ({ ...d, urls: e.target.value }))}
                                            placeholder={'turn:example.com:3478'}
                                            rows={3}
                                            style={{ resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: '12px' }}
                                        />
                                        <small>One per line. Both turn: and turns: are accepted.</small>
                                    </div>
                                    <div className="form-group">
                                        <label>USERNAME</label>
                                        <input
                                            type="text"
                                            value={iceDraft.username}
                                            onChange={(e) => setIceDraft(d => ({ ...d, username: e.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>CREDENTIAL</label>
                                        <input
                                            type="password"
                                            value={iceDraft.credential}
                                            onChange={(e) => setIceDraft(d => ({ ...d, credential: e.target.value }))}
                                        />
                                    </div>
                                </>
                            )}

                            <div className="form-actions">
                                <button className="btn btn-secondary" onClick={() => setIceDraft({ ...OPEN_RELAY_PRESET })}>
                                    Use Free Public Relay
                                </button>
                                <button className="btn btn-secondary" onClick={() => setIceDraft({ ...DEFAULT_ICE_CONFIG })}>
                                    Clear
                                </button>
                                <button
                                    className="btn btn-primary"
                                    disabled={!iceDirty}
                                    onClick={() => applyIceConfig(iceDraft)}
                                >
                                    Save &amp; Reconnect
                                </button>
                            </div>
                            <small style={{ display: 'block', marginTop: '8px', color: 'var(--discord-text-muted)' }}>
                                Saving rebuilds the peer connection, so open calls drop and reconnect.
                            </small>

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title"><MonitorUp size={14} /> SCREEN SHARE</h3>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label>RESOLUTION</label>
                                <select
                                    className="settings-select"
                                    value={String(audioSettings.screenHeight ?? 1080)}
                                    onChange={(e) => updateAudioSettings({ screenHeight: Number(e.target.value) })}
                                >
                                    <option value="0">Source resolution (no limit)</option>
                                    <option value="720">720p</option>
                                    <option value="1080">1080p</option>
                                    <option value="1440">1440p</option>
                                    <option value="2160">2160p (4K)</option>
                                </select>
                                <small>Higher resolutions need more upload bandwidth. Applies to the next share.</small>
                            </div>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label>FRAME RATE</label>
                                <select
                                    className="settings-select"
                                    value={String(audioSettings.screenFps ?? 30)}
                                    onChange={(e) => updateAudioSettings({ screenFps: Number(e.target.value) })}
                                >
                                    <option value="15">15 FPS — slides and documents</option>
                                    <option value="30">30 FPS — balanced</option>
                                    <option value="60">60 FPS — games and video</option>
                                </select>
                                <small>60 FPS at 1440p or above can saturate a typical upload link.</small>
                            </div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Share Desktop Audio</h4>
                                    <p>Mix the sound from the shared screen into your outgoing audio.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={audioSettings.screenAudioEnabled !== false}
                                        onChange={(e) => updateAudioSettings({ screenAudioEnabled: e.target.checked })}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            {audioSettings.screenAudioEnabled !== false && (
                                <div style={{ marginTop: '12px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--discord-text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                                        Desktop Audio Volume — {audioSettings.screenAudioVolume ?? 100}%
                                    </label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="200"
                                        value={audioSettings.screenAudioVolume ?? 100}
                                        onChange={(e) => updateAudioSettings({ screenAudioVolume: Number(e.target.value) })}
                                        style={{ width: '100%' }}
                                    />
                                    <small style={{ color: 'var(--discord-text-muted)' }}>
                                        Adjustable while sharing. There is a quick mute on the call controls too.
                                    </small>
                                </div>
                            )}

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

                    {activeTab === 'notifications' && (
                        <div className="settings-section">
                            <h3 className="settings-subsection-title"><Volume2 size={14} /> SOUND PACK</h3>
                            <p className="settings-hint">
                                Every sound is synthesised in the app, so nothing is downloaded. Pick a pack and
                                preview any of them below.
                            </p>

                            <div className="sound-pack-grid">
                                {SOUND_PACKS.map(pack => (
                                    <button
                                        key={pack.id}
                                        className={`sound-pack-option ${soundPack === pack.id ? 'active' : ''}`}
                                        onClick={() => chooseSoundPack(pack.id)}
                                    >
                                        <span className="sound-pack-name">
                                            {pack.label}
                                            {soundPack === pack.id && <span className="sound-pack-check">&#10003;</span>}
                                        </span>
                                        <span className="sound-pack-desc">{pack.description}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="sound-preview-row">
                                {PREVIEWABLE.map(item => (
                                    <button
                                        key={item.event}
                                        className="sound-preview-btn"
                                        onClick={() => previewSound(item.event, soundPack)}
                                        title={`Preview: ${item.label}`}
                                    >
                                        <Play size={12} /> {item.label}
                                    </button>
                                ))}
                            </div>

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">SOUNDS</h3>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Message Sounds</h4>
                                    <p>Play a ping when a new message arrives.</p>
                                </div>
                                <label className="setting-switch">
                                    <input type="checkbox" checked={notifPrefs.messageSounds} onChange={() => toggleNotifPref('messageSounds')} />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Call Sounds</h4>
                                    <p>Ringtone for incoming calls plus connect and disconnect tones.</p>
                                </div>
                                <label className="setting-switch">
                                    <input type="checkbox" checked={notifPrefs.callSounds} onChange={() => toggleNotifPref('callSounds')} />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Join / Leave Sounds</h4>
                                    <p>Short tones when someone joins or leaves a voice channel.</p>
                                </div>
                                <label className="setting-switch">
                                    <input type="checkbox" checked={notifPrefs.joinLeaveSounds} onChange={() => toggleNotifPref('joinLeaveSounds')} />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">DESKTOP</h3>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Desktop Notifications</h4>
                                    <p>Show a system notification for new messages while the app is in the background.</p>
                                </div>
                                <label className="setting-switch">
                                    <input type="checkbox" checked={notifPrefs.desktopNotifications} onChange={() => toggleNotifPref('desktopNotifications')} />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-item">
                                <div className="setting-info">
                                    <h4>Preview</h4>
                                    <p>Setting your status to Do Not Disturb silences all sounds and notifications regardless of these switches.</p>
                                </div>
                                <button className="btn btn-secondary" onClick={() => previewSound('message', soundPack)}>
                                    Play Test Sound
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'keybinds' && (
                        <div className="settings-section">
                            <h3 className="settings-subsection-title">SHORTCUTS</h3>
                            <p className="settings-hint">
                                Click a shortcut, then press the combination you want. Escape cancels. Combinations
                                that include Ctrl, Alt or Cmd keep working while you are typing in the message box.
                            </p>

                            <div className="keybind-list">
                                {(Object.keys(DEFAULT_KEYBINDS) as KeybindAction[]).map(action => (
                                    <div className="keybind-row" key={action}>
                                        <span className="keybind-label">{KEYBIND_LABELS[action]}</span>
                                        <button
                                            className={`keybind-btn ${capturingBind === action ? 'capturing' : ''}`}
                                            onClick={() => setCapturingBind(capturingBind === action ? null : action)}
                                        >
                                            {capturingBind === action ? 'Press any key…' : prettyKeybind(keybinds[action])}
                                        </button>
                                        <button
                                            className="keybind-clear"
                                            title="Clear this shortcut"
                                            onClick={() => setKeybind(action, '')}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Work While the App Is in the Background</h4>
                                    <p>
                                        Register the shortcuts with the operating system so they fire while you are in a
                                        game or another window. Push to talk is not included, because the system hotkey
                                        API reports key presses but never releases.
                                    </p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={globalKeybinds}
                                        disabled={!window.electronAPI?.shortcuts}
                                        onChange={(e) => setGlobalKeybinds(e.target.checked)}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            {globalKeybinds && globalKeybindIssues.length > 0 && (
                                <p className="keybind-warning">
                                    Another application already owns{' '}
                                    {globalKeybindIssues.map(a => KEYBIND_LABELS[a]).join(', ')}. Pick a different
                                    combination for those, or they will only work while P2P Chat is focused.
                                </p>
                            )}

                            <div className="settings-divider"></div>

                            <div className="setting-item">
                                <div className="setting-info">
                                    <h4>Push to Talk</h4>
                                    <p>Push to talk has its own key, set under Voice &amp; Video. It is currently {pttEnabled ? `bound to ${prettyKeybind(pttKey)}` : 'disabled'}.</p>
                                </div>
                                <button className="btn btn-secondary" onClick={() => setActiveTab('voice')}>
                                    Open Voice Settings
                                </button>
                            </div>

                            <div className="settings-divider"></div>

                            <div className="setting-item">
                                <div className="setting-info">
                                    <h4>Restore Defaults</h4>
                                    <p>Put every shortcut back to its original combination.</p>
                                </div>
                                <button className="btn btn-secondary" onClick={resetKeybinds}>
                                    <RefreshCw size={16} style={{ marginRight: 6 }} /> Reset
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'privacy' && (
                        <div className="settings-section">
                            <h3 className="settings-subsection-title"><Clock size={14} /> PRESENCE</h3>
                            <div className="form-group">
                                <label>GO IDLE AFTER</label>
                                <select
                                    className="settings-select"
                                    value={String(idleMinutes)}
                                    onChange={(e) => setIdleMinutes(Number(e.target.value))}
                                >
                                    <option value="0">Never</option>
                                    <option value="5">5 minutes</option>
                                    <option value="10">10 minutes</option>
                                    <option value="20">20 minutes</option>
                                    <option value="30">30 minutes</option>
                                    <option value="60">1 hour</option>
                                </select>
                                <small>
                                    Only an Online status changes automatically, and it flips straight back when you
                                    move the mouse or type. Do Not Disturb and Invisible are never touched.
                                </small>
                            </div>

                            <div className="settings-divider"></div>

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

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">MESSAGE HISTORY</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <h4>Clear All Message History</h4>
                                    <p>Wipes every saved chat — all servers, DMs, group DMs — from this device only. Other peers keep their copies. Useful if older messages mixed across servers due to a previous bug.</p>
                                </div>
                                <button
                                    className="btn btn-secondary"
                                    style={{ background: 'var(--discord-red, #ed4245)', color: 'white' }}
                                    onClick={() => {
                                        if (window.confirm('Delete ALL local chat history? This cannot be undone.')) {
                                            clearAllHistory();
                                        }
                                    }}
                                >
                                    Clear History
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

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">WINDOW</h3>
                            <div className="setting-control-row">
                                <div className="setting-control-info">
                                    <h4>Close to Tray</h4>
                                    <p>Keep running in the notification area when the window is closed, so calls and chats stay connected. Quit from the tray icon.</p>
                                </div>
                                <label className="setting-switch">
                                    <input
                                        type="checkbox"
                                        checked={closeToTray}
                                        disabled={!window.electronAPI}
                                        onChange={(e) => {
                                            setCloseToTray(e.target.checked);
                                            try { localStorage.setItem(CLOSE_TO_TRAY_KEY, String(e.target.checked)); } catch { /* quota */ }
                                            window.electronAPI?.setCloseToTray?.(e.target.checked);
                                        }}
                                    />
                                    <span className="setting-slider"></span>
                                </label>
                            </div>

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title"><RefreshCw size={14} /> UPDATES</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <h4>Application Version</h4>
                                    <p>
                                        {appVersion ? `You are running version ${appVersion}.` : 'Version information is only available in the desktop app.'}
                                        {updateState?.state === 'none' && ' You are up to date.'}
                                        {updateState?.state === 'available' && ` Version ${updateState.version || ''} is available to download.`}
                                        {updateState?.state === 'downloading' && ` Downloading… ${updateState.percent ?? 0}%`}
                                        {updateState?.state === 'ready' && ' An update is downloaded and installs on restart.'}
                                        {updateState?.state === 'error' && ` Update check failed: ${updateState.message || 'unknown error'}`}
                                    </p>
                                </div>
                                {updateState?.state === 'ready' ? (
                                    <button className="btn btn-primary" onClick={() => window.electronAPI?.updater.install()}>
                                        Restart & Install
                                    </button>
                                ) : updateState?.state === 'available' ? (
                                    <button className="btn btn-primary" onClick={() => window.electronAPI?.updater.download()}>
                                        <Download size={18} style={{ marginRight: 8 }} /> Download
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-secondary"
                                        disabled={!window.electronAPI?.updater}
                                        onClick={() => window.electronAPI?.updater.check()}
                                    >
                                        Check for Updates
                                    </button>
                                )}
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
                                    { id: 'purple', label: 'Purple', bg: '#16131d', accent: '#9b7dbd' },
                                    { id: CUSTOM_THEME_ID, label: 'Custom', bg: customTheme.bgPrimary, accent: customTheme.accent }
                                ].map(t => (
                                    <button
                                        key={t.id}
                                        className={`theme-option ${theme === t.id ? 'active' : ''}`}
                                        onClick={() => chooseTheme(t.id)}
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

                            {theme === CUSTOM_THEME_ID && (
                                <>
                                    <div className="settings-divider"></div>
                                    <h3 className="settings-subsection-title">CUSTOM PALETTE</h3>
                                    <p className="settings-hint">
                                        Changes apply instantly. Hover and pressed states are derived from the accent
                                        colour, so you only pick one.
                                    </p>
                                    <div className="theme-field-grid">
                                        {CUSTOM_THEME_FIELDS.map(field => (
                                            <div className="theme-field" key={field.key}>
                                                <input
                                                    type="color"
                                                    value={customTheme[field.key]}
                                                    onChange={(e) => updateCustomThemeField(field.key, e.target.value)}
                                                    title={field.hint}
                                                />
                                                <div className="theme-field-text">
                                                    <span className="theme-field-label">{field.label}</span>
                                                    <span className="theme-field-hint">{field.hint}</span>
                                                </div>
                                                <code className="theme-field-value">{customTheme[field.key]}</code>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="form-actions">
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => {
                                                setCustomTheme({ ...DEFAULT_CUSTOM_THEME });
                                                saveCustomTheme({ ...DEFAULT_CUSTOM_THEME });
                                                applyTheme(CUSTOM_THEME_ID, DEFAULT_CUSTOM_THEME);
                                            }}
                                        >
                                            Reset Palette
                                        </button>
                                    </div>
                                </>
                            )}

                            <div className="settings-divider"></div>

                            <h3 className="settings-subsection-title">GIF SEARCH</h3>
                            <div className="form-group">
                                <label>TENOR API KEY (OPTIONAL)</label>
                                <input
                                    type="text"
                                    value={tenorKey}
                                    onChange={(e) => {
                                        setTenorKey(e.target.value);
                                        try { localStorage.setItem(TENOR_KEY_STORAGE, e.target.value.trim()); } catch { /* quota */ }
                                    }}
                                    placeholder="Paste a Tenor v2 key to enable GIF search"
                                />
                                <small>
                                    Without a key the GIF picker still works: paste any GIF link and it is kept in your
                                    recents. Get a free key from Google Cloud&apos;s Tenor API console.
                                </small>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};
