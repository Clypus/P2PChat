import React, { useState } from 'react';
import { usePeer } from '../context/PeerContext';
import { Users, X } from 'lucide-react';
import './ServerActionModal.css'; // Reusing the same glassmorphism styles

interface GroupDMModalProps {
    onClose: () => void;
}

export const GroupDMModal: React.FC<GroupDMModalProps> = ({ onClose }) => {
    const { createGroupDM } = usePeer();
    const [name, setName] = useState('');
    const [membersInput, setMembersInput] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        const members = membersInput.split(',').map(s => s.trim()).filter(Boolean);
        if (trimmedName && members.length > 0) {
            createGroupDM(trimmedName, members);
            onClose();
        }
    };

    return (
        <div className="server-modal-overlay">
            <div className="server-modal-dialog">
                <button className="btn-close" onClick={onClose} title="Close">
                    <X size={20} />
                </button>

                <div className="modal-content create-mode" style={{ paddingBottom: '24px' }}>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                        <Users size={28} />
                        Create Group DM
                    </h2>
                    <p className="modal-subtitle">
                        Create a private multi-user chat outside of a server.
                    </p>

                    <form onSubmit={handleSubmit} className="modal-form">
                        <div className="input-group">
                            <label>GROUP NAME</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Secret Lair"
                                autoFocus
                            />
                        </div>
                        <div className="input-group mt-16">
                            <label>INVITE FRIENDS (COMMA-SEPARATED PEER IDS)</label>
                            <input
                                type="text"
                                value={membersInput}
                                onChange={(e) => setMembersInput(e.target.value)}
                                placeholder="peer1-id, peer2-id..."
                            />
                        </div>
                        <div className="modal-footer" style={{ marginTop: '24px' }}>
                            <button type="button" className="btn-back" onClick={onClose}>Cancel</button>
                            <button type="submit" className="btn-primary" disabled={!name.trim() || !membersInput.trim()}>Create DM</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
