import React, { useState, useRef, useEffect } from 'react';
import { usePeer, UserMessage } from '../context/PeerContext';
import { Send, Hash, Video, Phone, Info, PlusCircle, FileText, Download, Users, Menu } from 'lucide-react';
import { VideoGrid } from './VideoGrid';
import { ServerMembers } from './ServerMembers';
import './ChatArea.css';

interface ChatAreaProps {
    onToggleMobileMenu?: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ onToggleMobileMenu }) => {
    const { messages, sendMessage, peerId, connections, startCall, activeServer, activeChannel, activeVoiceChannel, activeDM, knownPeers, avatarUrl, peerAvatars, groupDMs, localStream, remoteStreams } = usePeer();
    const [inputText, setInputText] = useState('');
    const [isMembersListOpen, setIsMembersListOpen] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const canChat = activeServer
        ? connections.length > 0
        : connections.some(c => c.peer === activeDM);

    const filteredMessages = activeServer
        ? messages.filter(msg => (msg.channelId || 'general') === activeChannel)
        : messages.filter(msg => {
            if (!activeDM) return false;
            if (activeDM.startsWith('group_')) {
                return msg.channelId === activeDM;
            }
            // A message belongs to this DM if:
            // 1. They sent it to us (sender is them, target channel is our peerId)
            // 2. We sent it to them (sender is us, target channel is their peerId)
            return (msg.senderId === activeDM && msg.channelId === peerId) ||
                (msg.senderId === peerId && msg.channelId === activeDM);
        });

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [filteredMessages]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputText.trim() && canChat) {
            sendMessage(inputText);
            setInputText('');
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !canChat) return;

        // Reset input immediately so user can select the same file again if they want
        e.target.value = '';

        const reader = new FileReader();
        reader.onload = async (event) => {
            const result = event.target?.result as string;
            // result is a data URL: "data:image/png;base64,iVBORw0KGgo..."
            // We only need the base64 part to send over the wire
            const base64Data = result.split(',')[1];

            if (base64Data) {
                sendMessage(inputText, {
                    name: file.name,
                    type: file.type,
                    data: base64Data
                });
                setInputText(''); // clear text if sent with a file
            }
        };
        // Read as Data URL directly gives us base64 which is safe for JSON.stringify in localStorage
        reader.readAsDataURL(file);
    };

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const showVideoGrid = activeServer ? activeChannel === 'Voice Lounge' : (!!localStream || Object.keys(remoteStreams).length > 0);

    if (!activeServer && !activeDM) {
        return (
            <div className="chat-area">
                <div className="chat-header mobile-only-header">
                    <button className="mobile-menu-btn" onClick={onToggleMobileMenu}>
                        <Menu size={24} />
                    </button>
                    <h3>Direct Messages</h3>
                </div>
                {showVideoGrid && <VideoGrid />}
                <div className="empty-chat" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="welcome-banner" style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: 48, color: 'var(--discord-text-muted)', fontWeight: 'bold' }}>@</span>
                        <h1>Direct Messages</h1>
                        <p className="hint">Select a friend from the sidebar to start chatting.</p>
                    </div>
                </div>
            </div>
        );
    }

    const titleName = activeServer
        ? activeChannel
        : (activeDM?.startsWith('group_') ? (groupDMs[activeDM]?.name || "Group DM") : (knownPeers[activeDM || ''] || "Unknown User"));
    const TitleIcon = activeServer
        ? <Hash size={24} className="hash-icon" />
        : (activeDM?.startsWith('group_') ? <Users size={24} style={{ color: "var(--discord-text-muted)", marginRight: 8 }} /> : <span style={{ fontSize: 24, paddingRight: 8, color: "var(--discord-text-muted)", fontWeight: "bold" }}>@</span>);

    return (
        <div style={{ display: 'flex', height: '100%', width: '100%' }}>
            <div className="chat-area" style={{ flex: 1, minWidth: 0 }}>
                {/* Header */}
                <div className="chat-header">
                    <button className="mobile-menu-btn" onClick={onToggleMobileMenu}>
                        <Menu size={24} />
                    </button>
                    <div className="chat-title">
                        {TitleIcon}
                        <h3>{titleName}</h3>
                    </div>
                    <div className="chat-actions">
                        {!activeServer && (
                            <>
                                <button
                                    className="btn-icon"
                                    title="Start Voice Call"
                                    disabled={!canChat}
                                    onClick={() => {
                                        connections.forEach(conn => startCall(conn.peer, false));
                                    }}
                                >
                                    <Phone size={20} />
                                </button>
                                <button
                                    className="btn-icon"
                                    title="Start Video Call"
                                    disabled={!canChat}
                                    onClick={() => {
                                        connections.forEach(conn => startCall(conn.peer, true));
                                    }}
                                >
                                    <Video size={20} />
                                </button>
                            </>
                        )}
                        <button className="btn-icon" title="Connection Info">
                            <Info size={20} />
                        </button>
                        {activeServer && (
                            <button
                                className={`btn-icon ${isMembersListOpen ? 'active' : ''}`}
                                title="Toggle Members List"
                                onClick={() => setIsMembersListOpen(!isMembersListOpen)}
                            >
                                <Users size={20} />
                            </button>
                        )}
                    </div>
                </div>

                {showVideoGrid && <VideoGrid />}

                {/* Message List */}
                <div className={`message-list ${canChat ? 'active' : ''}`}>
                    {filteredMessages.length === 0 ? (
                        <div className="empty-chat">
                            <div className="welcome-banner">
                                {TitleIcon}
                                <h1>Welcome to {activeServer ? `#${titleName}` : titleName}!</h1>
                                <p>This is the start of an end-to-end encrypted P2P channel.</p>
                                {!canChat && (
                                    <p className="hint">Connect to a friend using the sidebar to start chatting.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        filteredMessages.map((msg, index) => {
                            const isMe = msg.senderId === peerId;
                            const isConsecutive = index > 0 && filteredMessages[index - 1].senderId === msg.senderId;

                            return (
                                <div key={msg.id} className={`message-container ${isConsecutive ? 'consecutive' : ''}`}>
                                    {(!isConsecutive) && (() => {
                                        const msgAvatar = isMe ? avatarUrl : peerAvatars[msg.senderId];
                                        return (
                                            <div className="message-avatar" style={{ overflow: 'hidden', padding: 0 }}>
                                                {msgAvatar ? (
                                                    <img src={msgAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    msg.senderName ? msg.senderName.substring(0, 2).toUpperCase() : (isMe ? 'Y' : 'P')
                                                )}
                                            </div>
                                        );
                                    })()}

                                    <div className="message-content">
                                        {!isConsecutive && (
                                            <div className="message-header">
                                                <span className="message-author">{msg.senderName || (isMe ? 'You' : 'Peer')}</span>
                                                <span className="message-time">{formatTime(msg.timestamp)}</span>
                                            </div>
                                        )}
                                        <div className="message-text">
                                            {msg.text}
                                        </div>
                                        {msg.file && (
                                            <FileAttachment file={msg.file} />
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="chat-input-area">
                    <form onSubmit={handleSend} className="chat-form">
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            onChange={handleFileSelect}
                        />
                        <button
                            type="button"
                            className="attach-btn"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!canChat}
                            title="Upload a file"
                        >
                            <PlusCircle size={24} />
                        </button>
                        <input
                            type="text"
                            className="chat-input"
                            placeholder={canChat ? `Message ${activeServer ? '#' : '@'}${titleName}` : "Connect to a peer to send messages..."}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            disabled={!canChat}
                        />
                        <button
                            type="submit"
                            className="send-btn"
                            disabled={!inputText.trim() || !canChat}
                        >
                            <Send size={18} />
                        </button>
                    </form>
                </div>
            </div>

            {/* Members Sidebar */}
            {activeServer && (
                <ServerMembers
                    isOpen={isMembersListOpen}
                    onClose={() => setIsMembersListOpen(false)}
                />
            )}
        </div>
    );
};

// Component to safely create and destroy ObjectURLs to avoid memory leaks
const FileAttachment: React.FC<{ file: NonNullable<UserMessage['file']> }> = ({ file }) => {
    const [objectUrl, setObjectUrl] = useState<string>('');

    useEffect(() => {
        try {
            // Convert base64 string back to a Blob
            const byteCharacters = atob(file.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);

            const blob = new Blob([byteArray], { type: file.type });
            const url = URL.createObjectURL(blob);
            setObjectUrl(url);

            return () => {
                URL.revokeObjectURL(url);
            };
        } catch (e) {
            console.error("Failed to parse file attachment", e);
        }
    }, [file]);

    const isImage = file.type.startsWith('image/');

    if (isImage) {
        return (
            <div className="message-attachment image-attachment">
                <a href={objectUrl} target="_blank" rel="noreferrer">
                    <img src={objectUrl} alt={file.name} loading="lazy" />
                </a>
            </div>
        );
    }

    return (
        <div className="message-attachment file-attachment">
            <div className="file-icon-wrap">
                <FileText size={32} />
            </div>
            <div className="file-info">
                <span className="file-name">{file.name}</span>
                <a href={objectUrl} download={file.name} className="download-link">
                    <Download size={14} /> Download
                </a>
            </div>
        </div>
    );
};
