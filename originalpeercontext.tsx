import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey, encryptMessage, decryptMessage } from '../crypto';

export type UserMessage = {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
    timestamp: number;
    channelId?: string;
    file?: {
        name: string;
        type: string;
        data: string;
    };
    replyTo?: {
        id: string;
        senderName: string;
        text: string;
    };
    reactions?: Record<string, string[]>;
};

export type AudioSettings = {
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
    deviceId?: string;
};

interface PeerContextType {
    peerId: string;
    displayName: string;
    setDisplayName: (name: string) => void;
    avatarUrl: string;
    setAvatarUrl: (url: string) => void;
    peer: Peer | null;
    connections: DataConnection[];
    serverMembers: Set<string>;
    peerNames: Record<string, string>;
    peerAvatars: Record<string, string>;
    knownPeers: Record<string, string>;
    messages: UserMessage[];
    connectToPeer: (id: string) => void;
    sendMessage: (text: string, file?: UserMessage['file'], replyTo?: UserMessage['replyTo']) => void;
    error: string | null;

    localStream: MediaStream | null;
    remoteStreams: { [peerId: string]: MediaStream };
    startCall: (id: string, withVideo: boolean) => void;
    endCall: (id: string) => void;
    endAllCalls: () => void;
    toggleMute: () => void;
    toggleDeafen: () => void;
    toggleVideo: () => void;
    toggleScreenShare: () => void;
    isMuted: boolean;
    isDeafened: boolean;
    isVideoEnabled: boolean;
    isScreenSharing: boolean;
    peerVoiceStates: Record<string, { muted: boolean, deafened: boolean }>;

    audioSettings: AudioSettings;
    updateAudioSettings: (settings: Partial<AudioSettings>) => void;

    incomingCall: MediaConnection | null;
    incomingCallIsVideo: boolean;
    answerCall: () => void;
    rejectCall: () => void;

    joinedServers: { id: string, name: string }[];
    activeServer: { id: string, name: string } | null;
    createServer: (name: string) => void;
    joinServer: (id: string, name: string) => void;
    switchServer: (id: string | null) => void;

    activeChannel: string;
    setActiveChannel: (id: string) => void;
    activeVoiceChannel: string | null;
    setActiveVoiceChannel: (id: string | null) => void;

    activeDM: string | null;
    setActiveDM: (id: string | null) => void;
    groupDMs: Record<string, { id: string, name: string, members: string[] }>;
    createGroupDM: (name: string, members: string[]) => void;
    addGroupMember: (groupId: string, memberId: string) => void;

    killSwitchKeyword: string;
    setKillSwitchKeyword: (keyword: string) => void;

    typingPeers: Record<string, number>;
    sendTypingIndicator: () => void;

    addReaction: (messageId: string, emoji: string) => void;
}

const PeerContext = createContext<PeerContextType | undefined>(undefined);

interface PeerProviderProps {
    children: ReactNode;
    initialId: string;
    displayName: string;
}

