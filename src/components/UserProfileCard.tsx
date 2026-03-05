import React, { useState, useRef, useEffect } from 'react';
import { usePeer } from '../context/PeerContext';
import { X, Copy, Check, MessageCircle, UserPlus, UserMinus, Crown, Shield } from 'lucide-react';
import './UserProfileCard.css';

interface UserProfileCardProps {
    userId: string;
    onClose: () => void;
    anchorRef?: React.RefObject<HTMLElement>;
}

export const UserProfileCard: React.FC<UserProfileCardProps> = ({ userId, onClose }) => {
    const {
        peerNames, peerAvatars, connections, setActiveDM, knownPeers,
        peerId, displayName, avatarUrl, aboutMe, peerAboutMe,
        peerStatuses, userStatus, peerLatencies,
        friendsList, addFriend, removeFriend,
        activeServer, getServerRole
    } = usePeer();
    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState<'about' | 'roles'>('about');
    const cardRef = useRef<HTMLDivElement>(null);

    const isMe = userId === peerId;
    const name = isMe ? (displayName || 'You') : (peerNames[userId] || knownPeers[userId] || userId.substring(0, 8));
    const avatar = isMe ? avatarUrl : peerAvatars[userId];
    const isOnline = isMe || connections.some(c => c.peer === userId);
    const userAbout = isMe ? aboutMe : (peerAboutMe?.[userId] || '');
    const status = isMe ? (userStatus || 'online') : (peerStatuses?.[userId] || (isOnline ? 'online' : 'offline'));
    const latency = !isMe ? peerLatencies?.[userId] : undefined;
    const safeList = Array.isArray(friendsList) ? friendsList : [];
    const isFriend = safeList.includes(userId);

    // Role in current server
    const serverRole = activeServer ? getServerRole(activeServer.id, userId) : null;

    useEffect(() => {
        const handle = (e: MouseEvent) => {
            if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [onClose]);

    const copyId = () => {
        navigator.clipboard.writeText(userId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
        online: { color: 'var(--discord-green, #3ba55d)', label: 'Online' },
        idle: { color: '#faa81a', label: 'Idle' },
        dnd: { color: '#ed4245', label: 'Do Not Disturb' },
        invisible: { color: 'var(--discord-text-muted)', label: 'Offline' },
        offline: { color: 'var(--discord-text-muted)', label: 'Offline' },
    };

    const ROLE_COLORS: Record<string, string> = {
        owner: '#faa81a',
        admin: '#e74c3c',
        mod: '#3498db',
        member: 'var(--discord-text-muted)',
    };

    const statusInfo = STATUS_CONFIG[status] || STATUS_CONFIG.online;

    // Generate a consistent banner color from user ID
    const bannerHue = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

    return (
        <div className="profile-card-overlay">
            <div className="profile-card" ref={cardRef}>
                {/* Banner */}
                <div className="profile-card-banner" style={{ background: `linear-gradient(135deg, hsl(${bannerHue}, 60%, 45%), hsl(${(bannerHue + 40) % 360}, 50%, 35%))` }} />
                <button className="profile-card-close" onClick={onClose}><X size={16} /></button>

                {/* Avatar */}
                <div className="profile-card-avatar-section">
                    <div className="profile-card-avatar-container">
                        <div className={`profile-card-avatar ${avatar ? '' : 'placeholder'}`}>
                            {avatar ? (
                                <img src={avatar} alt="" className="profile-card-avatar-img" />
                            ) : (
                                name.substring(0, 2).toUpperCase()
                            )}
                        </div>
                        <div className="profile-card-status-dot" style={{ backgroundColor: statusInfo.color }} />
                    </div>
                    {/* Friend button */}
                    {!isMe && (
                        <button
                            className={`profile-card-friend-btn ${isFriend ? 'is-friend' : ''}`}
                            onClick={() => isFriend ? removeFriend(userId) : addFriend(userId)}
                            title={isFriend ? 'Remove Friend' : 'Add Friend'}
                        >
                            {isFriend ? <UserMinus size={16} /> : <UserPlus size={16} />}
                        </button>
                    )}
                </div>

                {/* Body */}
                <div className="profile-card-body">
                    <div className="profile-card-name-row">
                        <h2 className="profile-card-name">{name}</h2>
                        {serverRole && serverRole !== 'member' && (
                            <span className="profile-card-role-badge" style={{ color: ROLE_COLORS[serverRole] }}>
                                {serverRole === 'owner' ? <Crown size={12} /> : <Shield size={12} />}
                                {serverRole.charAt(0).toUpperCase() + serverRole.slice(1)}
                            </span>
                        )}
                    </div>

                    <div className="profile-card-username-row">
                        <span className="profile-card-id" onClick={copyId} title="Click to copy Peer ID">
                            {copied ? <><Check size={12} /> Copied!</> : <>{userId.substring(0, 20)}... <Copy size={12} /></>}
                        </span>
                    </div>

                    {/* Status */}
                    <div className="profile-card-status-row">
                        <span className="profile-card-status-indicator" style={{ backgroundColor: statusInfo.color }} />
                        <span className="profile-card-status-text">{statusInfo.label}</span>
                        {latency !== undefined && (
                            <span className="profile-card-latency">{latency}ms</span>
                        )}
                    </div>

                    <div className="profile-card-divider" />

                    {/* Tabs */}
                    <div className="profile-card-tabs">
                        <button
                            className={`profile-card-tab ${activeTab === 'about' ? 'active' : ''}`}
                            onClick={() => setActiveTab('about')}
                        >
                            About Me
                        </button>
                        {activeServer && (
                            <button
                                className={`profile-card-tab ${activeTab === 'roles' ? 'active' : ''}`}
                                onClick={() => setActiveTab('roles')}
                            >
                                Server Info
                            </button>
                        )}
                    </div>

                    {/* Tab Content */}
                    <div className="profile-card-tab-content">
                        {activeTab === 'about' && (
                            <div className="profile-card-about">
                                {userAbout ? (
                                    <p className="profile-card-about-text">{userAbout}</p>
                                ) : (
                                    <p className="profile-card-about-empty">No about me set.</p>
                                )}

                                <div className="profile-card-section">
                                    <h3>P2P CHAT MEMBER SINCE</h3>
                                    <p>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'roles' && activeServer && (
                            <div className="profile-card-server-info">
                                <div className="profile-card-section">
                                    <h3>SERVER</h3>
                                    <p>{activeServer.name}</p>
                                </div>
                                <div className="profile-card-section">
                                    <h3>ROLE</h3>
                                    <div className="profile-card-role-pill" style={{ borderColor: ROLE_COLORS[serverRole || 'member'] }}>
                                        <span className="role-dot" style={{ backgroundColor: ROLE_COLORS[serverRole || 'member'] }} />
                                        {(serverRole || 'member').charAt(0).toUpperCase() + (serverRole || 'member').slice(1)}
                                    </div>
                                </div>
                                {latency !== undefined && (
                                    <div className="profile-card-section">
                                        <h3>LATENCY</h3>
                                        <p>{latency}ms</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    {!isMe && (
                        <button
                            className="profile-card-dm-btn"
                            onClick={() => { setActiveDM(userId); onClose(); }}
                        >
                            <MessageCircle size={16} /> Send Message
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
