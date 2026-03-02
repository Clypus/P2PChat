import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import { usePeer, UserMessage } from '../context/PeerContext';
import { Send, Hash, Video, Phone, Info, PlusCircle, FileText, Download, Users, Menu, Smile, Reply, X } from 'lucide-react';
import { VideoGrid } from './VideoGrid';
import { ServerMembers } from './ServerMembers';
import { GroupMembers } from './GroupMembers';
import './ChatArea.css';

const EMOJI_CATEGORIES: { name: string; emojis: string[] }[] = [
    { name: 'Reactions', emojis: ['👍', '👎', '😂', '❤️', '🔥', '😮', '😢', '🎉', '🤔', '👀'] },
    { name: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓'] },
    { name: 'Gestures', emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌'] },
    { name: 'Hearts', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'] },
    { name: 'Objects', emojis: ['🎮', '🎲', '🎯', '🏆', '🎪', '🎬', '🎤', '🎧', '🎵', '🎶', '📱', '💻', '🖥️', '📷', '📸', '🔒', '🔑', '💡', '📌', '📎'] },
];
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀'];

interface ChatAreaProps {
    onToggleMobileMenu?: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ onToggleMobileMenu }) => {
    const { messages, sendMessage, peerId, connections, startCall, activeServer, activeChannel, activeVoiceChannel, activeDM, knownPeers, avatarUrl, peerAvatars, groupDMs, localStream, remoteStreams, typingPeers, sendTypingIndicator, addReaction, peerNames } = usePeer();
    const [inputText, setInputText] = useState('');
    const [isMembersListOpen, setIsMembersListOpen] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [replyingTo, setReplyingTo] = useState<UserMessage | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);

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
            sendMessage(inputText, undefined, replyingTo ? { id: replyingTo.id, senderName: replyingTo.senderName, text: replyingTo.text } : undefined);
            setInputText('');
            setReplyingTo(null);
            setShowEmojiPicker(false);
        }
    };

    // Drag and drop handlers
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
    };
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setIsDragging(false);
    };
    const handleDragOver = (e: React.DragEvent) => e.preventDefault();
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragging(false);
        if (!canChat) return;
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        const MAX_FILE_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            alert(`File too large! Maximum size is 25MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result as string;
            const base64Data = result.split(',')[1];
            if (base64Data) {
                sendMessage('', { name: file.name, type: file.type, data: base64Data });
            }
        };
        reader.readAsDataURL(file);
    };

    // Typing peers display
    const typingNames = Object.keys(typingPeers)
        .filter(id => id !== peerId)
        .map(id => peerNames[id] || knownPeers[id] || id.substring(0, 8));

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !canChat) return;

        // File size limit: 25MB
        const MAX_FILE_SIZE = 25 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            alert(`File too large! Maximum size is 25MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
            e.target.value = '';
            return;
        }

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
            <div className="chat-area" style={{ flex: 1, minWidth: 0 }}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                {/* Drag overlay */}
                {isDragging && (
                    <div className="drag-overlay">
                        <div className="drag-overlay-content">
                            <PlusCircle size={48} />
                            <p>Drop file to send</p>
                        </div>
                    </div>
                )}
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
                        {!activeServer && activeDM?.startsWith('group_') && (
                            <button
                                className={`btn-icon ${isMembersListOpen ? 'active' : ''}`}
                                title="Toggle Group Members"
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
                                <MessageRow
                                    key={msg.id}
                                    msg={msg}
                                    isMe={isMe}
                                    isConsecutive={isConsecutive}
                                    avatarUrl={avatarUrl}
                                    peerAvatars={peerAvatars}
                                    formatTime={formatTime}
                                    onReply={() => setReplyingTo(msg)}
                                    onReact={(emoji) => addReaction(msg.id, emoji)}
                                    peerId={peerId}
                                    peerNames={peerNames}
                                />
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Typing Indicator */}
                {typingNames.length > 0 && (
                    <div className="typing-indicator">
                        <div className="typing-dots"><span /><span /><span /></div>
                        <span>{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing...</span>
                    </div>
                )}

                {/* Input Area */}
                <div className="chat-input-area">
                    {/* Reply Preview */}
                    {replyingTo && (
                        <div className="reply-preview">
                            <Reply size={14} />
                            <span>Replying to <strong>{replyingTo.senderName}</strong>: {replyingTo.text.substring(0, 80)}{replyingTo.text.length > 80 ? '...' : ''}</span>
                            <button className="reply-close" onClick={() => setReplyingTo(null)}><X size={14} /></button>
                        </div>
                    )}
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
                            onChange={(e) => { setInputText(e.target.value); sendTypingIndicator(); }}
                            disabled={!canChat}
                        />
                        <button
                            type="button"
                            className={`emoji-toggle-btn ${showEmojiPicker ? 'active' : ''}`}
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            disabled={!canChat}
                            title="Emoji"
                        >
                            <Smile size={20} />
                        </button>
                        <button
                            type="submit"
                            className="send-btn"
                            disabled={!inputText.trim() || !canChat}
                        >
                            <Send size={18} />
                        </button>
                    </form>
                    {/* Emoji Picker */}
                    {showEmojiPicker && (
                        <div className="emoji-picker">
                            {EMOJI_CATEGORIES.map(cat => (
                                <div key={cat.name} className="emoji-category">
                                    <div className="emoji-category-title">{cat.name}</div>
                                    <div className="emoji-grid">
                                        {cat.emojis.map(emoji => (
                                            <button key={emoji} className="emoji-btn" onClick={() => {
                                                setInputText(prev => prev + emoji);
                                            }}>{emoji}</button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Members Sidebar */}
            {activeServer && (
                <ServerMembers
                    isOpen={isMembersListOpen}
                    onClose={() => setIsMembersListOpen(false)}
                />
            )}
            {!activeServer && activeDM?.startsWith('group_') && (
                <GroupMembers
                    groupId={activeDM}
                    isOpen={isMembersListOpen}
                    onClose={() => setIsMembersListOpen(false)}
                />
            )}
        </div>
    );
};

// Memoized message row
const MessageRow = memo(({ msg, isMe, isConsecutive, avatarUrl, peerAvatars, formatTime, onReply, onReact, peerId, peerNames }: {
    msg: UserMessage; isMe: boolean; isConsecutive: boolean; avatarUrl: string; peerAvatars: Record<string, string>; formatTime: (t: number) => string;
    onReply: () => void; onReact: (emoji: string) => void; peerId: string; peerNames: Record<string, string>;
}) => {
    const [showActions, setShowActions] = useState(false);
    const msgAvatar = isMe ? avatarUrl : peerAvatars[msg.senderId];
    const reactions = msg.reactions || {};
    return (
        <div className={`message-container ${isConsecutive ? 'consecutive' : ''}`}
            onMouseEnter={() => setShowActions(true)}
            onMouseLeave={() => setShowActions(false)}
        >
            {(!isConsecutive) && (
                <div className="message-avatar" style={{ overflow: 'hidden', padding: 0 }}>
                    {msgAvatar ? (
                        <img src={msgAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                        msg.senderName ? msg.senderName.substring(0, 2).toUpperCase() : (isMe ? 'Y' : 'P')
                    )}
                </div>
            )}
            <div className="message-content">
                {!isConsecutive && (
                    <div className="message-header">
                        <span className="message-author">{msg.senderName || (isMe ? 'You' : 'Peer')}</span>
                        <span className="message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                )}
                {/* Reply Quote */}
                {msg.replyTo && (
                    <div className="reply-quote">
                        <span className="reply-quote-author">{msg.replyTo.senderName}</span>
                        <span className="reply-quote-text">{msg.replyTo.text.substring(0, 100)}</span>
                    </div>
                )}
                <div className="message-text">{msg.text}</div>
                {msg.file && <FileAttachment file={msg.file} />}
                {/* Reactions display */}
                {Object.keys(reactions).length > 0 && (
                    <div className="reactions-bar">
                        {Object.entries(reactions).map(([emoji, users]) => (
                            <button key={emoji} className={`reaction-pill ${users.includes(peerId) ? 'reacted' : ''}`}
                                onClick={() => onReact(emoji)}
                                title={users.map(u => peerNames[u] || u.substring(0, 6)).join(', ')}
                            >
                                {emoji} {users.length}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {/* Hover actions */}
            {showActions && (
                <div className="message-actions">
                    {QUICK_REACTIONS.map(emoji => (
                        <button key={emoji} className="action-btn" onClick={() => onReact(emoji)} title={emoji}>{emoji}</button>
                    ))}
                    <button className="action-btn" onClick={onReply} title="Reply"><Reply size={14} /></button>
                </div>
            )}
        </div>
    );
});

// Component to safely create and destroy ObjectURLs to avoid memory leaks
const FileAttachment: React.FC<{ file: NonNullable<UserMessage['file']> }> = ({ file }) => {
    const [objectUrl, setObjectUrl] = useState<string>('');
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    // Lazy render: only create blob when element is visible
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                observer.disconnect();
            }
        }, { rootMargin: '200px' });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!isVisible) return;
        try {
            const byteCharacters = atob(file.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: file.type });
            const url = URL.createObjectURL(blob);
            setObjectUrl(url);
            return () => URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Failed to parse file attachment", e);
        }
    }, [file, isVisible]);

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');

    if (isImage) {
        return (
            <div ref={containerRef} className="message-attachment image-attachment">
                {objectUrl ? (
                    <a href={objectUrl} target="_blank" rel="noreferrer">
                        <img src={objectUrl} alt={file.name} loading="lazy" />
                    </a>
                ) : <div className="media-placeholder" />}
            </div>
        );
    }

    if (isVideo) {
        return (
            <div ref={containerRef} className="message-attachment video-attachment">
                {objectUrl ? (
                    <>
                        <video src={objectUrl} controls preload="metadata" playsInline />
                        <div className="media-file-info">
                            <span className="file-name">{file.name}</span>
                            <a href={objectUrl} download={file.name} className="download-link">
                                <Download size={14} /> Download
                            </a>
                        </div>
                    </>
                ) : <div className="media-placeholder" />}
            </div>
        );
    }

    if (isAudio) {
        return (
            <div ref={containerRef} className="message-attachment audio-attachment">
                {objectUrl ? (
                    <>
                        <audio src={objectUrl} controls preload="metadata" />
                        <div className="media-file-info">
                            <span className="file-name">{file.name}</span>
                            <a href={objectUrl} download={file.name} className="download-link">
                                <Download size={14} /> Download
                            </a>
                        </div>
                    </>
                ) : <div className="media-placeholder" />}
            </div>
        );
    }

    return (
        <div ref={containerRef} className="message-attachment file-attachment">
            <div className="file-icon-wrap">
                <FileText size={32} />
            </div>
            <div className="file-info">
                <span className="file-name">{file.name}</span>
                {objectUrl && (
                    <a href={objectUrl} download={file.name} className="download-link">
                        <Download size={14} /> Download
                    </a>
                )}
            </div>
        </div>
    );
};
