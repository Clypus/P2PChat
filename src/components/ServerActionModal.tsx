import React, { useState } from 'react';
import { usePeer } from '../context/PeerContext';
import { PlusCircle, Compass, X } from 'lucide-react';
import './ServerActionModal.css';

interface ServerActionModalProps {
    onClose: () => void;
}

export const ServerActionModal: React.FC<ServerActionModalProps> = ({ onClose }) => {
    const { createServer, joinServer } = usePeer();
    const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');

    const [serverName, setServerName] = useState('');

    const [inviteCode, setInviteCode] = useState('');
    const [joinName, setJoinName] = useState('');

    const handleCreateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (serverName.trim()) {
            createServer(serverName.trim());
            onClose();
        }
    };

    const handleJoinSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (inviteCode.trim() && joinName.trim()) {
            joinServer(inviteCode.trim(), joinName.trim());
            onClose();
        }
    };

    return (
        <div className="server-modal-overlay">
            <div className="server-modal-dialog">
                <button className="btn-close" onClick={onClose} title="Close">
                    <X size={20} />
                </button>

                {mode === 'select' && (
                    <div className="modal-content select-mode">
                        <h2>Add a Server</h2>
                        <p className="modal-subtitle">
                            Your server is where you and your friends hang out. Make yours and start talking.
                        </p>

                        <div className="modal-options">
                            <button className="option-card create-card" onClick={() => setMode('create')}>
                                <PlusCircle size={32} />
                                <span>Create My Own</span>
                            </button>

                            <button className="option-card join-card" onClick={() => setMode('join')}>
                                <Compass size={32} />
                                <span>Join a Server</span>
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'create' && (
                    <div className="modal-content create-mode">
                        <h2>Customize your server</h2>
                        <p className="modal-subtitle">
                            Give your new server a personality with a name. You can always change it later.
                        </p>

                        <form onSubmit={handleCreateSubmit} className="modal-form">
                            <div className="input-group">
                                <label>SERVER NAME</label>
                                <input
                                    type="text"
                                    value={serverName}
                                    onChange={(e) => setServerName(e.target.value)}
                                    placeholder="My Awesome Server"
                                    autoFocus
                                />
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn-back" onClick={() => setMode('select')}>Back</button>
                                <button type="submit" className="btn-primary" disabled={!serverName.trim()}>Create</button>
                            </div>
                        </form>
                    </div>
                )}

                {mode === 'join' && (
                    <div className="modal-content join-mode">
                        <h2>Join a Server</h2>
                        <p className="modal-subtitle">
                            Enter an Invite Code (Host Peer ID) below to join an existing server.
                        </p>

                        <form onSubmit={handleJoinSubmit} className="modal-form">
                            <div className="input-group">
                                <label>INVITE CODE (PEER ID) <span className="required">*</span></label>
                                <input
                                    type="text"
                                    value={inviteCode}
                                    onChange={(e) => setInviteCode(e.target.value)}
                                    placeholder="e.g. peerjs-id-1234"
                                    autoFocus
                                />
                            </div>
                            <div className="input-group mt-16">
                                <label>SERVER DISPLAY NAME</label>
                                <input
                                    type="text"
                                    value={joinName}
                                    onChange={(e) => setJoinName(e.target.value)}
                                    placeholder="Friendly name for this server"
                                    required
                                />
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn-back" onClick={() => setMode('select')}>Back</button>
                                <button type="submit" className="btn-primary" disabled={!inviteCode.trim() || !joinName.trim()}>Join Server</button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};
