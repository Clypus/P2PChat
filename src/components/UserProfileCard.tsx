import React, { useState, useRef, useEffect } from 'react';
import { usePeer } from '../context/PeerContext';
import { X, Copy, Check, MessageCircle } from 'lucide-react';
import './UserProfileCard.css';

interface UserProfileCardProps {
    userId: string;
    onClose: () => void;
    anchorRef?: React.RefObject<HTMLElement>;
}

export const UserProfileCard: React.FC<UserProfileCardProps> = ({ userId, onClose }) => {
    const { peerNames, peerAvatars, connections, setActiveDM, knownPeers, peerId, displayName, avatarUrl } = usePeer();
    const [copied, setCopied] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    const isMe = userId === peerId;
    const name = isMe ? displayName : (peerNames[userId] || knownPeers[userId] || userId.substring(0, 8));
    const avatar = isMe ? avatarUrl : peerAvatars[userId];
    const isOnline = isMe || connections.some(c => c.peer === userId);

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

    return (
        <div className="profile-card-overlay">
            <div className="profile-card" ref={cardRef}>
                <div className="profile-card-banner" />
                <button className="profile-card-close" onClick={onClose}><X size={18} /></button>

                <div className="profile-card-avatar-container">
                    <div className={`profile-card-avatar ${avatar ? '' : 'placeholder'}`}>
                        {avatar ? (
                            <img src={avatar} alt="" className="profile-card-avatar-img" />
                        ) : (
                            name.substring(0, 2).toUpperCase()
                        )}
                    </div>
                    <div className={`profile-card-status-dot ${isOnline ? 'online' : 'offline'}`} />
                </div>

                <div className="profile-card-body">
                    <h2 className="profile-card-name">{name}</h2>
                    <span className="profile-card-id" onClick={copyId} title="Click to copy">
                        {copied ? <><Check size={12} /> Copied!</> : <>{userId.substring(0, 20)}... <Copy size={12} /></>}
                    </span>
                    <div className="profile-card-divider" />

                    <div className="profile-card-section">
                        <h3>MEMBER SINCE</h3>
                        <p>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                    </div>

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
