import React, { useState, useRef } from 'react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
    onComplete: (name: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
    const [name, setName] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim().length > 0) {
            onComplete(name.trim());
        }
    };

    const handleImportAccount = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const result = event.target?.result as string;
                const backup = JSON.parse(result);

                if (backup.identity && backup.identity.id) {
                    localStorage.setItem('p2p_chat_identity', JSON.stringify(backup.identity));
                    if (backup.servers) {
                        localStorage.setItem('p2p_chat_servers', JSON.stringify(backup.servers));
                    }
                    if (backup.friends) {
                        localStorage.setItem('p2p_chat_friends', JSON.stringify(backup.friends));
                    }
                    window.location.reload(); 
                } else {
                    alert("Invalid backup file.");
                }
            } catch (err) {
                console.error("Failed to parse backup:", err);
                alert("Failed to read backup file.");
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="welcome-overlay">
            <div className="welcome-modal">
                <div className="welcome-header">
                    <h2>Welcome to P2P Chat</h2>
                    <p>We're so excited to see you!</p>
                </div>
                <form onSubmit={handleSubmit} className="welcome-form">
                    <div className="input-group">
                        <label htmlFor="displayName">DISPLAY NAME <span className="required">*</span></label>
                        <input
                            type="text"
                            id="displayName"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="What should everyone call you?"
                            autoFocus
                            maxLength={32}
                        />
                    </div>
                    <button type="submit" className="btn btn-primary btn-full" disabled={!name.trim()}>
                        Continue
                    </button>

                    <div style={{ marginTop: '24px', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--discord-text-muted)' }}>Already have an account?</span>
                        <br />
                        <button
                            type="button"
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--discord-blurple)',
                                cursor: 'pointer',
                                marginTop: '8px',
                                fontSize: '13px',
                                fontWeight: '500'
                            }}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Import Backup File
                        </button>
                        <input
                            type="file"
                            accept=".json"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            onChange={handleImportAccount}
                        />
                    </div>
                </form>
            </div>
        </div>
    );
};
