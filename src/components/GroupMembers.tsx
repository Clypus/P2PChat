import React, { useState, useRef, useCallback } from 'react';
import { usePeer } from '../context/PeerContext';
import { Users, X, UserPlus, Crown, MinusCircle } from 'lucide-react';
import './ServerMembers.css';

interface GroupMembersProps {
    groupId: string;
    isOpen?: boolean;
    onClose?: () => void;
}

export const GroupMembers: React.FC<GroupMembersProps> = ({ groupId, isOpen, onClose }) => {
    const { groupDMs, connections, peerNames, peerAvatars, peerId, displayName, avatarUrl, addGroupMember, knownPeers, removeGroupMember, transferGroupOwnership } = usePeer();
    const [newMemberId, setNewMemberId] = useState('');

    const group = groupDMs[groupId];
    if (!group) return null;

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

    const handleAddMember = (e: React.FormEvent) => {
        e.preventDefault();
        if (newMemberId.trim() && newMemberId.trim() !== peerId) {
            addGroupMember(groupId, newMemberId.trim());
            setNewMemberId('');
        }
    };

    const membersList = group.members.map(memberId => {
        const isSelf = memberId === peerId;
        const isOnline = isSelf || connections.some(c => c.peer === memberId);
        return {
            id: memberId,
            name: isSelf ? displayName : (peerNames[memberId] || knownPeers[memberId] || memberId.substring(0, 10)),
            avatar: isSelf ? avatarUrl : peerAvatars[memberId],
            isSelf,
            isOnline,
        };
    });

    const isOwner = (group as any).owner === peerId;
    const groupOwner = (group as any).owner;

    membersList.sort((a, b) => {
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    const onlineCount = membersList.filter(m => m.isOnline).length;
    const offlineCount = membersList.filter(m => !m.isOnline).length;

    return (
        <>
            {isOpen && <div className="mobile-overlay-backdrop members-backdrop" onClick={onClose}></div>}

            <aside className={`server-members-sidebar ${isOpen ? 'mobile-open' : ''}`} style={{ width: `${width}px`, minWidth: `${width}px`, position: 'relative' }}>
                <div className="sidebar-resize-handle left" onMouseDown={startResizing} />
                <div className="members-header">
                    <h3>GROUP MEMBERS</h3>
                    <button className="mobile-members-close btn-icon" onClick={onClose}><X size={20} /></button>
                </div>

                {}
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--discord-bg-hover)' }}>
                    <form onSubmit={handleAddMember} style={{ display: 'flex', gap: '6px' }}>
                        <input
                            type="text"
                            value={newMemberId}
                            onChange={(e) => setNewMemberId(e.target.value)}
                            placeholder="Add by Peer ID..."
                            style={{
                                flex: 1,
                                padding: '6px 10px',
                                fontSize: '12px',
                                background: 'var(--discord-bg-dark)',
                                border: '1px solid var(--discord-bg-hover)',
                                borderRadius: '4px',
                                color: 'var(--discord-text)',
                                outline: 'none',
                            }}
                        />
                        <button
                            type="submit"
                            disabled={!newMemberId.trim()}
                            style={{
                                padding: '6px 8px',
                                background: 'var(--discord-green)',
                                border: 'none',
                                borderRadius: '4px',
                                color: 'white',
                                cursor: newMemberId.trim() ? 'pointer' : 'not-allowed',
                                opacity: newMemberId.trim() ? 1 : 0.5,
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            <UserPlus size={14} />
                        </button>
                    </form>
                </div>

                <div className="members-list">
                    {/* Online Section */}
                    {onlineCount > 0 && (
                        <>
                            <div style={{ padding: '12px 12px 4px', fontSize: '11px', fontWeight: 600, color: 'var(--discord-text-muted)', textTransform: 'uppercase' }}>
                                Online — {onlineCount}
                            </div>
                            {membersList.filter(m => m.isOnline).map(member => (
                                <div className="member-item" key={member.id}>
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
                                        <span className="member-name">
                                            {member.name} {member.isSelf && '(You)'}
                                            {member.id === groupOwner && <span className="owner-badge"><Crown size={12} /> Owner</span>}
                                        </span>
                                    </div>
                                    {isOwner && !member.isSelf && (
                                        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
                                            <button className="kick-btn" title="Transfer Ownership" onClick={() => { if (window.confirm(`Transfer ownership to ${member.name}?`)) transferGroupOwnership(groupId, member.id); }}>
                                                <Crown size={14} />
                                            </button>
                                            <button className="kick-btn" title="Kick from Group" onClick={() => { if (window.confirm(`Kick ${member.name}?`)) removeGroupMember(groupId, member.id); }}>
                                                <MinusCircle size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </>
                    )}

                    {}
                    {offlineCount > 0 && (
                        <>
                            <div style={{ padding: '12px 12px 4px', fontSize: '11px', fontWeight: 600, color: 'var(--discord-text-muted)', textTransform: 'uppercase' }}>
                                Offline — {offlineCount}
                            </div>
                            {membersList.filter(m => !m.isOnline).map(member => (
                                <div className="member-item" key={member.id} style={{ opacity: 0.5 }}>
                                    <div className="member-avatar">
                                        {member.avatar ? (
                                            <img src={member.avatar} alt="" className="avatar-img" />
                                        ) : (
                                            <div className="avatar placeholder" style={{ backgroundColor: 'var(--discord-text-muted)', color: 'white' }}>
                                                {member.name.substring(0, 2).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="status-indicator"></div>
                                    </div>
                                    <div className="member-info">
                                        <span className="member-name">
                                            {member.name}
                                            {member.id === groupOwner && <span className="owner-badge"><Crown size={12} /> Owner</span>}
                                        </span>
                                    </div>
                                    {isOwner && !member.isSelf && (
                                        <button className="kick-btn" title="Kick from Group" onClick={() => { if (window.confirm(`Kick ${member.name}?`)) removeGroupMember(groupId, member.id); }}>
                                            <MinusCircle size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </aside>
        </>
    );
};
