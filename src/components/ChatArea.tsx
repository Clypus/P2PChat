import React, { useState, useRef, useEffect, memo, useCallback } from 'react';

import { usePeer, UserMessage } from '../context/PeerContext';
import { Send, Hash, Video, Phone, Info, PlusCircle, FileText, Download, Users, Menu, Smile, Reply, X, Search, Trash2, Edit3, Pin, ChevronUp, ChevronDown, Shield, AtSign, Crown, MinusCircle, Mic, Square } from 'lucide-react';
import { VideoGrid } from './VideoGrid';
import { ServerMembers } from './ServerMembers';
import { GroupMembers } from './GroupMembers';
import { UserProfileCard } from './UserProfileCard';
import './ChatArea.css';

const parseMarkdown = (text: string): string => {

    let result = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    result = result.replace(/@(everyone|here)/g, '<span class="mention mention-special">@$1</span>');
    result = result.replace(/@(\w[\w-]*)/g, '<span class="mention">@$1</span>');

    result = result.replace(
        /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s<]*)/g,
        '<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/$1" frameborder="0" allowfullscreen></iframe></div>'
    );

    result = result.replace(/(?<!")(https?:\/\/[^\s<"]+)/g, '<a href="$1" target="_blank" rel="noreferrer" class="message-link">$1</a>');

    result = result.replace(/\n/g, '<br>');
    return result;
};

const EMOJI_CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
    { name: 'Reactions', icon: '⭐', emojis: ['👍', '👎', '😂', '❤️', '🔥', '😮', '😢', '🎉', '🤔', '👀'] },
    { name: 'Smileys', icon: '😀', emojis: ['😀', '😄', '😁', '😅', '🤣', '😊', '😍', '🥰', '😘', '😜', '🤪', '😇'] },
    { name: 'Gestures', icon: '👋', emojis: ['👋', '👌', '✌️', '🤞', '🤘', '👏', '🙌', '🤝', '✊', '👊'] },
    { name: 'Hearts', icon: '❤️', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔'] },
    { name: 'Objects', icon: '💡', emojis: ['💡', '🎮', '🎵', '💻', '🔒', '⚡', '🌈', '☕'] },
];

const EMOJI_NAMES: Record<string, string[]> = {
    '👍': ['thumbsup', 'like', 'yes'], '👎': ['thumbsdown', 'dislike', 'no'], '😂': ['joy', 'laugh', 'lol', 'haha'],
    '❤️': ['heart', 'love', 'red heart'], '🔥': ['fire', 'hot', 'lit'], '😮': ['wow', 'surprised', 'omg'],
    '😢': ['cry', 'sad', 'tear'], '🎉': ['party', 'tada', 'celebrate'], '🤔': ['think', 'thinking', 'hmm'],
    '👀': ['eyes', 'look', 'see'], '😀': ['grin', 'grinning', 'happy'], '😄': ['smile', 'smiley'],
    '😍': ['heart eyes', 'love', 'crush'], '😘': ['kiss', 'blowing kiss'], '🤣': ['rofl', 'rolling'],
    '😊': ['blush', 'shy'], '😉': ['wink', 'winky'], '😜': ['tongue', 'crazy', 'wink tongue'],
    '🤪': ['zany', 'crazy', 'wild'], '😇': ['angel', 'innocent', 'halo'], '🥰': ['smiling hearts', 'love'],
    '👋': ['wave', 'hi', 'hello', 'bye'], '👌': ['ok', 'okay', 'perfect'], '✌️': ['peace', 'victory'],
    '🤘': ['rock', 'metal', 'horns'], '👏': ['clap', 'applause', 'bravo'], '🙌': ['raised hands', 'hooray'],
    '💡': ['idea', 'lightbulb', 'bulb'], '🎮': ['game', 'controller', 'gaming'], '🎵': ['music', 'note'],
    '💻': ['laptop', 'computer', 'pc'], '🔒': ['lock', 'secure', 'locked'], '🔑': ['key', 'unlock'],
    '🛡️': ['shield', 'security', 'protect'], '🍕': ['pizza'], '🍔': ['burger', 'hamburger'],
    '☕': ['coffee', 'tea', 'hot drink'], '🍺': ['beer', 'drink', 'cheers'], '🎂': ['birthday', 'cake'],
    '📱': ['phone', 'mobile', 'cell'], '📸': ['camera', 'photo'], '⚡': ['lightning', 'bolt', 'zap', 'electric'],
    '🌈': ['rainbow'], '🌊': ['wave', 'ocean', 'water', 'sea'],
    '🖤': ['black heart'], '💜': ['purple heart'], '💙': ['blue heart'], '💚': ['green heart'],
    '💛': ['yellow heart'], '🧡': ['orange heart'], '🤍': ['white heart'],
};
const QUICK_REACTIONS = ['👍', '👎', '❤️', '😂', '🔥', '😮', '🎉', '😢', '🤔', '👀'];

