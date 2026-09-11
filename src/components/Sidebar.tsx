import React, { useState, useRef, useCallback } from 'react';
import { usePeer } from '../context/PeerContext';
import { Copy, UserPlus, Users, Hash, Volume2, Settings, Mic, MicOff, Headphones, PlusCircle, PhoneOff, X, Bell, BellOff, Pin } from 'lucide-react';
import { GroupDMModal } from './GroupDMModal';
import './Sidebar.css';

export const Sidebar: React.FC<{ onOpenSettings?: () => void, closeMobileMenu?: () => void }> = ({ onOpenSettings, closeMobileMenu }) => {
    const { peerId, displayName, connectToPeer, connections, serverMembers, peerNames, knownPeers, peerAvatars, avatarUrl, error, activeServer, activeChannel, setActiveChannel, activeVoiceChannel, joinVoiceChannel, leaveVoiceChannel, activeDM, setActiveDM, isMuted, isDeafened, toggleMute, toggleDeafen, peerVoiceStates, groupDMs, createGroupDM, endAllCalls, unreadCounts, lastMessages, clearUnread, userStatus, setUserStatus, peerStatuses, localStream, remoteStreams, peerVoiceChannels, peerLatencies, getServerChannels, addServerChannel, removeServerChannel, notificationsMuted, toggleNotificationsMuted, peerBadges, pinnedChats, togglePinChat } = usePeer();
    const [targetId, setTargetId] = useState('');
    const [copied, setCopied] = useState(false);
    const [width, setWidth] = useState(240);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [showStatusSelector, setShowStatusSelector] = useState(false);
    const [showAddChannel, setShowAddChannel] = useState(false);
    const [newChannelName, setNewChannelName] = useState('');
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
                        { }
                        <div className="section identity-section">
                            <label className="section-label">Your Peer ID</label>
                            <div className="id-card" onClick={handleCopyId} title="Click to copy">
                                <span className="peer-id-text">{peerId || 'Loading...'}</span>
                                <Copy size={16} className={`copy-icon ${copied ? 'copied' : ''}`} />
                            </div>
                            {copied && <span className="copy-tooltip fade-in">Copied to clipboard!</span>}
                        </div>

                        { }
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

                { }
                <div className="section connections-section">
                    {activeServer ? (
                        <>
                            <label className="section-label flex-between">
                                <span>Text Channels</span>
                                {activeServer.id === peerId && (
                                    <button
                                        className="action-btn"
                                        style={{ padding: 2 }}
                                        title="Create Channel"
                                        onClick={() => { setShowAddChannel(s => !s); setNewChannelName(''); }}
                                    >
                                        <PlusCircle size={14} />
                                    </button>
                                )}
                            </label>
                            {showAddChannel && (
                                <form
                                    className="add-channel-form"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (newChannelName.trim()) {
                                            addServerChannel(newChannelName);
                                            setNewChannelName('');
                                            setShowAddChannel(false);
                                        }
                                    }}
                                >
                                    <Hash size={14} />
                                    <input
                                        value={newChannelName}
                                        onChange={(e) => setNewChannelName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Escape') setShowAddChannel(false); }}
                                        placeholder="new-channel"
                                        maxLength={24}
                                        autoFocus
                                    />
                                </form>
                            )}
                            <div className="channel-list">
                                {getServerChannels(activeServer.id).map(ch => (
                                    <div
                                        key={ch}
                                        className={`channel-item ${activeChannel === ch ? 'active' : ''}`}
                                        onClick={() => { setActiveChannel(ch); if (closeMobileMenu) closeMobileMenu(); }}
                                    >
                                        <Hash size={18} className="channel-icon" />
                                        <span className="channel-name">{ch}</span>
                                        {activeServer.id === peerId && ch !== 'general' && (
                                            <button
                                                className="channel-delete-btn"
                                                title={`Delete #${ch}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm(`Delete #${ch}? Its messages stay in history but the channel disappears for all members.`)) {
                                                        removeServerChannel(ch);
                                                    }
                                                }}
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}

                                <label className="section-label" style={{ marginTop: '16px', marginBottom: '4px' }}>Voice Channels</label>
                                {(() => {
                                    // Server-scoped voice channel id so two servers can both have a "voice-lounge"
                                    const voiceChannelId = `${activeServer.id}:voice-lounge`;
                                    return (
                                <div
                                    className={`channel-item voice ${activeVoiceChannel === voiceChannelId ? 'active' : ''}`}
                                    onClick={() => {
                                        if (activeVoiceChannel !== voiceChannelId) {
                                            joinVoiceChannel(voiceChannelId);
                                        }
                                        if (closeMobileMenu) closeMobileMenu();
                                    }}
                                >
                                    <Volume2 size={18} className="channel-icon" />
                                    <span className="channel-name">Voice Lounge</span>
                                </div>
                                    );
                                })()}

                                {/* Voice channel participants — always shown so you can see who's already in before joining */}
                                {(() => {
                                    const voiceChannelId = `${activeServer.id}:voice-lounge`;
                                    const inVoice = new Set<string>();
                                    Object.entries(peerVoiceChannels).forEach(([pid, ch]) => {
                                        if (ch === voiceChannelId && serverMembers.has(pid)) inVoice.add(pid);
                                    });
                                    if (activeVoiceChannel === voiceChannelId) inVoice.add(peerId);
                                    if (inVoice.size === 0) return null;
                                    return (
                                        <div style={{ paddingLeft: '28px', marginBottom: '4px' }}>
                                            {inVoice.has(peerId) && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '4px', fontSize: '13px', color: 'var(--discord-text-normal)' }}>
                                                    {avatarUrl ? (
                                                        <img src={avatarUrl} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
                                                    ) : (
                                                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--discord-blurple)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', fontWeight: 600 }}>
                                                            {(displayName || 'U').substring(0, 1).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{displayName || 'You'}</span>
                                                    {isMuted && <MicOff size={12} color="var(--discord-red)" />}
                                                    {isDeafened && <Headphones size={12} color="var(--discord-red)" />}
                                                </div>
                                            )}
                                            {Array.from(inVoice).filter(pid => pid !== peerId).map(pid => {
                                                const name = peerNames[pid] || pid.substring(0, 8);
                                                const pAvatar = peerAvatars[pid];
                                                const vs = peerVoiceStates[pid];
                                                const lat = peerLatencies[pid];
                                                const latColor = lat === undefined ? 'var(--discord-text-muted)' : lat < 100 ? '#3ba55d' : lat < 250 ? '#faa81a' : '#ed4245';
                                                return (
                                                    <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '4px', fontSize: '13px', color: 'var(--discord-text-normal)' }}>
                                                        {pAvatar ? (
                                                            <img src={pAvatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
                                                        ) : (
                                                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--discord-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', fontWeight: 600 }}>
                                                                {name.substring(0, 1).toUpperCase()}
                                                            </div>
                                                        )}
                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
                                                        {lat !== undefined && <span title={`${lat}ms`} style={{ width: 6, height: 6, borderRadius: '50%', background: latColor, flexShrink: 0 }} />}
                                                        {vs?.muted && <MicOff size={12} color="var(--discord-red)" />}
                                                        {vs?.deafened && <Headphones size={12} color="var(--discord-red)" />}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}

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
                                                leaveVoiceChannel();
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
                                {Object.keys(knownPeers).length === 0 && Object.keys(groupDMs).length === 0 ? (
                                    <li className="empty-state">No known friends yet</li>
                                ) : (
                                    (() => {
                                        const sortedGroups = Object.values(groupDMs).sort((a, b) => {
                                            const aPinned = pinnedChats.includes(a.id) ? 1 : 0;
                                            const bPinned = pinnedChats.includes(b.id) ? 1 : 0;
                                            if (aPinned !== bPinned) return bPinned - aPinned;
                                            const aTs = lastMessages[a.id]?.timestamp || 0;
                                            const bTs = lastMessages[b.id]?.timestamp || 0;
                                            return bTs - aTs;
                                        });

                                        const sortedFriends = Object.entries(knownPeers).sort(([aId], [bId]) => {
                                            const aPinned = pinnedChats.includes(aId) ? 1 : 0;
                                            const bPinned = pinnedChats.includes(bId) ? 1 : 0;
                                            if (aPinned !== bPinned) return bPinned - aPinned;
                                            const aTs = lastMessages[aId]?.timestamp || 0;
                                            const bTs = lastMessages[bId]?.timestamp || 0;
                                            return bTs - aTs;
                                        });

                                        return (
                                            <>
                                                {sortedGroups.map(group => {
                                                    const groupUnread = unreadCounts[group.id] || 0;
                                                    const groupLastMsg = lastMessages[group.id];
                                                    const isPinned = pinnedChats.includes(group.id);
                                                    return (
                                                        <li key={group.id} className={`connection-item ${(!activeServer && activeDM === group.id) ? 'active' : ''}`} onClick={() => { setActiveDM(group.id); clearUnread(group.id); if (closeMobileMenu) closeMobileMenu(); }}>
                                                            <div className="avatar placeholder" style={{ backgroundColor: 'var(--discord-green)' }}>
                                                                <Users size={16} color="white" />
                                                            </div>
                                                            <div className="connection-info">
                                                                <span className="connection-name">
                                                                    {group.name}
                                                                    {isPinned && <Pin size={11} style={{ color: 'var(--discord-blurple)', marginLeft: 4 }} />}
                                                                </span>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    <span className="connection-subtext" style={{ marginRight: 'auto' }}>
                                                                        {groupLastMsg?.text ? groupLastMsg.text : `${group.members.length} Members`}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <button
                                                                className={`pin-toggle-btn ${isPinned ? 'pinned' : ''}`}
                                                                title={isPinned ? "Unpin chat" : "Pin chat to top"}
                                                                onClick={(e) => { e.stopPropagation(); togglePinChat(group.id); }}
                                                            >
                                                                <Pin size={12} />
                                                            </button>
                                                            {groupUnread > 0 && <span className="unread-badge">{groupUnread > 99 ? '99+' : groupUnread}</span>}
                                                        </li>
                                                    );
                                                })}

                                                {sortedFriends.map(([friendId, friendName]) => {
                                                    const isOnline = connections.some(c => c.peer === friendId);
                                                    const unread = unreadCounts[friendId] || 0;
                                                    const lastMsg = lastMessages[friendId];
                                                    const isPinned = pinnedChats.includes(friendId);
                                                    return (
                                                        <li
                                                            key={friendId}
                                                            className={`connection-item ${(!activeServer && activeDM === friendId) ? 'active' : ''}`}
                                                            onClick={() => {
                                                                setActiveDM(friendId);
                                                                clearUnread(friendId);
                                                                if (!isOnline) connectToPeer(friendId);
                                                                if (closeMobileMenu) closeMobileMenu();
                                                            }}
                                                            title={isOnline ? "Online" : "Click to connect"}
                                                        >
                                                            <div className={`avatar ${peerAvatars[friendId] ? '' : 'placeholder'} ${!isOnline ? 'offline' : ''}`}>
                                                                {peerAvatars[friendId] ? (
                                                                    <img src={peerAvatars[friendId]} alt="" className="avatar-img" />
                                                                ) : (
                                                                    (friendName || '?').substring(0, 2).toUpperCase()
                                                                )}
                                                            </div>
                                                            <div className="connection-info">
                                                                <span className="connection-name">
                                                                    {friendName}
                                                                    {isPinned && <Pin size={11} style={{ color: 'var(--discord-blurple)', marginLeft: 4 }} />}
                                                                    {(peerBadges[friendId] || []).slice(0, 2).map(b => (
                                                                        <span key={b.id} className="sidebar-badge" style={{ color: b.color }} title={b.label}>
                                                                            {b.icon || b.label.substring(0, 1)}
                                                                        </span>
                                                                    ))}
                                                                </span>
                                                                {lastMsg ? (
                                                                    <span className="connection-subtext">{lastMsg.text || 'Sent a file'}</span>
                                                                ) : (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                        <span className="connection-subtext" style={{ marginRight: 'auto' }}>{isOnline ? 'Online' : 'Offline'}</span>
                                                                        {peerVoiceStates[friendId]?.muted && <span title="Muted" style={{ display: 'flex' }}><MicOff size={12} color="var(--discord-red)" /></span>}
                                                                        {peerVoiceStates[friendId]?.deafened && <span title="Deafened" style={{ display: 'flex' }}><Headphones size={12} color="var(--discord-red)" /></span>}
                                                                        {peerStatuses[friendId] === 'dnd' && <span style={{ fontSize: 10, color: 'var(--discord-red)' }}>DND</span>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className={`status-indicator ${isOnline ? (peerStatuses[friendId] || 'online') : ''}`}></div>
                                                            <button
                                                                className={`pin-toggle-btn ${isPinned ? 'pinned' : ''}`}
                                                                title={isPinned ? "Unpin chat" : "Pin chat to top"}
                                                                onClick={(e) => { e.stopPropagation(); togglePinChat(friendId); }}
                                                            >
                                                                <Pin size={12} />
                                                            </button>
                                                            {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
                                                        </li>
                                                    );
                                                })}
                                            </>
                                        );
                                    })()
                                )}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            {/* User Area Footer Like Discord */}
            <div className="sidebar-footer" style={{ position: 'relative' }}>
                {showStatusSelector && (
                    <div className="status-selector-popup">
                        {[
                            { key: 'online', label: 'Online', desc: 'You are visible' },
                            { key: 'idle', label: 'Idle', desc: 'Away from keyboard' },
                            { key: 'dnd', label: 'Do Not Disturb', desc: 'Mutes notifications' },
                            { key: 'invisible', label: 'Invisible', desc: 'Appear offline' },
                        ].map(opt => (
                            <button
                                key={opt.key}
                                className="status-option"
                                onClick={() => { setUserStatus(opt.key as any); setShowStatusSelector(false); }}
                            >
                                <span className={`status-dot ${opt.key}`} />
                                <div>
                                    <div style={{ fontWeight: 500 }}>{opt.label}</div>
                                    <div className="status-text-label">{opt.desc}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* Active Call Indicator — Discord-style, shown when in a voice call */}
                {(localStream || Object.keys(remoteStreams).length > 0) && (
                    <div className="active-call-indicator">
                        <div className="call-status">
                            <div className="call-pulse" />
                            <div className="call-info">
                                <span className="call-label">Voice Connected</span>
                                <span className="call-channel">
                                    {activeVoiceChannel ? 'Voice Lounge' : activeDM ? (peerNames[activeDM] || activeDM.substring(0, 10)) : 'Call'}
                                </span>
                            </div>
                        </div>
                        <button
                            className="call-disconnect-btn"
                            title="Disconnect"
                            onClick={() => endAllCalls()}
                        >
                            <PhoneOff size={18} />
                        </button>
                    </div>
                )}

                <div className="current-user-profile">
                    <div className={`avatar ${avatarUrl ? '' : 'placeholder'}`} style={{ position: 'relative' }}>
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="" className="avatar-img" />
                        ) : (
                            (displayName || '?').substring(0, 2).toUpperCase()
                        )}
                        <div className={`status-indicator ${userStatus}`} style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, border: '2px solid var(--discord-bg-secondary)' }} />
                    </div>
                    <div className="connection-info" style={{ flex: 1, overflow: 'hidden', cursor: 'pointer' }} onClick={() => setShowStatusSelector(!showStatusSelector)}>
                        <span className="connection-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                        <span className="connection-subtext">{userStatus === 'online' ? 'Online' : userStatus === 'idle' ? 'Idle' : userStatus === 'dnd' ? 'Do Not Disturb' : 'Invisible'}</span>
                    </div>
                    <div className="profile-actions">
                        <button className="action-btn" title={isMuted || isDeafened ? "Unmute" : "Mute"} onClick={toggleMute}>
                            {isMuted || isDeafened ? <MicOff size={18} color="var(--discord-red)" /> : <Mic size={18} />}
                        </button>
                        <button className="action-btn" title={isDeafened ? "Undeafen" : "Deafen"} onClick={toggleDeafen}>
                            <Headphones size={18} color={isDeafened ? "var(--discord-red)" : "currentColor"} />
                        </button>
                        <button
                            className="action-btn"
                            title={notificationsMuted ? "Notifications muted — click to unmute" : "Mute all notifications"}
                            onClick={toggleNotificationsMuted}
                        >
                            {notificationsMuted
                                ? <BellOff size={18} color="var(--discord-red)" />
                                : <Bell size={18} />}
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
