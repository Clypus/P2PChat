import React, { useState, useRef, useCallback } from 'react';
import { usePeer } from '../context/PeerContext';
import { Users, X, Crown, Shield, UserPlus, UserMinus } from 'lucide-react';
import './ServerMembers.css';

interface ServerMembersProps {
    isOpen?: boolean;
    onClose?: () => void;
}

const ROLE_COLORS: Record<string, string> = {
    owner: '#faa81a',
    admin: '#e74c3c',
    mod: '#3498db',
    member: 'var(--discord-text-muted)',
};

const ROLE_LABELS: Record<string, string> = {
    owner: 'Owner',
    admin: 'Admin',
    mod: 'Moderator',
    member: 'Member',
};

const ROLE_HIERARCHY: Record<string, number> = { owner: 4, admin: 3, mod: 2, member: 1 };

export const ServerMembers: React.FC<ServerMembersProps> = ({ isOpen, onClose }) => {
    const { activeServer, connections, serverMembers, peerNames, peerAvatars, peerId, displayName, avatarUrl, getServerRole, setServerRole, friendsList, addFriend, removeFriend } = usePeer();
    const [roleMenuFor, setRoleMenuFor] = useState<string | null>(null);

    if (!activeServer) return null;

    const [width, setWidth] = useState(240);
    const isResizing = useRef(false);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(200, Math.min(window.innerWidth - e.clientX, 400));
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

    const serverMemberConnections = connections.filter(c => serverMembers.has(c.peer));
    const myRole = getServerRole(activeServer.id, peerId);
    const myRoleLevel = ROLE_HIERARCHY[myRole] || 1;

    const membersList = [
        { id: peerId, name: displayName, avatar: avatarUrl, isSelf: true },
        ...serverMemberConnections.map(c => ({
            id: c.peer,
            name: peerNames[c.peer] || c.peer,
            avatar: peerAvatars[c.peer],
            isSelf: false
        }))
    ];

    // Sort by role hierarchy (owners first) then alphabetically
    membersList.sort((a, b) => {
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        const roleA = ROLE_HIERARCHY[getServerRole(activeServer.id, a.id)] || 1;
        const roleB = ROLE_HIERARCHY[getServerRole(activeServer.id, b.id)] || 1;
        if (roleA !== roleB) return roleB - roleA;
        return a.name.localeCompare(b.name);
    });

    const canAssignRole = (targetId: string) => {
        if (targetId === peerId) return false;
        const targetLevel = ROLE_HIERARCHY[getServerRole(activeServer.id, targetId)] || 1;
        return myRoleLevel > targetLevel && myRoleLevel >= 3;
    };

    return (
        <>
            {isOpen && <div className="mobile-overlay-backdrop members-backdrop" onClick={onClose}></div>}

            <aside className={`server-members-sidebar ${isOpen ? 'mobile-open' : ''}`} style={{ width: `${width}px`, minWidth: `${width}px`, position: 'relative' }}>
                <div className="sidebar-resize-handle left" onMouseDown={startResizing} />
                <div className="members-header">
                    <h3>ONLINE — {membersList.length}</h3>
                    <button className="mobile-members-close btn-icon" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="members-list">
                    {membersList.map(member => {
                        const role = getServerRole(activeServer.id, member.id);
                        const isFriend = friendsList.includes(member.id);
                        return (
                            <div
                                className="member-item"
                                key={member.id}
                                onContextMenu={(e) => {
                                    if (canAssignRole(member.id)) {
                                        e.preventDefault();
                                        setRoleMenuFor(roleMenuFor === member.id ? null : member.id);
                                    }
                                }}
                                style={{ position: 'relative' }}
                            >
                                <div className="member-avatar">
                                    {member.avatar ? (
                                        <img src={member.avatar} alt="" className="avatar-img" />
                                    ) : (
                                        <div className="avatar placeholder" style={{ backgroundColor: 'var(--discord-green)', color: 'white' }}>
                                            {member.name.substring(0, 2).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="status-indicator online"></div>
                                </div>
                                <div className="member-info">
                                    <span className="member-name" style={{ color: role !== 'member' ? ROLE_COLORS[role] : undefined }}>
                                        {role === 'owner' && <Crown size={12} style={{ marginRight: 4, color: ROLE_COLORS.owner }} />}
                                        {(role === 'admin' || role === 'mod') && <Shield size={12} style={{ marginRight: 4, color: ROLE_COLORS[role] }} />}
                                        {member.name} {member.isSelf && '(You)'}
                                    </span>
                                    <span style={{ color: ROLE_COLORS[role], fontSize: 11 }}>{ROLE_LABELS[role]}</span>
                                </div>
                                {!member.isSelf && (
                                    <button
                                        className="btn-icon"
                                        title={isFriend ? 'Remove Friend' : 'Add Friend'}
                                        onClick={() => isFriend ? removeFriend(member.id) : addFriend(member.id)}
                                        style={{ opacity: 0, padding: 4, transition: 'opacity 0.15s' }}
                                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
                                    >
                                        {isFriend ? <UserMinus size={14} color="var(--discord-red)" /> : <UserPlus size={14} />}
                                    </button>
                                )}

                                {roleMenuFor === member.id && (
                                    <div className="role-dropdown" onClick={(e) => e.stopPropagation()}>
                                        {(['admin', 'mod', 'member'] as const).map(r => (
                                            <button
                                                key={r}
                                                className={`role-option ${role === r ? 'active' : ''}`}
                                                onClick={() => { setServerRole(activeServer.id, member.id, r); setRoleMenuFor(null); }}
                                            >
                                                <span className="role-dot" style={{ backgroundColor: ROLE_COLORS[r] }} />
                                                {ROLE_LABELS[r]}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </aside>
        </>
    );
};
