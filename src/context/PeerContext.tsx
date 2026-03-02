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

    // Media State (For later expansion)
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

    // Audio Processing
    audioSettings: AudioSettings;
    updateAudioSettings: (settings: Partial<AudioSettings>) => void;

    // Incoming Call Handling
    incomingCall: MediaConnection | null;
    incomingCallIsVideo: boolean;
    answerCall: () => void;
    rejectCall: () => void;

    // Guilds / Servers
    joinedServers: { id: string, name: string }[];
    activeServer: { id: string, name: string } | null;
    createServer: (name: string) => void;
    joinServer: (id: string, name: string) => void;
    switchServer: (id: string | null) => void;

    // Channels
    activeChannel: string;
    setActiveChannel: (id: string) => void;
    activeVoiceChannel: string | null;
    setActiveVoiceChannel: (id: string | null) => void;

    // DMs
    activeDM: string | null;
    setActiveDM: (id: string | null) => void;
    groupDMs: Record<string, { id: string, name: string, members: string[] }>;
    createGroupDM: (name: string, members: string[]) => void;
    addGroupMember: (groupId: string, memberId: string) => void;

    // Kill Switch
    killSwitchKeyword: string;
    setKillSwitchKeyword: (keyword: string) => void;

    // Typing Indicator
    typingPeers: Record<string, number>;
    sendTypingIndicator: () => void;

    // Reactions
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
    const FAILED_PEER_COOLDOWN = 30000; // 30 seconds before retrying a failed peer

    // Server membership tracking: which peers are in the current server (host-side tracking)
    const serverMembersRef = useRef<Set<string>>(new Set());
    const [serverMembers, setServerMembers] = useState<Set<string>>(new Set());

    // Keep a ref to localStream so mute/deafen always operates on the latest stream
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

        // If we are currently transmitting audio, try to apply constraints live
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

    // Kill Switch Keyword
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

    // History key is dynamic based on active server
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

    // Wrapper that caps message count
    const setMessages = (updater: UserMessage[] | ((prev: UserMessage[]) => UserMessage[])) => {
        setMessagesRaw(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
    };

    const [error, setError] = useState<string | null>(null);

    // Debounced persist — write to localStorage at most once per 2 seconds
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            localStorage.setItem(historyKey, JSON.stringify(messages));
        }, 2000);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [messages, historyKey]);

    // Persist servers
    useEffect(() => {
        localStorage.setItem('p2p_chat_servers', JSON.stringify(joinedServers));
    }, [joinedServers]);

    // Persist known peers (friends list)
    useEffect(() => {
        localStorage.setItem('p2p_chat_friends', JSON.stringify(knownPeers));
    }, [knownPeers]);

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<{ [peerId: string]: MediaStream }>({});
    const [incomingCall, setIncomingCall] = useState<MediaConnection | null>(null);
    const [incomingCallIsVideo, setIncomingCallIsVideo] = useState<boolean>(true);
    const mediaConnectionsRef = useRef<{ [peerId: string]: MediaConnection }>({});
    const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);

    // E2E Encryption State
    const e2eKeyPairRef = useRef<CryptoKeyPair | null>(null);
    const e2eSharedKeysRef = useRef<Record<string, CryptoKey>>({});
    const e2eKeyExchangeInProgressRef = useRef<Set<string>>(new Set());
    const e2ePendingQueuesRef = useRef<Record<string, any[]>>({});

    // Generate our ECDH key pair once on mount
    useEffect(() => {
        generateKeyPair().then(kp => {
            e2eKeyPairRef.current = kp;
            console.log('[E2E] \u{1F511} ECDH key pair generated');
        });
    }, []);

    // Voice State Flags
    const [isMuted, setIsMuted] = useState(false);
    const [isDeafened, setIsDeafened] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [peerVoiceStates, setPeerVoiceStates] = useState<Record<string, { muted: boolean, deafened: boolean }>>({});

    // Group DMs state
    const [groupDMs, setGroupDMs] = useState<Record<string, { id: string, name: string, members: string[] }>>(() => {
        const saved = localStorage.getItem('p2p_chat_groups');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        // Enforce mute/deafen states on the local tracks
        const stream = localStreamRef.current;
        if (stream) {
            stream.getAudioTracks().forEach(t => {
                t.enabled = !isMuted && !isDeafened;
            });
        }
        // Broadcast the change to all connected peers (use ref to avoid stale closure)
        connectionsRef.current.forEach(c => {
            if (c.open) c.send({ type: 'voice_state', payload: { muted: isMuted, deafened: isDeafened } });
        });
    }, [isMuted, isDeafened, localStream]);

    useEffect(() => {
        // We removed STUN-only override to allow PeerJS to use its default ICE connection configuration 
        // which includes a valid TURN server. This fixes symmetric NAT traversal failures over the internet.
        const newPeer = new Peer(initialId, {
            debug: 2
        });

        newPeer.on('open', (id) => {
            console.log('My peer ID is: ' + id);
            setPeerId(id);
            setPeer(newPeer);
        });

        newPeer.on('connection', (conn) => {
            setupConnection(conn, true); // isIncoming = true, so metadata has remote peer's name
        });

        newPeer.on('call', (call) => {
            // Set the incoming call to state so UI can prompt user
            const isVideo = call.metadata?.withVideo !== false;
            setIncomingCallIsVideo(isVideo);
            setIncomingCall(call);

            // If the caller hangs up before we accept/reject, clear the modal
            call.on('close', () => {
                setIncomingCall(prev => {
                    if (prev && prev.peer === call.peer) return null;
                    return prev;
                });
            });
        });

        newPeer.on('error', (err) => {
            // Suppress expected PeerJS disconnect warnings or unavailable peers so we don't spam UI
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
    }, [initialId]); // Re-initialize only if initialId changes

    // E2E helper: process a decrypted message as if it was a normal message
    const processDecryptedMessage = async (conn: DataConnection, data: any, sharedKey: CryptoKey) => {
        try {
            const decrypted = await decryptMessage(sharedKey, data.payload.iv, data.payload.ciphertext);
            const innerData = JSON.parse(decrypted);
            // Re-inject as a normal data event by recursively handling the inner type
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

    // E2E helper: encrypt and send a message to a peer
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
        // Fallback: no shared key yet, send plaintext
        conn.send(messageData);
    };

    const setupConnection = (conn: DataConnection, isIncoming: boolean = false) => {
        // Only use metadata name for INCOMING connections (where metadata comes from the remote peer)
        // For outgoing connections, the metadata contains OUR name, not the remote peer's
        if (isIncoming && conn.metadata?.displayName) {
            setPeerNames(prev => ({ ...prev, [conn.peer]: conn.metadata.displayName }));
            setKnownPeers(prev => ({ ...prev, [conn.peer]: conn.metadata.displayName }));
            if (conn.metadata.avatarUrl) {
                setPeerAvatars(prev => ({ ...prev, [conn.peer]: conn.metadata.avatarUrl }));
            }
        }

        conn.on('open', async () => {
            // Remove from pending
            pendingConnectionsRef.current.delete(conn.peer);
            // Clear from failed peers on successful connect
            delete failedPeersRef.current[conn.peer];

            // Deterministic dedup: if we already have a connection to this peer, keep only one
            // The peer with the smaller ID "wins" as the initiator
            const existingConn = connectionsRef.current.find(c => c.peer === conn.peer);
            if (existingConn) {
                // Already connected — close the duplicate
                console.log(`[P2P] Duplicate connection to ${conn.peer}, closing new one`);
                conn.close();
                return;
            }

            setConnections(prev => {
                if (!prev.find(c => c.peer === conn.peer)) {
                    const newConns = [...prev, conn];
                    connectionsRef.current = newConns;
                    // NOTE: We no longer blindly broadcast room_peers here.
                    // The host only broadcasts when a peer sends a 'server_join' message.
                    return newConns;
                }
                return prev;
            });

            // === E2E KEY EXCHANGE === 
            // Only send public key if we haven't already exchanged with this peer
            if (e2eKeyPairRef.current && !e2eSharedKeysRef.current[conn.peer] && !e2eKeyExchangeInProgressRef.current.has(conn.peer)) {
                e2eKeyExchangeInProgressRef.current.add(conn.peer);
                const pubKeyJwk = await exportPublicKey(e2eKeyPairRef.current.publicKey);
                conn.send({ type: 'e2e_pubkey', payload: pubKeyJwk });
                console.log(`[E2E] 🔑 Sent public key to ${conn.peer}`);
            }

            // Send our name and avatar back so the initiator knows who we are
            conn.send({ type: 'identity', payload: { name: currentDisplayName, avatarUrl } });

            // Send our initial voice state
            conn.send({ type: 'voice_state', payload: { muted: isMuted, deafened: isDeafened } });

            // Send a sync request with our latest message timestamp
            setMessages(currentMessages => {
                const latestTimestamp = currentMessages.length > 0
                    ? Math.max(...currentMessages.map(m => m.timestamp))
                    : 0;
                const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                conn.send({ type: 'sync_request', payload: { timestamp: latestTimestamp, channel: activeChannelId } });
                return currentMessages; // no state change
            });
        });

        conn.on('data', async (data: any) => {
            // === E2E KEY EXCHANGE: Receive peer's public key ===
            if (data.type === 'e2e_pubkey') {
                try {
                    const peerPubKey = await importPublicKey(data.payload);
                    if (e2eKeyPairRef.current) {
                        const sharedKey = await deriveSharedKey(e2eKeyPairRef.current.privateKey, peerPubKey);
                        e2eSharedKeysRef.current[conn.peer] = sharedKey;
                        console.log(`[E2E] 🔐 Shared key derived with ${conn.peer}`);

                        // Process any queued encrypted messages that arrived before key exchange completed
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

            // === E2E ENCRYPTED MESSAGE: Decrypt before processing ===
            if (data.type === 'e2e_message') {
                const sharedKey = e2eSharedKeysRef.current[conn.peer];
                if (!sharedKey) {
                    // Key exchange hasn't completed yet — queue the message
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
                // Peer is asking for messages newer than data.payload (timestamp)
                const { timestamp: requestTimestamp, channel: requestChannel } = data.payload;

                // We must query the correct storage history for the requested channel
                const saved = localStorage.getItem(`p2p_chat_history_${requestChannel}`);
                let historyToSync: UserMessage[] = [];
                if (saved) {
                    try { historyToSync = JSON.parse(saved); } catch (e) { }
                } else if (requestChannel === (activeServerRef.current ? activeServerRef.current.id : 'home')) {
                    // Fallback to active memory if it matches current channel
                    setMessages(currentMessages => { historyToSync = currentMessages; return currentMessages; });
                }

                const newerMessages = historyToSync.filter(m => m.timestamp > requestTimestamp);
                if (newerMessages.length > 0) {
                    conn.send({ type: 'sync_response', payload: { messages: newerMessages, channel: requestChannel } });
                }
            } else if (data.type === 'server_join') {
                // A peer is telling us they joined the server (we are the host)
                const { serverId } = data.payload;
                if (activeServerRef.current && activeServerRef.current.id === peerId && serverId === peerId) {
                    // Add this peer to server members
                    serverMembersRef.current.add(conn.peer);
                    setServerMembers(new Set(serverMembersRef.current));
                    console.log(`[Server] ${conn.peer} joined server. Members:`, Array.from(serverMembersRef.current));

                    // Broadcast updated server member list to ALL server members
                    const memberIds = Array.from(serverMembersRef.current);
                    connectionsRef.current.forEach(c => {
                        if (c.open && serverMembersRef.current.has(c.peer)) {
                            c.send({ type: 'room_peers', payload: memberIds });
                        }
                    });
                }
            } else if (data.type === 'server_leave') {
                // A peer is telling us they left the server (we are the host)
                if (activeServerRef.current && activeServerRef.current.id === peerId) {
                    serverMembersRef.current.delete(conn.peer);
                    setServerMembers(new Set(serverMembersRef.current));
                    console.log(`[Server] ${conn.peer} left server. Members:`, Array.from(serverMembersRef.current));

                    // Broadcast updated member list
                    const memberIds = Array.from(serverMembersRef.current);
                    connectionsRef.current.forEach(c => {
                        if (c.open && serverMembersRef.current.has(c.peer)) {
                            c.send({ type: 'room_peers', payload: memberIds });
                        }
                    });
                }
            } else if (data.type === 'room_peers') {
                // We received a list of peers in this server/room from the Host
                const roomPeers = data.payload as string[];

                // Update our local server member tracking
                const newMembers = new Set<string>(roomPeers);
                // Add the host too
                if (activeServerRef.current) {
                    newMembers.add(activeServerRef.current.id);
                }
                serverMembersRef.current = newMembers;
                setServerMembers(new Set(newMembers));

                roomPeers.forEach(id => {
                    // Use refs to avoid stale closure issues
                    const alreadyConnected = connectionsRef.current.some(c => c.peer === id);
                    const isPending = pendingConnectionsRef.current.has(id);
                    const failedAt = failedPeersRef.current[id];
                    const isCoolingDown = failedAt && (Date.now() - failedAt < FAILED_PEER_COOLDOWN);

                    if (id !== peerId && !alreadyConnected && !isPending && !isCoolingDown) {
                        // Deterministic: only the peer with the smaller ID initiates
                        if (peerId < id) {
                            connectToPeer(id, true);
                        }
                        // If peerId > id, the other peer will initiate to us
                    }
                });
            } else if (data.type === 'sync_response') {
                // We received missing messages, merge them into our state
                const { messages: newMessages, channel: responseChannel } = data.payload as { messages: UserMessage[], channel: string };

                // Only merge into live state if we are currently looking at that channel
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
                    // Update the background offline storage for that channel
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
                // Remote peer triggered kill switch — clear messages for the specified channel
                const channelToClear = data.payload?.channelId;
                if (channelToClear) {
                    localStorage.removeItem(`p2p_chat_history_${channelToClear}`);
                    const currentActiveChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                    if (currentActiveChannelId === channelToClear) {
                        setMessages([]);
                    }
                } else {
                    // Fallback: clear current active chat
                    const currentActiveChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                    localStorage.removeItem(`p2p_chat_history_${currentActiveChannelId}`);
                    setMessages([]);
                }
            } else if (data.type === 'typing') {
                // Peer is typing
                setTypingPeers(prev => ({ ...prev, [conn.peer]: Date.now() }));
            } else if (data.type === 'reaction') {
                // Peer added a reaction
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

            // === PUSH NOTIFICATION ===
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
            // Clean up all refs
            pendingConnectionsRef.current.delete(conn.peer);
            e2eKeyExchangeInProgressRef.current.delete(conn.peer);
            delete e2eSharedKeysRef.current[conn.peer];
            delete e2ePendingQueuesRef.current[conn.peer];

            // Remove from server members if they were a member
            if (serverMembersRef.current.has(conn.peer)) {
                serverMembersRef.current.delete(conn.peer);
                setServerMembers(new Set(serverMembersRef.current));
            }

            setConnections(prev => {
                const updated = prev.filter(c => c.peer !== conn.peer);
                connectionsRef.current = updated;
                // If we are the Host, broadcast updated SERVER MEMBER list (not all connections)
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
            // Mark as failed with cooldown
            failedPeersRef.current[conn.peer] = Date.now();
            pendingConnectionsRef.current.delete(conn.peer);
            e2eKeyExchangeInProgressRef.current.delete(conn.peer);
        });
    };

    const connectToPeer = (id: string, isSilentMesh: boolean = false) => {
        if (!peer || id === peerId) return;

        // Use refs instead of state to avoid stale closure issues
        if (connectionsRef.current.some(conn => conn.peer === id)) {
            if (!isSilentMesh) setError('Already connected to this peer');
            return;
        }

        // Prevent duplicate simultaneous connection attempts
        if (pendingConnectionsRef.current.has(id)) {
            return;
        }

        // Check cooldown for failed peers
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

            // Set a timeout to clean up if connection never opens
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
        // End all active media calls when switching servers
        // Each server has its own voice lobby — calls don't persist across servers
        endAllCalls();
        setActiveVoiceChannel(null);

        // If leaving a server, notify the host
        if (activeServerRef.current && activeServerRef.current.id !== peerId) {
            const hostConn = connectionsRef.current.find(c => c.peer === activeServerRef.current!.id);
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'server_leave', payload: { serverId: activeServerRef.current.id } });
            }
        }

        // Clear local server member tracking
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
                    // We are the host — add ourselves to server members
                    serverMembersRef.current.add(peerId);
                    setServerMembers(new Set(serverMembersRef.current));
                } else {
                    // We are NOT the host — connect and announce our join
                    const sendJoinMessage = () => {
                        const hostConn = connectionsRef.current.find(c => c.peer === id);
                        if (hostConn && hostConn.open) {
                            hostConn.send({ type: 'server_join', payload: { serverId: id } });
                            console.log(`[Server] Sent server_join to host ${id}`);
                        }
                    };

                    if (connectionsRef.current.some(c => c.peer === id)) {
                        // Already connected to the host
                        sendJoinMessage();
                    } else {
                        // Need to connect first, then send join message after connection opens
                        connectToPeer(id, true);
                        // Wait a bit for connection to establish, then send join
                        const joinInterval = setInterval(() => {
                            const hostConn = connectionsRef.current.find(c => c.peer === id);
                            if (hostConn && hostConn.open) {
                                hostConn.send({ type: 'server_join', payload: { serverId: id } });
                                console.log(`[Server] Sent server_join to host ${id}`);
                                clearInterval(joinInterval);
                            }
                        }, 500);
                        // Give up after 15 seconds
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

        // Broadcast invite to members
        members.forEach(memberId => {
            const conn = connections.find(c => c.peer === memberId);
            if (conn && conn.open) {
                conn.send({ type: 'group_invite', payload: groupData });
            } else {
                // If they are offline, connect and send? For now just try to connect
                connectToPeer(memberId, false);
                // We'll queue it if we had a queue, but let's assume they are online for now.
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
            if (group.members.includes(memberId)) return prev; // Already a member

            const updatedGroup = { ...group, members: [...group.members, memberId] };
            const next = { ...prev, [groupId]: updatedGroup };
            localStorage.setItem('p2p_chat_groups', JSON.stringify(next));

            // Broadcast the updated group to all members
            connectionsRef.current.forEach(conn => {
                if (conn.open && updatedGroup.members.includes(conn.peer)) {
                    conn.send({ type: 'group_invite', payload: updatedGroup });
                }
            });

            // Try to connect to the new member if not already connected
            if (!connectionsRef.current.some(c => c.peer === memberId)) {
                connectToPeer(memberId, false);
                // Send invite after connection establishes
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

    // === TYPING INDICATOR ===
    const [typingPeers, setTypingPeers] = useState<Record<string, number>>({});
    const lastTypingSentRef = useRef<number>(0);

    // Clean up stale typing indicators every second
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

    // === REACTIONS ===
    const addReaction = (messageId: string, emoji: string) => {
        // Toggle locally
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
        // Broadcast to peers
        connections.forEach(conn => {
            if (conn.open) conn.send({ type: 'reaction', payload: { messageId, emoji, userId: peerId } });
        });
    };

    // === NOTIFICATION PERMISSION ===
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // Expose sendMessage with file support
    const sendMessage = (text: string, fileAttachment?: UserMessage['file'], replyTo?: UserMessage['replyTo']) => {
        if ((!text.trim() && !fileAttachment) || connections.length === 0) return;

        // If in DM mode, but no active DM is selected, don't send
        if (!activeServer && !activeDM) return;

        // === KILL SWITCH CHECK ===
        if (text.trim().toLowerCase() === killSwitchRef.current.toLowerCase()) {
            const activeChannelId = activeServer ? activeServer.id : 'home';
            // Clear local messages
            setMessages([]);
            localStorage.removeItem(`p2p_chat_history_${activeChannelId}`);
            // Broadcast clear to all connected peers
            connections.forEach(conn => {
                if (conn.open) {
                    conn.send({ type: 'clear_chat', payload: { channelId: activeChannelId } });
                }
            });
            return; // Don't send the keyword as a message
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
            const targetChannelId = isGroup ? activeDM : activeDM; // Actually, for 1x1 sender treats targetChannel as their peer ID when sending
            const newMessage: UserMessage = {
                id: Math.random().toString(36).substring(7),
                senderId: peerId,
                senderName: currentDisplayName,
                text,
                timestamp: Date.now(),
                channelId: targetChannelId, // This is crucial for routing
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
                // Send to specific DM
                // When I send to a user, the standard is they see channelId as MY id, I see it as THEIR id.
                // Actually my current logic in ChatArea: (msg.senderId === activeDM && msg.channelId === peerId) || (msg.senderId === peerId && msg.channelId === activeDM)
                newMessage.channelId = activeDM;
                const targetConn = connections.find(c => c.peer === activeDM);
                if (targetConn && targetConn.open) {
                    e2eSend(targetConn, { type: 'message', payload: newMessage });
                }
                setMessages(prev => [...prev, newMessage]);
            }
        }
    };

    // Media Logic
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
                stream = canvas.captureStream(1); // 1 fps
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

        // If we don't have a video track (because withVideo was false or camera failed),
        // we MUST inject a dummy video track so the WebRTC connection negotiates a video transceiver.
        // This is strictly necessary so Screen Share and Camera Toggle can replace the track later.
        if (stream.getVideoTracks().length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = 1; canvas.height = 1;
            const dummyVideoTrack = canvas.captureStream(1).getVideoTracks()[0];
            dummyVideoTrack.enabled = false;
            // Tag it so we know it's a dummy when toggling camera
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

        // Apply the current mute state to the new stream
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

        // Stop local stream if no more remote connections
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
                // Deafening also mutes implicitly
                setIsMuted(true);
            }
            return next;
        });
    };

    const toggleVideo = async () => {
        if (!localStream) return;

        const videoTrack = localStream.getVideoTracks()[0];

        if (!isVideoEnabled) {
            // Turn ON Camera
            if (videoTrack && (videoTrack as any).isDummy) {
                // Request real camera since current is a dummy canvas
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
            // Turn OFF Camera
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

        // === STOP SHARING ===
        if (isScreenSharing) {
            stopScreenShare();
            return;
        }

        // === START SHARING ===
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

            // Save original video track before replacing
            if (localStream) {
                originalVideoTrackRef.current = localStream.getVideoTracks()[0] || null;
                if (originalVideoTrackRef.current) {
                    localStream.removeTrack(originalVideoTrackRef.current);
                }
                localStream.addTrack(screenVideoTrack);

                // If screen share has audio, add it to the stream and forward to peers
                if (screenAudioTrack) {
                    localStream.addTrack(screenAudioTrack);
                    // Forward screen audio track to all peers via a new sender
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

            // Replace video track for all active peers
            Object.values(mediaConnectionsRef.current).forEach(call => {
                const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(screenVideoTrack);
            });

            // Handle when user clicks "Stop Sharing" on browser/OS UI
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