export const PeerProvider: React.FC<PeerProviderProps> = ({ children, initialId, displayName }) => {
    const [peerId, setPeerId] = useState<string>('');
    const [currentDisplayName, setCurrentDisplayName] = useState(displayName);
    const [avatarUrl, setAvatarUrl] = useState<string>(() => {
        const saved = localStorage.getItem('p2p_chat_identity');
        if (saved) {
            try { return JSON.parse(saved).avatarUrl || ''; } catch (e) { return ''; }
        }
        return '';
    });
    const [peer, setPeer] = useState<Peer | null>(null);
    const [connections, setConnections] = useState<DataConnection[]>([]);
    const connectionsRef = useRef<DataConnection[]>([]);
    const pendingConnectionsRef = useRef<Set<string>>(new Set());
    const failedPeersRef = useRef<Record<string, number>>({});
    const FAILED_PEER_COOLDOWN = 30000; 

    const serverMembersRef = useRef<Set<string>>(new Set());
    const [serverMembers, setServerMembers] = useState<Set<string>>(new Set());

    const localStreamRef = useRef<MediaStream | null>(null);
    const [peerNames, setPeerNames] = useState<Record<string, string>>({});
    const [peerAvatars, setPeerAvatars] = useState<Record<string, string>>({});
    const [knownPeers, setKnownPeers] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('p2p_chat_friends');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { return {}; }
        }
        return {};
    });

    const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => {
        const saved = localStorage.getItem('p2p_chat_audio_settings');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { }
        }
        return {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true
        };
    });

    const updateAudioSettings = async (newSettings: Partial<AudioSettings>) => {
        const updated = { ...audioSettings, ...newSettings };
        setAudioSettings(updated);
        localStorage.setItem('p2p_chat_audio_settings', JSON.stringify(updated));

        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                try {
                    await audioTrack.applyConstraints({
                        noiseSuppression: updated.noiseSuppression,
                        echoCancellation: updated.echoCancellation,
                        autoGainControl: updated.autoGainControl
                    });
                } catch (e) {
                    console.warn("Could not apply audio constraints live", e);
                }
            }
        }
    };
    const [activeServer, setActiveServer] = useState<{ id: string, name: string } | null>(null);
    const activeServerRef = useRef<{ id: string, name: string } | null>(null);
    const [joinedServers, setJoinedServers] = useState<{ id: string, name: string }[]>(() => {
        const saved = localStorage.getItem('p2p_chat_servers');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { return []; }
        }
        return [];
    });

    const [activeChannel, setActiveChannel] = useState<string>('general');
    const [activeVoiceChannel, setActiveVoiceChannel] = useState<string | null>(null);
    const [activeDM, setActiveDM] = useState<string | null>(null);

    const [killSwitchKeyword, setKillSwitchKeywordState] = useState<string>(() => {
        const saved = localStorage.getItem('p2p_chat_kill_switch');
        return saved || 'papatya';
    });
    const killSwitchRef = useRef(killSwitchKeyword);
    const setKillSwitchKeyword = (keyword: string) => {
        const trimmed = keyword.trim() || 'papatya';
        setKillSwitchKeywordState(trimmed);
        killSwitchRef.current = trimmed;
        localStorage.setItem('p2p_chat_kill_switch', trimmed);
    };

    const historyKey = activeServer ? `p2p_chat_history_${activeServer.id}` : 'p2p_chat_history_home';

    const MAX_MESSAGES = 500;

    const [messages, setMessagesRaw] = useState<UserMessage[]>(() => {
        const saved = localStorage.getItem('p2p_chat_history_home');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return parsed.slice(-MAX_MESSAGES);
            } catch (e) { return []; }
        }
        return [];
    });

    const setMessages = (updater: UserMessage[] | ((prev: UserMessage[]) => UserMessage[])) => {
        setMessagesRaw(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
    };

    const [error, setError] = useState<string | null>(null);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            localStorage.setItem(historyKey, JSON.stringify(messages));
        }, 2000);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [messages, historyKey]);

    useEffect(() => {
        localStorage.setItem('p2p_chat_servers', JSON.stringify(joinedServers));
    }, [joinedServers]);

    useEffect(() => {
        localStorage.setItem('p2p_chat_friends', JSON.stringify(knownPeers));
    }, [knownPeers]);

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<{ [peerId: string]: MediaStream }>({});
    const [incomingCall, setIncomingCall] = useState<MediaConnection | null>(null);
    const [incomingCallIsVideo, setIncomingCallIsVideo] = useState<boolean>(true);
    const mediaConnectionsRef = useRef<{ [peerId: string]: MediaConnection }>({});
    const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);

    const e2eKeyPairRef = useRef<CryptoKeyPair | null>(null);
    const e2eSharedKeysRef = useRef<Record<string, CryptoKey>>({});
    const e2eKeyExchangeInProgressRef = useRef<Set<string>>(new Set());
    const e2ePendingQueuesRef = useRef<Record<string, any[]>>({});

    useEffect(() => {
        generateKeyPair().then(kp => {
            e2eKeyPairRef.current = kp;
            console.log('[E2E] \u{1F511} ECDH key pair generated');
        });
    }, []);

    const [isMuted, setIsMuted] = useState(false);
    const [isDeafened, setIsDeafened] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [peerVoiceStates, setPeerVoiceStates] = useState<Record<string, { muted: boolean, deafened: boolean }>>({});

    const [groupDMs, setGroupDMs] = useState<Record<string, { id: string, name: string, members: string[] }>>(() => {
        const saved = localStorage.getItem('p2p_chat_groups');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        
        const stream = localStreamRef.current;
        if (stream) {
            stream.getAudioTracks().forEach(t => {
                t.enabled = !isMuted && !isDeafened;
            });
        }
        
        connectionsRef.current.forEach(c => {
            if (c.open) c.send({ type: 'voice_state', payload: { muted: isMuted, deafened: isDeafened } });
        });
    }, [isMuted, isDeafened, localStream]);

    useEffect(() => {
        
        const newPeer = new Peer(initialId, {
            debug: 2
        });

        newPeer.on('open', (id) => {
            console.log('My peer ID is: ' + id);
            setPeerId(id);
            setPeer(newPeer);
        });

        newPeer.on('connection', (conn) => {
            setupConnection(conn, true); 
        });

        newPeer.on('call', (call) => {
            
            const isVideo = call.metadata?.withVideo !== false;
            setIncomingCallIsVideo(isVideo);
            setIncomingCall(call);

            call.on('close', () => {
                setIncomingCall(prev => {
                    if (prev && prev.peer === call.peer) return null;
                    return prev;
                });
            });
        });

        newPeer.on('error', (err) => {
            
            const msg = err.message || '';
            if (err.type === 'peer-unavailable' || msg.includes('WebSocket is closed') || msg.includes('Lost connection') || msg.includes('Cannot connect to new Peer')) {
                return;
            }
            console.error('Peer error:', err);
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        });

        return () => {
            newPeer.destroy();
        };
    }, [initialId]); 

    const processDecryptedMessage = async (conn: DataConnection, data: any, sharedKey: CryptoKey) => {
        try {
            const decrypted = await decryptMessage(sharedKey, data.payload.iv, data.payload.ciphertext);
            const innerData = JSON.parse(decrypted);
            
            if (innerData.type === 'message') {
                setMessages(prev => {
                    const updated = [...prev, innerData.payload];
                    const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                    localStorage.setItem(`p2p_chat_history_${activeChannelId}`, JSON.stringify(updated));
                    return updated;
                });
            }
        } catch (err) {
            console.error('[E2E] Failed to process decrypted message:', err);
        }
    };

    const e2eSend = async (conn: DataConnection, messageData: any) => {
        const sharedKey = e2eSharedKeysRef.current[conn.peer];
        if (sharedKey) {
            try {
                const plaintext = JSON.stringify(messageData);
                const encrypted = await encryptMessage(sharedKey, plaintext);
                conn.send({ type: 'e2e_message', payload: encrypted });
                return;
            } catch (err) {
                console.error('[E2E] Encryption failed, sending plaintext:', err);
            }
        }
        
        conn.send(messageData);
    };

    const setupConnection = (conn: DataConnection, isIncoming: boolean = false) => {
        
        if (isIncoming && conn.metadata?.displayName) {
            setPeerNames(prev => ({ ...prev, [conn.peer]: conn.metadata.displayName }));
            setKnownPeers(prev => ({ ...prev, [conn.peer]: conn.metadata.displayName }));
            if (conn.metadata.avatarUrl) {
                setPeerAvatars(prev => ({ ...prev, [conn.peer]: conn.metadata.avatarUrl }));
            }
        }

        conn.on('open', async () => {
            
            pendingConnectionsRef.current.delete(conn.peer);
            
            delete failedPeersRef.current[conn.peer];

            const existingConn = connectionsRef.current.find(c => c.peer === conn.peer);
            if (existingConn) {
                
                console.log(`[P2P] Duplicate connection to ${conn.peer}, closing new one`);
                conn.close();
                return;
            }

            setConnections(prev => {
                if (!prev.find(c => c.peer === conn.peer)) {
                    const newConns = [...prev, conn];
                    connectionsRef.current = newConns;
                    
                    return newConns;
                }
                return prev;
            });

            if (e2eKeyPairRef.current && !e2eSharedKeysRef.current[conn.peer] && !e2eKeyExchangeInProgressRef.current.has(conn.peer)) {
                e2eKeyExchangeInProgressRef.current.add(conn.peer);
                const pubKeyJwk = await exportPublicKey(e2eKeyPairRef.current.publicKey);
                conn.send({ type: 'e2e_pubkey', payload: pubKeyJwk });
                console.log(`[E2E] 🔑 Sent public key to ${conn.peer}`);
            }

            conn.send({ type: 'identity', payload: { name: currentDisplayName, avatarUrl } });

            conn.send({ type: 'voice_state', payload: { muted: isMuted, deafened: isDeafened } });

            setMessages(currentMessages => {
                const latestTimestamp = currentMessages.length > 0
                    ? Math.max(...currentMessages.map(m => m.timestamp))
                    : 0;
                const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                conn.send({ type: 'sync_request', payload: { timestamp: latestTimestamp, channel: activeChannelId } });
                return currentMessages; 
            });
        });

        conn.on('data', async (data: any) => {
            
            if (data.type === 'e2e_pubkey') {
                try {
                    const peerPubKey = await importPublicKey(data.payload);
                    if (e2eKeyPairRef.current) {
                        const sharedKey = await deriveSharedKey(e2eKeyPairRef.current.privateKey, peerPubKey);
                        e2eSharedKeysRef.current[conn.peer] = sharedKey;
                        console.log(`[E2E] 🔐 Shared key derived with ${conn.peer}`);

                        const queue = e2ePendingQueuesRef.current[conn.peer];
                        if (queue && queue.length > 0) {
                            console.log(`[E2E] Processing ${queue.length} queued messages from ${conn.peer}`);
                            for (const queuedData of queue) {
                                await processDecryptedMessage(conn, queuedData, sharedKey);
                            }
                            delete e2ePendingQueuesRef.current[conn.peer];
                        }
                    }
                } catch (err) {
                    console.error('[E2E] Key exchange failed:', err);
                }
                return;
            }

            if (data.type === 'e2e_message') {
                const sharedKey = e2eSharedKeysRef.current[conn.peer];
                if (!sharedKey) {
                    
                    if (!e2ePendingQueuesRef.current[conn.peer]) {
                        e2ePendingQueuesRef.current[conn.peer] = [];
                    }
                    e2ePendingQueuesRef.current[conn.peer].push(data);
                    console.log(`[E2E] ⏳ Queued encrypted message from ${conn.peer} (waiting for key exchange)`);
                    return;
                }
                try {
                    await processDecryptedMessage(conn, data, sharedKey);
                } catch (err) {
                    console.error('[E2E] Decryption failed:', err);
                }
                return;
            }

            if (data.type === 'message') {
                setMessages(prev => {
                    const updated = [...prev, data.payload];
                    const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                    localStorage.setItem(`p2p_chat_history_${activeChannelId}`, JSON.stringify(updated));
                    return updated;
                });
            } else if (data.type === 'identity') {
                const { name, avatarUrl: remoteAvatarUrl } = data.payload;
                setPeerNames(prev => ({ ...prev, [conn.peer]: name }));
                setKnownPeers(prev => ({ ...prev, [conn.peer]: name }));
                if (remoteAvatarUrl) {
                    setPeerAvatars(prev => ({ ...prev, [conn.peer]: remoteAvatarUrl }));
                }
            } else if (data.type === 'voice_state') {
                setPeerVoiceStates(prev => ({ ...prev, [conn.peer]: data.payload }));
            } else if (data.type === 'group_invite') {
                const groupData = data.payload;
                setGroupDMs(prev => {
                    const next = { ...prev, [groupData.id]: groupData };
                    localStorage.setItem('p2p_chat_groups', JSON.stringify(next));
                    return next;
                });
            } else if (data.type === 'sync_request') {
                
                const { timestamp: requestTimestamp, channel: requestChannel } = data.payload;

                const saved = localStorage.getItem(`p2p_chat_history_${requestChannel}`);
                let historyToSync: UserMessage[] = [];
                if (saved) {
                    try { historyToSync = JSON.parse(saved); } catch (e) { }
                } else if (requestChannel === (activeServerRef.current ? activeServerRef.current.id : 'home')) {
                    
                    setMessages(currentMessages => { historyToSync = currentMessages; return currentMessages; });
                }

                const newerMessages = historyToSync.filter(m => m.timestamp > requestTimestamp);
                if (newerMessages.length > 0) {
                    conn.send({ type: 'sync_response', payload: { messages: newerMessages, channel: requestChannel } });
                }
            } else if (data.type === 'server_join') {
                
                const { serverId } = data.payload;
                if (activeServerRef.current && activeServerRef.current.id === peerId && serverId === peerId) {
                    
                    serverMembersRef.current.add(conn.peer);
                    setServerMembers(new Set(serverMembersRef.current));
                    console.log(`[Server] ${conn.peer} joined server. Members:`, Array.from(serverMembersRef.current));

                    const memberIds = Array.from(serverMembersRef.current);
                    connectionsRef.current.forEach(c => {
                        if (c.open && serverMembersRef.current.has(c.peer)) {
                            c.send({ type: 'room_peers', payload: memberIds });
                        }
                    });
                }
            } else if (data.type === 'server_leave') {
                
                if (activeServerRef.current && activeServerRef.current.id === peerId) {
                    serverMembersRef.current.delete(conn.peer);
                    setServerMembers(new Set(serverMembersRef.current));
                    console.log(`[Server] ${conn.peer} left server. Members:`, Array.from(serverMembersRef.current));

                    const memberIds = Array.from(serverMembersRef.current);
                    connectionsRef.current.forEach(c => {
                        if (c.open && serverMembersRef.current.has(c.peer)) {
                            c.send({ type: 'room_peers', payload: memberIds });
                        }
                    });
                }
            } else if (data.type === 'room_peers') {
                
                const roomPeers = data.payload as string[];

                const newMembers = new Set<string>(roomPeers);
                
                if (activeServerRef.current) {
                    newMembers.add(activeServerRef.current.id);
                }
                serverMembersRef.current = newMembers;
                setServerMembers(new Set(newMembers));

                roomPeers.forEach(id => {
                    
                    const alreadyConnected = connectionsRef.current.some(c => c.peer === id);
                    const isPending = pendingConnectionsRef.current.has(id);
                    const failedAt = failedPeersRef.current[id];
                    const isCoolingDown = failedAt && (Date.now() - failedAt < FAILED_PEER_COOLDOWN);

                    if (id !== peerId && !alreadyConnected && !isPending && !isCoolingDown) {
                        
                        if (peerId < id) {
                            connectToPeer(id, true);
                        }
                        
                    }
                });
            } else if (data.type === 'sync_response') {
                
                const { messages: newMessages, channel: responseChannel } = data.payload as { messages: UserMessage[], channel: string };

                const currentActiveChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                if (currentActiveChannelId === responseChannel) {
                    setMessages(prev => {
                        const merged = [...prev];
                        let added = false;
                        newMessages.forEach(newMsg => {
                            if (!merged.some(m => m.id === newMsg.id)) {
                                merged.push(newMsg);
                                added = true;
                            }
                        });
                        if (added) {
                            merged.sort((a, b) => a.timestamp - b.timestamp);
                            localStorage.setItem(`p2p_chat_history_${currentActiveChannelId}`, JSON.stringify(merged));
                        }
                        return merged;
                    });
                } else {
                    
                    const saved = localStorage.getItem(`p2p_chat_history_${responseChannel}`);
                    let bgHistory: UserMessage[] = [];
                    if (saved) {
                        try { bgHistory = JSON.parse(saved); } catch (e) { }
                    }
                    let added = false;
                    newMessages.forEach(newMsg => {
                        if (!bgHistory.some(m => m.id === newMsg.id)) {
                            bgHistory.push(newMsg);
                            added = true;
                        }
                    });
                    if (added) {
                        bgHistory.sort((a, b) => a.timestamp - b.timestamp);
                        localStorage.setItem(`p2p_chat_history_${responseChannel}`, JSON.stringify(bgHistory));
                    }
                }
            } else if (data.type === 'clear_chat') {
                
                const channelToClear = data.payload?.channelId;
                if (channelToClear) {
                    localStorage.removeItem(`p2p_chat_history_${channelToClear}`);
                    const currentActiveChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                    if (currentActiveChannelId === channelToClear) {
                        setMessages([]);
                    }
                } else {
                    
                    const currentActiveChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                    localStorage.removeItem(`p2p_chat_history_${currentActiveChannelId}`);
                    setMessages([]);
                }
            } else if (data.type === 'typing') {
                
                setTypingPeers(prev => ({ ...prev, [conn.peer]: Date.now() }));
            } else if (data.type === 'reaction') {
                
                const { messageId, emoji, userId } = data.payload;
                setMessagesRaw(prev => prev.map(msg => {
                    if (msg.id !== messageId) return msg;
                    const reactions = { ...(msg.reactions || {}) };
                    if (!reactions[emoji]) reactions[emoji] = [];
                    if (!reactions[emoji].includes(userId)) {
                        reactions[emoji] = [...reactions[emoji], userId];
                    } else {
                        reactions[emoji] = reactions[emoji].filter(id => id !== userId);
                        if (reactions[emoji].length === 0) delete reactions[emoji];
                    }
                    return { ...msg, reactions };
                }));
            }

            if (data.type === 'message' || data.type === 'e2e_message') {
                if (document.hidden && Notification.permission === 'granted') {
                    const senderName = peerNames[conn.peer] || conn.peer.substring(0, 8);
                    new Notification(`${senderName}`, {
                        body: data.type === 'message' ? (data.payload?.text || 'Sent a file') : 'New message',
                        icon: peerAvatars[conn.peer] || undefined,
                        tag: 'p2pchat-msg'
                    });
                }
            }
        });

        conn.on('close', () => {
            
            pendingConnectionsRef.current.delete(conn.peer);
            e2eKeyExchangeInProgressRef.current.delete(conn.peer);
            delete e2eSharedKeysRef.current[conn.peer];
            delete e2ePendingQueuesRef.current[conn.peer];

            if (serverMembersRef.current.has(conn.peer)) {
                serverMembersRef.current.delete(conn.peer);
                setServerMembers(new Set(serverMembersRef.current));
            }

            setConnections(prev => {
                const updated = prev.filter(c => c.peer !== conn.peer);
                connectionsRef.current = updated;
                
                if (activeServerRef.current && activeServerRef.current.id === peerId) {
                    const memberIds = Array.from(serverMembersRef.current);
                    updated.forEach(c => {
                        if (c.open && serverMembersRef.current.has(c.peer)) {
                            c.send({ type: 'room_peers', payload: memberIds });
                        }
                    });
                }
                return updated;
            });
        });

        conn.on('error', (err) => {
            console.warn("Connection error with", conn.peer, err);
            
            failedPeersRef.current[conn.peer] = Date.now();
            pendingConnectionsRef.current.delete(conn.peer);
            e2eKeyExchangeInProgressRef.current.delete(conn.peer);
        });
    };

    const connectToPeer = (id: string, isSilentMesh: boolean = false) => {
        if (!peer || id === peerId) return;

        if (connectionsRef.current.some(conn => conn.peer === id)) {
            if (!isSilentMesh) setError('Already connected to this peer');
            return;
        }

        if (pendingConnectionsRef.current.has(id)) {
            return;
        }

        const failedAt = failedPeersRef.current[id];
        if (failedAt && (Date.now() - failedAt < FAILED_PEER_COOLDOWN)) {
            if (!isSilentMesh) setError('Peer is unavailable, try again later');
            return;
        }

        try {
            pendingConnectionsRef.current.add(id);
            const conn = peer.connect(id, {
                reliable: true,
                metadata: { displayName: currentDisplayName, avatarUrl, isMesh: isSilentMesh }
            });

            const connectTimeout = setTimeout(() => {
                if (pendingConnectionsRef.current.has(id)) {
                    pendingConnectionsRef.current.delete(id);
                    failedPeersRef.current[id] = Date.now();
                    console.warn(`[P2P] Connection to ${id} timed out`);
                }
            }, 15000);

            conn.on('open', () => {
                clearTimeout(connectTimeout);
            });

            setupConnection(conn);
        } catch (err: any) {
            pendingConnectionsRef.current.delete(id);
            failedPeersRef.current[id] = Date.now();
            if (!isSilentMesh) setError(err.message || 'Failed to connect');
        }
    };

    const disconnectAll = () => {
        connectionsRef.current.forEach(conn => {
            conn.close();
        });
        setConnections([]);
        connectionsRef.current = [];
        pendingConnectionsRef.current.clear();
        e2eKeyExchangeInProgressRef.current.clear();
        e2eSharedKeysRef.current = {};
        e2ePendingQueuesRef.current = {};

        Object.values(mediaConnectionsRef.current).forEach(call => call.close());
        setRemoteStreams({});
    };

    const createServer = (name: string) => {
        if (!joinedServers.find(s => s.id === peerId)) {
            setJoinedServers(prev => [...prev, { id: peerId, name }]);
        }
        switchServer(peerId);
    };

    const joinServer = (id: string, name: string) => {
        if (!joinedServers.find(s => s.id === id)) {
            setJoinedServers(prev => [...prev, { id, name }]);
        }
        switchServer(id);
    };

    const loadHistoryFor = (key: string) => {
        const saved = localStorage.getItem(key);
        if (saved) {
            try { setMessages(JSON.parse(saved)); return; } catch (e) { }
        }
        setMessages([]);
    };

    const switchServer = (id: string | null) => {
        
        endAllCalls();
        setActiveVoiceChannel(null);

        if (activeServerRef.current && activeServerRef.current.id !== peerId) {
            const hostConn = connectionsRef.current.find(c => c.peer === activeServerRef.current!.id);
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'server_leave', payload: { serverId: activeServerRef.current.id } });
            }
        }

        serverMembersRef.current.clear();
        setServerMembers(new Set());

        if (id === null) {
            setActiveServer(null);
            activeServerRef.current = null;
            loadHistoryFor('p2p_chat_history_home');
        } else {
            const server = joinedServers.find(s => s.id === id);
            if (server) {
                setActiveServer(server);
                activeServerRef.current = server;
                loadHistoryFor(`p2p_chat_history_${id}`);

                if (id === peerId) {
                    
                    serverMembersRef.current.add(peerId);
                    setServerMembers(new Set(serverMembersRef.current));
                } else {
                    
                    const sendJoinMessage = () => {
                        const hostConn = connectionsRef.current.find(c => c.peer === id);
                        if (hostConn && hostConn.open) {
                            hostConn.send({ type: 'server_join', payload: { serverId: id } });
                            console.log(`[Server] Sent server_join to host ${id}`);
                        }
                    };

                    if (connectionsRef.current.some(c => c.peer === id)) {
                        
                        sendJoinMessage();
                    } else {
                        
                        connectToPeer(id, true);
                        
                        const joinInterval = setInterval(() => {
                            const hostConn = connectionsRef.current.find(c => c.peer === id);
                            if (hostConn && hostConn.open) {
                                hostConn.send({ type: 'server_join', payload: { serverId: id } });
                                console.log(`[Server] Sent server_join to host ${id}`);
                                clearInterval(joinInterval);
                            }
                        }, 500);
                        
                        setTimeout(() => clearInterval(joinInterval), 15000);
                    }
                }
            }
        }
    };

    const createGroupDM = (name: string, members: string[]) => {
        const id = `group_${Math.random().toString(36).substring(7)}`;
        const groupData = { id, name, members: [...members, peerId] };

        setGroupDMs(prev => {
            const next = { ...prev, [id]: groupData };
            localStorage.setItem('p2p_chat_groups', JSON.stringify(next));
            return next;
        });

        members.forEach(memberId => {
            const conn = connections.find(c => c.peer === memberId);
            if (conn && conn.open) {
                conn.send({ type: 'group_invite', payload: groupData });
            } else {
                
                connectToPeer(memberId, false);
                
            }
        });

        setActiveServer(null);
        setActiveDM(id);
    };

    const addGroupMember = (groupId: string, memberId: string) => {
        if (!memberId.trim()) return;

        setGroupDMs(prev => {
            const group = prev[groupId];
            if (!group) return prev;
            if (group.members.includes(memberId)) return prev; 

            const updatedGroup = { ...group, members: [...group.members, memberId] };
            const next = { ...prev, [groupId]: updatedGroup };
            localStorage.setItem('p2p_chat_groups', JSON.stringify(next));

            connectionsRef.current.forEach(conn => {
                if (conn.open && updatedGroup.members.includes(conn.peer)) {
                    conn.send({ type: 'group_invite', payload: updatedGroup });
                }
            });

            if (!connectionsRef.current.some(c => c.peer === memberId)) {
                connectToPeer(memberId, false);
                
                const inviteInterval = setInterval(() => {
                    const conn = connectionsRef.current.find(c => c.peer === memberId);
                    if (conn && conn.open) {
                        conn.send({ type: 'group_invite', payload: updatedGroup });
                        clearInterval(inviteInterval);
                    }
                }, 500);
                setTimeout(() => clearInterval(inviteInterval), 15000);
            }

            return next;
        });
    };

    const [typingPeers, setTypingPeers] = useState<Record<string, number>>({});
    const lastTypingSentRef = useRef<number>(0);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setTypingPeers(prev => {
                const next: Record<string, number> = {};
                let changed = false;
                Object.entries(prev).forEach(([id, ts]) => {
                    if (now - ts < 4000) next[id] = ts;
                    else changed = true;
                });
                return changed ? next : prev;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const sendTypingIndicator = () => {
        const now = Date.now();
        if (now - lastTypingSentRef.current < 3000) return;
        lastTypingSentRef.current = now;
        connections.forEach(conn => {
            if (conn.open) conn.send({ type: 'typing', payload: { peerId } });
        });
    };

    const addReaction = (messageId: string, emoji: string) => {
        
        setMessagesRaw(prev => prev.map(msg => {
            if (msg.id !== messageId) return msg;
            const reactions = { ...(msg.reactions || {}) };
            if (!reactions[emoji]) reactions[emoji] = [];
            if (!reactions[emoji].includes(peerId)) {
                reactions[emoji] = [...reactions[emoji], peerId];
            } else {
                reactions[emoji] = reactions[emoji].filter(id => id !== peerId);
                if (reactions[emoji].length === 0) delete reactions[emoji];
            }
            return { ...msg, reactions };
        }));
        
        connections.forEach(conn => {
            if (conn.open) conn.send({ type: 'reaction', payload: { messageId, emoji, userId: peerId } });
        });
    };

    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    const sendMessage = (text: string, fileAttachment?: UserMessage['file'], replyTo?: UserMessage['replyTo']) => {
        if ((!text.trim() && !fileAttachment) || connections.length === 0) return;

        if (!activeServer && !activeDM) return;

        if (text.trim().toLowerCase() === killSwitchRef.current.toLowerCase()) {
            const activeChannelId = activeServer ? activeServer.id : 'home';
            
            setMessages([]);
            localStorage.removeItem(`p2p_chat_history_${activeChannelId}`);
            
            connections.forEach(conn => {
                if (conn.open) {
                    conn.send({ type: 'clear_chat', payload: { channelId: activeChannelId } });
                }
            });
            return; 
        }

        if (activeServer) {
            const targetChannel = activeServer ? activeChannel : activeDM;

            const newMessage: UserMessage = {
                id: Math.random().toString(36).substring(7),
                senderId: peerId,
                senderName: currentDisplayName,
                text,
                timestamp: Date.now(),
                channelId: targetChannel || undefined,
                ...(fileAttachment && { file: fileAttachment }),
                ...(replyTo && { replyTo })
            };

            connections.forEach(conn => {
                if (conn.open) {
                    e2eSend(conn, { type: 'message', payload: newMessage });
                }
            });

            setMessages(prev => [...prev, newMessage]);
        } else if (activeDM) {
            const isGroup = activeDM.startsWith('group_');
            const targetChannelId = isGroup ? activeDM : activeDM; 
            const newMessage: UserMessage = {
                id: Math.random().toString(36).substring(7),
                senderId: peerId,
                senderName: currentDisplayName,
                text,
                timestamp: Date.now(),
                channelId: targetChannelId, 
                file: fileAttachment,
                ...(replyTo && { replyTo })
            };

            if (isGroup) {
                const group = groupDMs[activeDM];
                if (group) {
                    group.members.forEach(memberId => {
                        if (memberId !== peerId) {
                            const targetConn = connections.find(c => c.peer === memberId);
                            if (targetConn && targetConn.open) {
                                e2eSend(targetConn, { type: 'message', payload: newMessage });
                            }
                        }
                    });
                }
                setMessages(prev => [...prev, newMessage]);
            } else {
                
                newMessage.channelId = activeDM;
                const targetConn = connections.find(c => c.peer === activeDM);
                if (targetConn && targetConn.open) {
                    e2eSend(targetConn, { type: 'message', payload: newMessage });
                }
                setMessages(prev => [...prev, newMessage]);
            }
        }
    };

    const initLocalStream = async (withVideo: boolean = true) => {
        let stream: MediaStream;

        const audioConstraints: any = {
            noiseSuppression: audioSettings.noiseSuppression,
            echoCancellation: audioSettings.echoCancellation,
            autoGainControl: audioSettings.autoGainControl
        };
        if (audioSettings.deviceId) {
            audioConstraints.deviceId = { exact: audioSettings.deviceId };
        }

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: withVideo,
                audio: audioConstraints
            });
        } catch (err: any) {
            console.warn('Initial media access failed, trying audio only...', err);
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints });
            } catch (audioErr) {
                console.warn('Audio only failed too, creating full dummy stream.');
                const canvas = document.createElement('canvas');
                canvas.width = 1; canvas.height = 1;
                stream = canvas.captureStream(1); 
                try {
                    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                    if (AudioContextClass) {
                        const audioCtx = new AudioContextClass();
                        const dest = audioCtx.createMediaStreamDestination();
                        stream.addTrack(dest.stream.getAudioTracks()[0]);
                    }
                } catch (acErr) { }
            }
        }

        if (stream.getVideoTracks().length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = 1; canvas.height = 1;
            const dummyVideoTrack = canvas.captureStream(1).getVideoTracks()[0];
            dummyVideoTrack.enabled = false;
            
            (dummyVideoTrack as any).isDummy = true;
            stream.addTrack(dummyVideoTrack);
            setIsVideoEnabled(false);
        } else {
            setIsVideoEnabled(withVideo);
            if (!withVideo) {
                stream.getVideoTracks().forEach(t => t.enabled = false);
            }
        }

        setLocalStream(stream);
        localStreamRef.current = stream;

        if (isMuted || isDeafened) {
            stream.getAudioTracks().forEach(t => { t.enabled = false; });
        }

        return stream;
    };

    const startCall = async (id: string, withVideo: boolean) => {
        if (!peer) return;
        let stream = localStream;
        if (!stream) {
            stream = await initLocalStream(withVideo);
        }
        if (stream) {
            try {
                const call = peer.call(id, stream, { metadata: { withVideo } });

                call.on('stream', (userVideoStream) => {
                    setRemoteStreams(prev => ({ ...prev, [call.peer]: userVideoStream }));
                });

                call.on('close', () => {
                    setRemoteStreams(prev => {
                        const newStreams = { ...prev };
                        delete newStreams[call.peer];
                        return newStreams;
                    });
                    delete mediaConnectionsRef.current[call.peer];

                    if (Object.keys(mediaConnectionsRef.current).length === 0 && localStream) {
                        localStream.getTracks().forEach(track => {
                            track.stop();
                        });
                        setLocalStream(null);
                        setIsScreenSharing(false);
                        setIsVideoEnabled(false);
                    }
                });

                mediaConnectionsRef.current[call.peer] = call;
            } catch (err: any) {
                setError('Failed to start call: ' + err.message);
            }
        }
    };

    const answerCall = async () => {
        if (!incomingCall) return;

        let stream = localStream;
        if (!stream) {
            stream = await initLocalStream(incomingCallIsVideo);
        }

        if (stream) {
            incomingCall.answer(stream);
        } else {
            incomingCall.answer();
        }

        incomingCall.on('stream', (remoteStream) => {
            setRemoteStreams(prev => ({ ...prev, [incomingCall.peer]: remoteStream }));
        });

        mediaConnectionsRef.current[incomingCall.peer] = incomingCall;

        incomingCall.on('close', () => {
            setRemoteStreams(prev => {
                const newStreams = { ...prev };
                delete newStreams[incomingCall.peer];
                return newStreams;
            });
            delete mediaConnectionsRef.current[incomingCall.peer];

            if (Object.keys(mediaConnectionsRef.current).length === 0 && localStream) {
                localStream.getTracks().forEach(track => {
                    track.stop();
                });
                setLocalStream(null);
                localStreamRef.current = null;
                setIsScreenSharing(false);
                setIsVideoEnabled(false);
            }
        });

        if (activeServerRef.current) {
            setActiveVoiceChannel('voice-lounge');
            setActiveChannel('Voice Lounge');
        }

        setIncomingCall(null);
    };

    const rejectCall = () => {
        if (incomingCall) {
            incomingCall.close();
            setIncomingCall(null);
        }
    };

    const endCall = (id: string) => {
        if (mediaConnectionsRef.current[id]) {
            mediaConnectionsRef.current[id].close();
            delete mediaConnectionsRef.current[id];
        }

        setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[id];
            return newStreams;
        });

        if (Object.keys(mediaConnectionsRef.current).length === 0 && localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
            });
            setLocalStream(null);
            localStreamRef.current = null;
            setIsScreenSharing(false);
            setIsVideoEnabled(false);
        }
    };

    const endAllCalls = () => {
        Object.keys(mediaConnectionsRef.current).forEach(id => {
            mediaConnectionsRef.current[id].close();
            delete mediaConnectionsRef.current[id];
        });
        setRemoteStreams({});

        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
            });
            setLocalStream(null);
            localStreamRef.current = null;
            setIsScreenSharing(false);
            setIsVideoEnabled(false);
        }

        if (incomingCall) {
            incomingCall.close();
            setIncomingCall(null);
        }
    };

    const toggleMute = () => {
        setIsMuted(prev => !prev);
    };

    const toggleDeafen = () => {
        setIsDeafened(prev => {
            const next = !prev;
            if (next) {
                
                setIsMuted(true);
            }
            return next;
        });
    };

    const toggleVideo = async () => {
        if (!localStream) return;

        const videoTrack = localStream.getVideoTracks()[0];

        if (!isVideoEnabled) {
            
            if (videoTrack && (videoTrack as any).isDummy) {
                
                try {
                    const vidStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    const newVidTrack = vidStream.getVideoTracks()[0];

                    localStream.removeTrack(videoTrack);
                    localStream.addTrack(newVidTrack);

                    Object.values(mediaConnectionsRef.current).forEach(call => {
                        const sender = call.peerConnection?.getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) sender.replaceTrack(newVidTrack);
                    });
                    setIsVideoEnabled(true);
                } catch (e) {
                    setError('Could not access camera');
                }
            } else if (videoTrack) {
                videoTrack.enabled = true;
                setIsVideoEnabled(true);
            }
        } else {
            
            if (videoTrack) {
                videoTrack.enabled = false;
            }
            setIsVideoEnabled(false);
        }
    };

    const stopScreenShare = () => {
        if (!localStream) return;
        const currentTrack = localStream.getVideoTracks()[0];
        if (currentTrack) {
            currentTrack.stop();
            localStream.removeTrack(currentTrack);
        }
        const origTrack = originalVideoTrackRef.current;
        if (origTrack) {
            localStream.addTrack(origTrack);
            Object.values(mediaConnectionsRef.current).forEach(call => {
                const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
                if (sender && origTrack) sender.replaceTrack(origTrack);
            });
        }
        originalVideoTrackRef.current = null;
        setIsScreenSharing(false);
    };

    const toggleScreenShare = async () => {
        if (!peer || Object.keys(mediaConnectionsRef.current).length === 0) {
            setError('Must be in an active call to share screen');
            return;
        }

        if (isScreenSharing) {
            stopScreenShare();
            return;
        }

        try {
            let screenStream: MediaStream;

            const isElectron = (window as any).process?.type;

            if (isElectron) {
                const { ipcRenderer } = (window as any).require('electron');
                const sources = await ipcRenderer.invoke('get-desktop-sources');
                const source = sources.find((s: any) => s.id.startsWith('screen')) || sources[0];

                screenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: source.id
                        }
                    } as any
                });
            } else {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            }

            const screenVideoTrack = screenStream.getVideoTracks()[0];
            const screenAudioTrack = screenStream.getAudioTracks()[0] || null;

            if (localStream) {
                originalVideoTrackRef.current = localStream.getVideoTracks()[0] || null;
                if (originalVideoTrackRef.current) {
                    localStream.removeTrack(originalVideoTrackRef.current);
                }
                localStream.addTrack(screenVideoTrack);

                if (screenAudioTrack) {
                    localStream.addTrack(screenAudioTrack);
                    
                    Object.values(mediaConnectionsRef.current).forEach(call => {
                        try {
                            call.peerConnection?.addTrack(screenAudioTrack, localStream!);
                        } catch (e) {
                            console.warn('[ScreenShare] Could not add audio track to peer', e);
                        }
                    });
                }
            }

            setIsScreenSharing(true);

            Object.values(mediaConnectionsRef.current).forEach(call => {
                const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(screenVideoTrack);
            });

            screenVideoTrack.onended = () => stopScreenShare();

        } catch (err) {
            console.error('Failed sharing screen', err);
            setError('Screen share cancelled or failed.');
        }
    };

    return (
        <PeerContext.Provider value={{
            peerId,
            displayName: currentDisplayName,
            setDisplayName: setCurrentDisplayName,
            avatarUrl,
            setAvatarUrl,
            peer,
            connections,
            serverMembers,
            peerNames,
            peerAvatars,
            knownPeers,
            messages,
            connectToPeer,
            sendMessage,
            error,
            localStream,
            remoteStreams,
            startCall,
            endCall,
            endAllCalls,
            toggleMute,
            toggleDeafen,
            toggleVideo,
            toggleScreenShare,
            isMuted,
            isDeafened,
            isVideoEnabled,
            isScreenSharing,
            peerVoiceStates,
            audioSettings,
            updateAudioSettings,
            incomingCall,
            incomingCallIsVideo,
            answerCall,
            rejectCall,
            joinedServers,
            activeServer,
            createServer,
            joinServer,
            switchServer,
            activeChannel,
            setActiveChannel,
            activeVoiceChannel,
            setActiveVoiceChannel,
            activeDM,
            setActiveDM,
            groupDMs,
            createGroupDM,
            addGroupMember,
            killSwitchKeyword,
            setKillSwitchKeyword,
            typingPeers,
            sendTypingIndicator,
            addReaction
        }}>
            {children}
        </PeerContext.Provider>
    );
};

export const usePeer = () => {
    const context = useContext(PeerContext);
    if (context === undefined) {
        throw new Error('usePeer must be used within a PeerProvider');
    }
    return context;
};