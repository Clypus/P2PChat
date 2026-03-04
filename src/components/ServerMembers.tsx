import React, { useState, useRef, useCallback } from 'react';
import { usePeer } from '../context/PeerContext';
import { Users, X } from 'lucide-react';
import './ServerMembers.css';

interface ServerMembersProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export const ServerMembers: React.FC<ServerMembersProps> = ({ isOpen, onClose }) => {
    const { activeServer, connections, serverMembers, peerNames, peerAvatars, peerId, displayName, avatarUrl } = usePeer();

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
    const membersList = [
        { id: peerId, name: displayName, avatar: avatarUrl, isSelf: true },
        ...serverMemberConnections.map(c => ({
            id: c.peer,
            name: peerNames[c.peer] || c.peer,
            avatar: peerAvatars[c.peer],
            isSelf: false
        }))
    ];

    membersList.sort((a, b) => {
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        return a.name.localeCompare(b.name);
    });

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
                    {membersList.map(member => (
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
                                <span className="member-name">{member.name} {member.isSelf && '(You)'}</span>
                                {}
                            </div>
                        </div>
                    ))}
                </div>
            </aside >
        </>
    );
};