interface ChatAreaProps {
    onToggleMobileMenu?: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ onToggleMobileMenu }) => {
    const { messages, sendMessage, peerId, connections, startCall, activeServer, activeChannel, activeVoiceChannel, activeDM, knownPeers, avatarUrl, peerAvatars, groupDMs, localStream, remoteStreams, typingPeers, sendTypingIndicator, addReaction, peerNames, editMessage, deleteMessage, pinnedMessages, pinMessage, unpinMessage, peerStatuses, peerAboutMe, aboutMe, userStatus, activeCallDM } = usePeer();
    const [inputText, setInputText] = useState('');
    const [isMembersListOpen, setIsMembersListOpen] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [replyingTo, setReplyingTo] = useState<UserMessage | null>(null);
    const [emojiSearch, setEmojiSearch] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    const [searchResultIndex, setSearchResultIndex] = useState(0);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [isPinnedOpen, setIsPinnedOpen] = useState(false);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);
    const [profilePopup, setProfilePopup] = useState<{ userId: string, x: number, y: number } | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const isNearBottomRef = useRef(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const emojiToggleBtnRef = useRef<HTMLButtonElement>(null);

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            recordingChunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
                if (blob.size > 0 && recordingChunksRef.current.length > 0) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const base64 = (ev.target?.result as string).split(',')[1];
                        if (base64) {
                            sendMessage('', { name: `voice_${Date.now()}.webm`, type: 'audio/webm', data: base64 });
                        }
                    };
                    reader.readAsDataURL(blob);
                }
            };
            mediaRecorderRef.current = recorder;
            recorder.start();
            setIsRecording(true);
            setRecordingTime(0);
            recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
        } catch (err) {
            console.error('Microphone access denied:', err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null;
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        }
        recordingChunksRef.current = [];
        setIsRecording(false);
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    };

    useEffect(() => {
        if (!showEmojiPicker) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node) &&
                emojiToggleBtnRef.current && !emojiToggleBtnRef.current.contains(e.target as Node)
            ) {
                setShowEmojiPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showEmojiPicker]);

    const getMentionList = () => {
        const items: { name: string; id: string; avatar?: string }[] = [
            { name: 'everyone', id: 'everyone' },
            { name: 'here', id: 'here' },
        ];

        connections.forEach(c => {
            const name = peerNames[c.peer] || knownPeers[c.peer] || c.peer.substring(0, 10);
            items.push({ name, id: c.peer, avatar: peerAvatars[c.peer] });
        });
        if (mentionFilter) {
            return items.filter(i => i.name.toLowerCase().includes(mentionFilter));
        }
        return items;
    };

    const insertMention = (name: string) => {
        const cursorPos = document.querySelector<HTMLTextAreaElement>('.chat-input')?.selectionStart || inputText.length;
        const textBefore = inputText.substring(0, cursorPos);
        const textAfter = inputText.substring(cursorPos);
        const newBefore = textBefore.replace(/@\w*$/, `@${name} `);
        setInputText(newBefore + textAfter);
        setShowMentions(false);
    };

    const canChat = activeServer
        ? connections.length > 0
        : activeDM?.startsWith('group_')
            ? (groupDMs[activeDM]?.members || []).some(m => m !== peerId && connections.some(c => c.peer === m))
            : connections.some(c => c.peer === activeDM);

    const filteredMessages = activeServer
        ? messages.filter(msg => (msg.channelId || 'general') === activeChannel)
        : messages.filter(msg => {
            if (!activeDM) return false;
            if (activeDM.startsWith('group_')) {
                return msg.channelId === activeDM;
            }

            return (msg.senderId === activeDM && msg.channelId === peerId) ||
                (msg.senderId === peerId && msg.channelId === activeDM) ||
                (msg.senderId === activeDM && msg.channelId === activeDM);
        });

    useEffect(() => {
        if (isNearBottomRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [filteredMessages]);

    const handleMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (container) {
            const threshold = 150;
            isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
        }
    };

    const handleSend = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (inputText.trim() && canChat) {
            const parsed = parseMarkdown(inputText);
            sendMessage(parsed, undefined, replyingTo ? { id: replyingTo.id, senderName: replyingTo.senderName, text: replyingTo.text } : undefined);
            setInputText('');
            setReplyingTo(null);
            setShowEmojiPicker(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

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
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            alert(`File too large! Maximum size is 10MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
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

    const typingNames = Object.keys(typingPeers)
        .filter(id => id !== peerId)
        .map(id => peerNames[id] || knownPeers[id] || id.substring(0, 8));

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !canChat) return;

        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            alert(`File too large! Maximum size is 10MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
            e.target.value = '';
            return;
        }

        e.target.value = '';

        const reader = new FileReader();
        reader.onload = async (event) => {
            const result = event.target?.result as string;

            const base64Data = result.split(',')[1];

            if (base64Data) {
                sendMessage(inputText, {
                    name: file.name,
                    type: file.type,
                    data: base64Data
                });
                setInputText('');
            }
        };

        reader.readAsDataURL(file);
    };

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Only show video grid if there's an active call relevant to current view
    const showVideoGrid = activeServer
        ? activeChannel === 'Voice Lounge'
        : (!!localStream || Object.keys(remoteStreams).length > 0) && activeDM === activeCallDM;

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
                { }
                {isDragging && (
                    <div className="drag-overlay">
                        <div className="drag-overlay-content">
                            <PlusCircle size={48} />
                            <p>Drop file to send</p>
                        </div>
                    </div>
                )}
                { }
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
                                        if (activeDM?.startsWith('group_')) {
                                            const group = groupDMs[activeDM];
                                            if (group) group.members.filter(m => m !== peerId).forEach(m => {
                                                if (connections.some(c => c.peer === m)) startCall(m, false);
                                            });
                                        } else if (activeDM) {
                                            startCall(activeDM, false);
                                        }
                                    }}
                                >
                                    <Phone size={20} />
                                </button>
                                <button
                                    className="btn-icon"
                                    title="Start Video Call"
                                    disabled={!canChat}
                                    onClick={() => {
                                        if (activeDM?.startsWith('group_')) {
                                            const group = groupDMs[activeDM];
                                            if (group) group.members.filter(m => m !== peerId).forEach(m => {
                                                if (connections.some(c => c.peer === m)) startCall(m, true);
                                            });
                                        } else if (activeDM) {
                                            startCall(activeDM, true);
                                        }
                                    }}
                                >
                                    <Video size={20} />
                                </button>
                            </>
                        )}
                        <button className="btn-icon" title="Search Messages" onClick={() => setIsSearchOpen(!isSearchOpen)}>
                            <Search size={20} />
                        </button>
                        <button className={`btn-icon ${isPinnedOpen ? 'active' : ''}`} title="Pinned Messages" onClick={() => setIsPinnedOpen(!isPinnedOpen)}>
                            <Pin size={20} />
                        </button>
                        <button className={`btn-icon ${isInfoOpen ? 'active' : ''}`} title="Connection Info" onClick={() => setIsInfoOpen(!isInfoOpen)}>
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

                { }
                {isInfoOpen && (
                    <div className="info-panel">
                        <div className="info-panel-header">
                            <h4>Connection Info</h4>
                            <button className="btn-icon" onClick={() => setIsInfoOpen(false)} style={{ padding: 2 }}><X size={14} /></button>
                        </div>
                        <div className="info-panel-body">
                            <div className="info-row"><span className="info-label">Your Peer ID</span><span className="info-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>{peerId}</span></div>
                            <div className="info-row"><span className="info-label">Encryption</span><span className="info-value" style={{ color: 'var(--discord-green)' }}>🔒 E2E Encrypted (ECDH + AES-GCM)</span></div>
                            <div className="info-row"><span className="info-label">Active Connections</span><span className="info-value">{connections.length} peer{connections.length !== 1 ? 's' : ''}</span></div>
                            {activeServer && <div className="info-row"><span className="info-label">Server</span><span className="info-value">{activeServer.name}</span></div>}
                            {!activeServer && activeDM && (
                                <div className="info-row"><span className="info-label">Chatting with</span><span className="info-value">{activeDM.startsWith('group_') ? (groupDMs[activeDM]?.name || 'Group') : (knownPeers[activeDM] || activeDM.substring(0, 12))}</span></div>
                            )}
                            <div className="info-row"><span className="info-label">Protocol</span><span className="info-value">WebRTC (PeerJS)</span></div>
                        </div>
                    </div>
                )}

                { }
                {isPinnedOpen && (
                    <div className="pinned-messages-panel">
                        <div className="pinned-messages-header">
                            <h4><Pin size={14} /> Pinned Messages</h4>
                            <button className="btn-icon" onClick={() => setIsPinnedOpen(false)} style={{ padding: 2 }}><X size={14} /></button>
                        </div>
                        {pinnedMessages.length === 0 ? (
                            <div className="pinned-empty">No pinned messages yet. Right-click or hover over a message to pin it.</div>
                        ) : (
                            pinnedMessages.map(msgId => {
                                const msg = filteredMessages.find(m => m.id === msgId) || messages.find(m => m.id === msgId);
                                if (!msg) return null;
                                return (
                                    <div key={msgId} className="pinned-msg-item">
                                        <div className="pinned-msg-author">{msg.senderName || 'Unknown'}</div>
                                        <div className="pinned-msg-text" dangerouslySetInnerHTML={{ __html: msg.text }} />
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                            <span className="pinned-msg-time">{formatTime(msg.timestamp)}</span>
                                            <button className="btn-icon" onClick={() => unpinMessage(msgId)} title="Unpin" style={{ padding: 2 }}><X size={12} /></button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {isSearchOpen && (() => {
                    const searchResults = searchQuery ? filteredMessages.filter(m => m.text.replace(/<[^>]*>/g, '').toLowerCase().includes(searchQuery.toLowerCase())) : [];
                    const resultCount = searchResults.length;
                    return (
                        <div className="search-bar">
                            <Search size={16} />
                            <input
                                className="search-input"
                                placeholder="Search messages..."
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setSearchResultIndex(0); }}
                                autoFocus
                            />
                            {searchQuery && (
                                <>
                                    <span className="search-result-count">{resultCount > 0 ? `${searchResultIndex + 1}/${resultCount}` : '0 results'}</span>
                                    <button className="search-nav-btn" disabled={resultCount === 0} onClick={() => setSearchResultIndex(i => Math.max(0, i - 1))}><ChevronUp size={16} /></button>
                                    <button className="search-nav-btn" disabled={resultCount === 0} onClick={() => setSearchResultIndex(i => Math.min(resultCount - 1, i + 1))}><ChevronDown size={16} /></button>
                                </>
                            )}
                            <button className="btn-icon" onClick={() => { setSearchQuery(''); setIsSearchOpen(false); }} style={{ padding: 4 }}>
                                <X size={16} />
                            </button>
                        </div>
                    );
                })()}

                {/* Message List */}
                <div className={`message-list ${canChat ? 'active' : ''}`} ref={messagesContainerRef} onScroll={handleMessagesScroll}>
                    {filteredMessages.length === 0 ? (
                        <div className="empty-chat">
                            <div className="welcome-banner">
                                <div className="welcome-illustration">
                                    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <circle cx="60" cy="60" r="55" fill="var(--bg-tertiary, var(--discord-bg-tertiary))" stroke="var(--accent, var(--discord-blurple))" strokeWidth="2" opacity="0.3" />
                                        <rect x="25" y="35" width="45" height="30" rx="8" fill="var(--accent, var(--discord-blurple))" opacity="0.8" />
                                        <rect x="50" y="55" width="45" height="30" rx="8" fill="var(--bg-active, var(--discord-bg-active))" opacity="0.9" />
                                        <circle cx="35" cy="50" r="3" fill="white" opacity="0.9" />
                                        <circle cx="47" cy="50" r="3" fill="white" opacity="0.7" />
                                        <circle cx="59" cy="50" r="3" fill="white" opacity="0.5" />
                                        <circle cx="62" cy="70" r="3" fill="var(--text-muted, var(--discord-text-muted))" opacity="0.9" />
                                        <circle cx="74" cy="70" r="3" fill="var(--text-muted, var(--discord-text-muted))" opacity="0.7" />
                                        <circle cx="86" cy="70" r="3" fill="var(--text-muted, var(--discord-text-muted))" opacity="0.5" />
                                    </svg>
                                    <div className="welcome-glow" />
                                </div>
                                <h1>Welcome to {activeServer ? `#${titleName}` : titleName}!</h1>
                                <p className="welcome-subtitle">This is the start of an end-to-end encrypted P2P channel.</p>
                                {!canChat && (
                                    <div className="welcome-hint">
                                        <span className="hint-icon">💬</span>
                                        <p>Connect to a friend using the sidebar to start chatting.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        (searchQuery
                            ? filteredMessages.filter(m => m.text.replace(/<[^>]*>/g, '').toLowerCase().includes(searchQuery.toLowerCase()))
                            : filteredMessages
                        ).map((msg, index, arr) => {
                            const isMe = msg.senderId === peerId;
                            const isConsecutive = index > 0 && arr[index - 1].senderId === msg.senderId;
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
                                    onEdit={(newText) => editMessage(msg.id, newText)}
                                    onDelete={() => deleteMessage(msg.id)}
                                    onPin={() => pinnedMessages.includes(msg.id) ? unpinMessage(msg.id) : pinMessage(msg.id)}
                                    isPinned={pinnedMessages.includes(msg.id)}
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
                <div className="chat-input-area" style={{ position: 'relative' }}>
                    { }
                    {showMentions && (
                        <div className="mention-autocomplete">
                            {getMentionList().map((item, idx) => (
                                <div
                                    key={item.id}
                                    className={`mention-item ${idx === mentionIndex ? 'active' : ''}`}
                                    onClick={() => insertMention(item.name)}
                                    onMouseEnter={() => setMentionIndex(idx)}
                                >
                                    <div className="mention-avatar">
                                        {item.avatar ? <img src={item.avatar} alt="" /> : (item.id === 'everyone' ? '👥' : item.id === 'here' ? '📢' : item.name.substring(0, 2).toUpperCase())}
                                    </div>
                                    <span className="mention-name">@{item.name}</span>
                                    {item.id !== 'everyone' && item.id !== 'here' && <span className="mention-id">{item.id.substring(0, 8)}</span>}
                                </div>
                            ))}
                            {getMentionList().length === 0 && <div className="mention-item" style={{ color: 'var(--discord-text-muted)' }}>No matches</div>}
                        </div>
                    )}
                    { }
                    {replyingTo && (
                        <div className="reply-preview">
                            <Reply size={14} />
                            <span>Replying to <strong>{replyingTo.senderName}</strong>: {replyingTo.text.substring(0, 80)}{replyingTo.text.length > 80 ? '...' : ''}</span>
                            <button className="reply-close" onClick={() => setReplyingTo(null)}><X size={14} /></button>
                        </div>
                    )}
                    {isRecording && (
                        <div className="recording-indicator">
                            <div className="recording-dot" />
                            <span>Recording... {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
                            <button type="button" className="btn-icon" onClick={cancelRecording} title="Cancel recording" style={{ marginLeft: 'auto', color: 'var(--discord-red)' }}>
                                <X size={16} />
                            </button>
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
                        <textarea
                            className="chat-input"
                            placeholder={canChat ? `Message ${activeServer ? '#' : '@'}${titleName}` : "Connect to a peer to send messages..."}
                            value={inputText}
                            onChange={(e) => {
                                const val = e.target.value;
                                setInputText(val);
                                sendTypingIndicator();
                                // @mention detection
                                const cursorPos = e.target.selectionStart || 0;
                                const textBefore = val.substring(0, cursorPos);
                                const mentionMatch = textBefore.match(/@(\w*)$/);
                                if (mentionMatch) {
                                    setShowMentions(true);
                                    setMentionFilter(mentionMatch[1].toLowerCase());
                                    setMentionIndex(0);
                                } else {
                                    setShowMentions(false);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (showMentions) {
                                    const mentionables = getMentionList();
                                    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(mentionables.length - 1, i + 1)); return; }
                                    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(0, i - 1)); return; }
                                    if (e.key === 'Tab' || e.key === 'Enter') {
                                        if (mentionables[mentionIndex]) {
                                            e.preventDefault();
                                            insertMention(mentionables[mentionIndex].name);
                                            return;
                                        }
                                    }
                                    if (e.key === 'Escape') { setShowMentions(false); return; }
                                }
                                handleKeyDown(e);
                            }}
                            disabled={!canChat}
                            rows={1}
                        />
                        <button
                            ref={emojiToggleBtnRef}
                            type="button"
                            className={`emoji-toggle-btn ${showEmojiPicker ? 'active' : ''}`}
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            disabled={!canChat}
                            title="Emoji"
                        >
                            <Smile size={20} />
                        </button>
                        {inputText.trim() ? (
                            <button
                                type="submit"
                                className="send-btn"
                                disabled={!canChat}
                            >
                                <Send size={18} />
                            </button>
                        ) : (
                            <button
                                type="button"
                                className={`voice-record-btn ${isRecording ? 'recording' : ''}`}
                                disabled={!canChat}
                                onClick={() => isRecording ? stopRecording() : startRecording()}
                                title={isRecording ? 'Stop recording' : 'Record voice message'}
                            >
                                {isRecording ? <Square size={18} /> : <Mic size={18} />}
                            </button>
                        )}
                    </form>
                    {showEmojiPicker && (
                        <div className="emoji-picker" ref={emojiPickerRef}>
                            <div className="emoji-tabs">
                                {EMOJI_CATEGORIES.map(cat => (
                                    <button
                                        key={cat.name}
                                        className={`emoji-tab ${!emojiSearch && emojiSearch === '' ? '' : ''}`}
                                        title={cat.name}
                                        onClick={() => {
                                            setEmojiSearch('');
                                            document.getElementById(`emoji-cat-${cat.name}`)?.scrollIntoView({ behavior: 'smooth' });
                                        }}
                                    >
                                        {cat.icon}
                                    </button>
                                ))}
                            </div>
                            <input
                                className="emoji-search-input"
                                placeholder="Search emoji... (e.g. heart, fire, smile)"
                                value={emojiSearch}
                                onChange={(e) => setEmojiSearch(e.target.value)}
                            />
                            <div className="emoji-scroll-area">
                                {EMOJI_CATEGORIES.map(cat => {
                                    const q = emojiSearch.toLowerCase();
                                    const filtered = q
                                        ? cat.emojis.filter(e =>
                                            e.includes(q) ||
                                            (EMOJI_NAMES[e] && EMOJI_NAMES[e].some(n => n.includes(q)))
                                        )
                                        : cat.emojis;
                                    if (filtered.length === 0) return null;
                                    return (
                                        <div key={cat.name} className="emoji-category" id={`emoji-cat-${cat.name}`}>
                                            <div className="emoji-category-title">{cat.name}</div>
                                            <div className="emoji-grid">
                                                {filtered.map(emoji => (
                                                    <button key={emoji} className="emoji-btn" onClick={() => {
                                                        setInputText(prev => prev + emoji);
                                                    }}>{emoji}</button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Members Sidebar */}
            {activeServer && isMembersListOpen && (
                <ServerMembers
                    isOpen={isMembersListOpen}
                    onClose={() => setIsMembersListOpen(false)}
                />
            )}
            {!activeServer && activeDM?.startsWith('group_') && isMembersListOpen && (
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
const MessageRow = memo(({ msg, isMe, isConsecutive, avatarUrl, peerAvatars, formatTime, onReply, onReact, onEdit, onDelete, onPin, isPinned, peerId, peerNames }: {
    msg: UserMessage; isMe: boolean; isConsecutive: boolean; avatarUrl: string; peerAvatars: Record<string, string>; formatTime: (t: number) => string;
    onReply: () => void; onReact: (emoji: string) => void; onEdit: (newText: string) => void; onDelete: () => void; onPin: () => void; isPinned: boolean; peerId: string; peerNames: Record<string, string>;
}) => {
    const [showActions, setShowActions] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');
    const [showProfileCard, setShowProfileCard] = useState(false);
    const msgAvatar = isMe ? avatarUrl : peerAvatars[msg.senderId];
    const reactions = msg.reactions || {};
    return (
        <div className={`message-container ${isConsecutive ? 'consecutive' : ''}`}
            onMouseEnter={() => setShowActions(true)}
            onMouseLeave={() => setShowActions(false)}
        >
            {(!isConsecutive) && (
                <div className="message-avatar" style={{ overflow: 'hidden', padding: 0, cursor: 'pointer' }} onClick={() => setShowProfileCard(true)}>
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
                        <span className="message-author" style={{ cursor: 'pointer' }} onClick={() => setShowProfileCard(true)}>{msg.senderName || (isMe ? 'You' : 'Peer')}</span>
                        <span className="message-time">{formatTime(msg.timestamp)}</span>
                        {isPinned && <span className="pin-indicator" title="Pinned"><Pin size={12} /></span>}
                    </div>
                )}
                {/* Reply Quote */}
                {msg.replyTo && (
                    <div className="reply-quote">
                        <span className="reply-quote-author">{msg.replyTo.senderName}</span>
                        <span className="reply-quote-text">{msg.replyTo.text.substring(0, 100)}</span>
                    </div>
                )}
                {isEditing ? (
                    <div className="edit-input-container">
                        <input
                            className="edit-input"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { onEdit(parseMarkdown(editText)); setIsEditing(false); }
                                if (e.key === 'Escape') setIsEditing(false);
                            }}
                            autoFocus
                        />
                        <span className="edit-hint">Escape to cancel • Enter to save</span>
                    </div>
                ) : (
                    <>
                        <div className="message-text" dangerouslySetInnerHTML={{ __html: msg.text }} />
                        {(msg as any).edited && <span className="edited-indicator">(edited)</span>}
                    </>
                )}
                {msg.file && <FileAttachment file={msg.file} />}
                { }
                {Object.keys(reactions).length > 0 && (
                    <div className="reactions-bar">
                        {Object.entries(reactions).map(([emoji, users]) => {
                            const userList = Array.isArray(users) ? users : [];
                            return (
                                <button key={emoji} className={`reaction-pill ${userList.includes(peerId) ? 'reacted' : ''}`}
                                    onClick={() => onReact(emoji)}
                                    title={userList.map(u => peerNames[u] || u.substring(0, 6)).join(', ')}
                                >
                                    {emoji} {userList.length}
                                </button>
                            );
                        })}
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
                    <button className={`action-btn pin-btn ${isPinned ? 'pinned' : ''}`} onClick={onPin} title={isPinned ? 'Unpin' : 'Pin'}><Pin size={14} /></button>
                    {isMe && (
                        <>
                            <button className="action-btn" onClick={() => { setEditText(msg.text.replace(/<[^>]*>/g, '')); setIsEditing(true); }} title="Edit"><Edit3 size={14} /></button>
                            <button className="action-btn delete-btn" onClick={onDelete} title="Delete"><Trash2 size={14} /></button>
                        </>
                    )}
                </div>
            )}
            {showProfileCard && (
                <UserProfileCard userId={msg.senderId} onClose={() => setShowProfileCard(false)} />
            )}
        </div>
    );
});

const FileAttachment: React.FC<{ file: NonNullable<UserMessage['file']> }> = ({ file }) => {
    const [objectUrl, setObjectUrl] = useState<string>('');
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

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
