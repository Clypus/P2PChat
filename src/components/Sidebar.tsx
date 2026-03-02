import React, { useState, useRef, useCallback } from 'react';
import { usePeer } from '../context/PeerContext';
import { Copy, UserPlus, Users, Hash, Volume2, Settings, Mic, MicOff, Headphones, PlusCircle, PhoneOff } from 'lucide-react';
import { GroupDMModal } from './GroupDMModal';
import './Sidebar.css';

export const Sidebar: React.FC<{ onOpenSettings?: () => void, closeMobileMenu?: () => void }> = ({ onOpenSettings, closeMobileMenu }) => {
    const { peerId, displayName, connectToPeer, connections, serverMembers, peerNames, knownPeers, peerAvatars, avatarUrl, error, activeServer, activeChannel, setActiveChannel, activeVoiceChannel, setActiveVoiceChannel, startCall, endCall, activeDM, setActiveDM, isMuted, isDeafened, toggleMute, toggleDeafen, peerVoiceStates, groupDMs, createGroupDM, endAllCalls } = usePeer();
    const [targetId, setTargetId] = useState('');
    const [copied, setCopied] = useState(false);
    const [width, setWidth] = useState(240);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const isResizing = useRef(false);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(200, Math.min(e.clientX, 400));
        setWidth(newWidth);
    }, []);

    const handleMouseUp = useCallback(() => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'default';
    }, [handleMouseMove]);

    const startResizing = (e: React.MouseEvent) => {
        e.preventDefault();
        isResizing.current = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
    };

    const handleCopyId = () => {
        navigator.clipboard.writeText(peerId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        if (targetId.trim()) {
            connectToPeer(targetId.trim());
            setTargetId('');
        }
    };

    const handleCreateGroup = () => {
        setShowGroupModal(true);
    };

    return (
        <aside className="sidebar" style={{ width: `${width}px` }}>
            <div className="sidebar-resize-handle right" onMouseDown={startResizing} />
            <div className="sidebar-header">
                <h2>{activeServer ? activeServer.name : 'P2P Chat'}</h2>
            </div>

            <div className="sidebar-content">
                {activeServer ? (
                    <div className="section identity-section">
                        <label className="section-label">Server Invite Code</label>
                        <div className="id-card" onClick={() => {
                            navigator.clipboard.writeText(activeServer.id);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        }} title="Click to copy Invite Code">
                            <span className="peer-id-text">{activeServer.id}</span>
                            <Copy size={16} className={`copy-icon ${copied ? 'copied' : ''}`} />
                        </div>
                        {copied && <span className="copy-tooltip fade-in">Copied Invite Code!</span>}
                        <p style={{ fontSize: '12px', color: 'var(--discord-text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                            Share this ID with friends so they can join this server. They can click the + button and paste it.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* User Identity Section */}
                        <div className="section identity-section">
                            <label className="section-label">Your Peer ID</label>
                            <div className="id-card" onClick={handleCopyId} title="Click to copy">
                                <span className="peer-id-text">{peerId || 'Loading...'}</span>
                                <Copy size={16} className={`copy-icon ${copied ? 'copied' : ''}`} />
                            </div>
                            {copied && <span className="copy-tooltip fade-in">Copied to clipboard!</span>}
                        </div>

                        {/* Connect Section */}
                        <div className="section connect-section">
                            <label className="section-label">Connect to Friend</label>
                            <form onSubmit={handleConnect} className="connect-form">
                                <input
                                    type="text"
                                    placeholder="Paste Friend's ID here"
                                    value={targetId}
                                    onChange={(e) => setTargetId(e.target.value)}
                                    className="connect-input"
                                />
                                <button type="submit" className="btn btn-primary connect-btn" disabled={!targetId.trim() || !peerId}>
                                    <UserPlus size={16} />
                                    Connect
                                </button>
                            </form>
                            {error && <div className="error-message fade-in">{error}</div>}
                        </div>
                    </>
                )}

                {/* Active Connections List */}
                <div className="section connections-section">
                    {activeServer ? (
                        <>
                            <label className="section-label flex-between">
                                <span>Server Members</span>
                                <Users size={16} />
                            </label>
                            <div className="channel-list">
                                <div
                                    className={`channel-item ${activeChannel === 'general' ? 'active' : ''}`}
                                    onClick={() => { setActiveChannel('general'); if (closeMobileMenu) closeMobileMenu(); }}
                                >
                                    <Hash size={18} className="channel-icon" />
                                    <span className="channel-name">general</span>
                                </div>
                                <div
                                    className={`channel-item ${activeChannel === 'gaming' ? 'active' : ''}`}
                                    onClick={() => { setActiveChannel('gaming'); if (closeMobileMenu) closeMobileMenu(); }}
                                >
                                    <Hash size={18} className="channel-icon" />
                                    <span className="channel-name">gaming</span>
                                </div>

                                <label className="section-label" style={{ marginTop: '16px', marginBottom: '4px' }}>Voice Channels</label>
                                <div
                                    className={`channel-item voice ${activeChannel === 'Voice Lounge' || activeVoiceChannel === 'voice-lounge' ? 'active' : ''}`}
                                    onClick={() => {
                                        setActiveChannel('Voice Lounge');
                                        if (activeVoiceChannel !== 'voice-lounge') {
                                            setActiveVoiceChannel('voice-lounge');
                                            // Only call server members, not all connections
                                            connections
                                                .filter(conn => serverMembers.has(conn.peer))
                                                .forEach(conn => startCall(conn.peer, false));
                                        }
                                        if (closeMobileMenu) closeMobileMenu();
                                    }}
                                >
                                    <Volume2 size={18} className="channel-icon" />
                                    <span className="channel-name">Voice Lounge</span>
                                </div>
                                {activeVoiceChannel && (
                                    <div className="voice-connected-panel" style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--discord-bg-hover)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--discord-green)', fontSize: '13px', fontWeight: 500 }}>
                                            <Volume2 size={14} />
                                            <span>Voice Connected</span>
                                        </div>
                                        <button
                                            className="action-btn danger"
                                            title="Disconnect"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveVoiceChannel(null);
                                                setActiveChannel('general');
                                                endAllCalls();
                                            }}
                                        >
                                            <PhoneOff size={16} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="sidebar-section">
                            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 4px 16px' }}>
                                <label className="section-label" style={{ margin: 0 }}>DIRECT MESSAGES</label>
                                <button className="action-btn" style={{ padding: 2 }} title="Create Group DM" onClick={handleCreateGroup}>
                                    <PlusCircle size={14} />
                                </button>
                            </div>
                            <ul className="connections-list">
                                {/* Group DMs */}
                                {Object.values(groupDMs).map(group => (
                                    <li key={group.id} className={`connection-item ${(!activeServer && activeDM === group.id) ? 'active' : ''}`} onClick={() => { setActiveDM(group.id); if (closeMobileMenu) closeMobileMenu(); }}>
                                        <div className="avatar placeholder" style={{ backgroundColor: 'var(--discord-green)' }}>
                                            <Users size={16} color="white" />
                                        </div>
                                        <div className="connection-info">
                                            <span className="connection-name">{group.name}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span className="connection-subtext" style={{ marginRight: 'auto' }}>{group.members.length} Members</span>
                                            </div>
                                        </div>
                                    </li>
                                ))}

                                {/* 1-on-1 DMs */}
                                {Object.keys(knownPeers).length === 0 && Object.keys(groupDMs).length === 0 ? (
                                    <li className="empty-state">No known friends yet</li>
                                ) : (
                                    Object.entries(knownPeers).map(([friendId, friendName]) => {
                                        const isOnline = connections.some(c => c.peer === friendId);
                                        return (
                                            <li
                                                key={friendId}
                                                className={`connection-item ${(!activeServer && activeDM === friendId) ? 'active' : ''}`}
                                                onClick={() => {
                                                    setActiveDM(friendId);
                                                    if (!isOnline) connectToPeer(friendId);
                                                    if (closeMobileMenu) closeMobileMenu();
                                                }}
                                                title={isOnline ? "Online" : "Click to connect"}
                                            >
                                                <div className={`avatar ${peerAvatars[friendId] ? '' : 'placeholder'} ${!isOnline ? 'offline' : ''}`}>
                                                    {peerAvatars[friendId] ? (
                                                        <img src={peerAvatars[friendId]} alt="" className="avatar-img" />
                                                    ) : (
                                                        friendName.substring(0, 2).toUpperCase()
                                                    )}
                                                </div>
                                                <div className="connection-info">
                                                    <span className="connection-name">{friendName}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span className="connection-subtext" style={{ marginRight: 'auto' }}>{isOnline ? 'Online' : 'Offline'}</span>
                                                        {peerVoiceStates[friendId]?.muted && <span title="Muted" style={{ display: 'flex' }}><MicOff size={12} color="var(--discord-red)" /></span>}
                                                        {peerVoiceStates[friendId]?.deafened && <span title="Deafened" style={{ display: 'flex' }}><Headphones size={12} color="var(--discord-red)" /></span>}
                                                    </div>
                                                </div>
                                                <div className={`status-indicator ${isOnline ? 'online' : ''}`}></div>
                                            </li>
                                        );
                                    })
                                )}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            {/* User Area Footer Like Discord */}
            <div className="sidebar-footer">
                <div className="current-user-profile">
                    <div className={`avatar ${avatarUrl ? '' : 'placeholder'}`}>
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="" className="avatar-img" />
                        ) : (
                            displayName.substring(0, 2).toUpperCase()
                        )}
                    </div>
                    <div className="connection-info" style={{ flex: 1, overflow: 'hidden' }}>
                        <span className="connection-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                        <span className="connection-subtext">Online</span>
                    </div>
                    <div className="profile-actions">
                        <button className="action-btn" title={isMuted || isDeafened ? "Unmute" : "Mute"} onClick={toggleMute}>
                            {isMuted || isDeafened ? <MicOff size={18} color="var(--discord-red)" /> : <Mic size={18} />}
                        </button>
                        <button className="action-btn" title={isDeafened ? "Undeafen" : "Deafen"} onClick={toggleDeafen}>
                            <Headphones size={18} color={isDeafened ? "var(--discord-red)" : "currentColor"} />
                        </button>
                        <button className="action-btn" title="User Settings" onClick={() => onOpenSettings && onOpenSettings()}>
                            <Settings size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Resizer Handle */}
            <div className="sidebar-resizer" onMouseDown={startResizing} />

            {showGroupModal && <GroupDMModal onClose={() => setShowGroupModal(false)} />}
        </aside>
    );
};
