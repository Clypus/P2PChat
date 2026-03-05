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
    videoDeviceId?: string;
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

    unreadCounts: Record<string, number>;
    lastMessages: Record<string, { text: string; timestamp: number }>;
    clearUnread: (peerId: string) => void;

    editMessage: (messageId: string, newText: string) => void;
    deleteMessage: (messageId: string) => void;

    pinnedMessages: string[];
    pinMessage: (messageId: string) => void;
    unpinMessage: (messageId: string) => void;

    userStatus: 'online' | 'idle' | 'dnd' | 'invisible';
    setUserStatus: (status: 'online' | 'idle' | 'dnd' | 'invisible') => void;
    aboutMe: string;
    setAboutMe: (text: string) => void;
    peerStatuses: Record<string, string>;
    peerAboutMe: Record<string, string>;

    removeGroupMember: (groupId: string, memberId: string) => void;
    transferGroupOwnership: (groupId: string, newOwnerId: string) => void;

    // Push-to-talk
    pttEnabled: boolean;
    setPttEnabled: (enabled: boolean) => void;
    pttKey: string;
    setPttKey: (key: string) => void;

    // Connection quality
    peerLatencies: Record<string, number>;

    // Server roles
    serverRoles: Record<string, Record<string, string>>;
    setServerRole: (serverId: string, peerId: string, role: string) => void;
    getServerRole: (serverId: string, peerId: string) => string;

    // Friends list
    friendsList: string[];
    addFriend: (peerId: string) => void;
    removeFriend: (peerId: string) => void;

    // Per-user volume
    peerVolumes: Record<string, number>;
    setPeerVolume: (peerId: string, vol: number) => void;

    // Active call peers
    activeCallPeerIds: string[];
    activeCallDM: string | null;
}

// SECURITY: Escape HTML entities to prevent XSS in remote message edits
const escapeHtml = (text: string): string => {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const PeerContext = createContext<PeerContextType | undefined>(undefined);

interface PeerProviderProps {
    children: ReactNode;
    initialId: string;
    displayName: string;
}

export const PeerProvider: React.FC<PeerProviderProps> = ({ children, initialId, displayName }) => {
    const [peerId, setPeerId] = useState<string>('');
    const [currentDisplayName, setCurrentDisplayName] = useState(displayName);
    const displayNameRef = useRef(displayName);
    const [avatarUrl, setAvatarUrl] = useState<string>(() => {
        const saved = localStorage.getItem('p2p_chat_identity');
        if (saved) {
            try { return JSON.parse(saved).avatarUrl || ''; } catch (e) { return ''; }
        }
        return '';
    });
    const avatarUrlRef = useRef(avatarUrl);
    const [peer, setPeer] = useState<Peer | null>(null);
    const [connections, setConnections] = useState<DataConnection[]>([]);
    const connectionsRef = useRef<DataConnection[]>([]);
    const pendingConnectionsRef = useRef<Set<string>>(new Set());
    const failedPeersRef = useRef<Record<string, number>>({});
    const retryCountsRef = useRef<Record<string, number>>({});

    const connectTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const MAX_RETRIES = 2;
    const FAILED_PEER_COOLDOWN = 10000;

    // Auto-reconnect system
    const reconnectAttemptsRef = useRef<Record<string, number>>({});
    const reconnectTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const MAX_RECONNECT_ATTEMPTS = 5;
    const RECONNECT_BASE_DELAY = 2000; // 2s, then 4s, 8s, 16s, 30s max
    const knownConnectionsRef = useRef<Set<string>>(new Set()); // peers we've successfully connected to

    // Heartbeat system
    const HEARTBEAT_INTERVAL = 10000; // 10 seconds
    const HEARTBEAT_TIMEOUT = 3; // 3 missed pongs = dead
    const heartbeatMissedRef = useRef<Record<string, number>>({});
    const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Offline message queue: messages to send when peer reconnects
    const offlineQueueRef = useRef<Record<string, any[]>>((() => {
        const saved = localStorage.getItem('p2p_chat_offline_queue');
        if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
        return {};
    })());

    const queueOfflineMessage = (targetPeerId: string, messageData: any) => {
        if (!offlineQueueRef.current[targetPeerId]) offlineQueueRef.current[targetPeerId] = [];
        offlineQueueRef.current[targetPeerId].push(messageData);
        // Keep max 50 offline messages per peer
        if (offlineQueueRef.current[targetPeerId].length > 50) {
            offlineQueueRef.current[targetPeerId] = offlineQueueRef.current[targetPeerId].slice(-50);
        }
        localStorage.setItem('p2p_chat_offline_queue', JSON.stringify(offlineQueueRef.current));
    };

    const flushOfflineQueue = (conn: DataConnection) => {
        const queue = offlineQueueRef.current[conn.peer];
        if (queue && queue.length > 0) {
            console.log(`[OFFLINE] Flushing ${queue.length} queued messages to ${conn.peer}`);
            queue.forEach(msg => {
                try {
                    if (conn.open) conn.send(msg);
                } catch { }
            });
            delete offlineQueueRef.current[conn.peer];
            localStorage.setItem('p2p_chat_offline_queue', JSON.stringify(offlineQueueRef.current));
        }
    };

    // Rate limiting: track message timestamps per peer (max 5 messages per 3 seconds)
    const rateLimitRef = useRef<Record<string, number[]>>({});
    const RATE_LIMIT_MAX = 5;
    const RATE_LIMIT_WINDOW = 3000;

    const isRateLimited = (peerId: string): boolean => {
        const now = Date.now();
        if (!rateLimitRef.current[peerId]) rateLimitRef.current[peerId] = [];
        rateLimitRef.current[peerId] = rateLimitRef.current[peerId].filter(t => now - t < RATE_LIMIT_WINDOW);
        if (rateLimitRef.current[peerId].length >= RATE_LIMIT_MAX) return true;
        rateLimitRef.current[peerId].push(now);
        return false;
    };

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

    // Server roles: { serverId: { peerId: 'owner'|'admin'|'mod'|'member' } }
    type ServerRole = 'owner' | 'admin' | 'mod' | 'member';
    const [serverRoles, setServerRoles] = useState<Record<string, Record<string, string>>>(() => {
        const saved = localStorage.getItem('p2p_chat_server_roles');
        if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
        return {};
    });

    const ROLE_HIERARCHY: Record<string, number> = { owner: 4, admin: 3, mod: 2, member: 1 };

    const getServerRole = (serverId: string, targetPeerId: string): string => {
        // Auto-assign owner to server creator (serverId === peerId means this user created it)
        if (serverId === peerId && targetPeerId === peerId && !serverRoles[serverId]?.[peerId]) {
            setServerRole(serverId, peerId, 'owner');
            return 'owner';
        }
        return serverRoles[serverId]?.[targetPeerId] || 'member';
    };

    const setServerRole = (serverId: string, targetPeerId: string, role: string) => {
        setServerRoles(prev => {
            const serverData = { ...(prev[serverId] || {}), [targetPeerId]: role };
            const next = { ...prev, [serverId]: serverData };
            localStorage.setItem('p2p_chat_server_roles', JSON.stringify(next));
            // Broadcast role change
            connectionsRef.current.forEach(conn => {
                try { conn.send({ type: 'role_update', payload: { serverId, peerId: targetPeerId, role } }); } catch { }
            });
            return next;
        });
    };

    // Friends list
    const [friendsList, setFriendsList] = useState<string[]>(() => {
        const saved = localStorage.getItem('p2p_chat_friends');
        if (saved) { try { const parsed = JSON.parse(saved); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
        return [];
    });

    const addFriend = (targetPeerId: string) => {
        setFriendsList(prev => {
            if (prev.includes(targetPeerId)) return prev;
            const next = [...prev, targetPeerId];
            localStorage.setItem('p2p_chat_friends', JSON.stringify(next));
            return next;
        });
    };

    const removeFriend = (targetPeerId: string) => {
        setFriendsList(prev => {
            const next = prev.filter(id => id !== targetPeerId);
            localStorage.setItem('p2p_chat_friends', JSON.stringify(next));
            return next;
        });
    };

    // Per-user volume (shared state)
    const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('p2p_chat_volumes');
        return saved ? JSON.parse(saved) : {};
    });
    const setPeerVolume = (targetPeerId: string, vol: number) => {
        setPeerVolumes(prev => {
            const next = { ...prev, [targetPeerId]: vol };
            localStorage.setItem('p2p_chat_volumes', JSON.stringify(next));
            return next;
        });
    };

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
    const isMutedRef = useRef(false);
    const [isDeafened, setIsDeafened] = useState(false);
    const isDeafenedRef = useRef(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [peerVoiceStates, setPeerVoiceStates] = useState<Record<string, { muted: boolean, deafened: boolean }>>({});

    // Push-to-talk
    const [pttEnabled, setPttEnabledState] = useState(() => localStorage.getItem('p2p_chat_ptt') === 'true');
    const [pttKey, setPttKeyState] = useState(() => localStorage.getItem('p2p_chat_ptt_key') || 'Space');
    const pttEnabledRef = useRef(pttEnabled);
    const pttKeyRef = useRef(pttKey);

    const setPttEnabled = (enabled: boolean) => {
        setPttEnabledState(enabled);
        pttEnabledRef.current = enabled;
        localStorage.setItem('p2p_chat_ptt', String(enabled));
        if (enabled) { setIsMuted(true); isMutedRef.current = true; }
    };
    const setPttKey = (key: string) => {
        setPttKeyState(key);
        pttKeyRef.current = key;
        localStorage.setItem('p2p_chat_ptt_key', key);
    };

    useEffect(() => {
        if (!pttEnabled) return;
        const down = (e: KeyboardEvent) => { if (e.code === pttKeyRef.current && !e.repeat) { setIsMuted(false); isMutedRef.current = false; } };
        const up = (e: KeyboardEvent) => { if (e.code === pttKeyRef.current) { setIsMuted(true); isMutedRef.current = true; } };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [pttEnabled]);

    // Connection quality (ping/latency)
    const [peerLatencies, setPeerLatencies] = useState<Record<string, number>>({});
    const pingTimestampsRef = useRef<Record<string, number>>({});
    useEffect(() => { displayNameRef.current = currentDisplayName; }, [currentDisplayName]);
    useEffect(() => { avatarUrlRef.current = avatarUrl; }, [avatarUrl]);
    useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
    useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);

    const [groupDMs, setGroupDMs] = useState<Record<string, { id: string, name: string, members: string[] }>>(() => {
        const saved = localStorage.getItem('p2p_chat_groups');
        return saved ? JSON.parse(saved) : {};
    });

    const pinnedKeyRef = useRef('p2p_chat_pins_home');
    const [pinnedMessages, setPinnedMessages] = useState<string[]>(() => {
        const saved = localStorage.getItem('p2p_chat_pins_home');
        return saved ? JSON.parse(saved) : [];
    });

    const [userStatus, setUserStatusState] = useState<'online' | 'idle' | 'dnd' | 'invisible'>(() => {
        const saved = localStorage.getItem('p2p_chat_status');
        return (saved as any) || 'online';
    });
    const userStatusRef = useRef(userStatus);

    const setUserStatus = (status: 'online' | 'idle' | 'dnd' | 'invisible') => {
        setUserStatusState(status);
        userStatusRef.current = status;
        localStorage.setItem('p2p_chat_status', status);

        connectionsRef.current.forEach(c => {
            if (c.open) c.send({ type: 'status_update', payload: { status } });
        });
    };

    const [aboutMe, setAboutMeState] = useState<string>(() => {
        const saved = localStorage.getItem('p2p_chat_identity');
        if (saved) {
            try { return JSON.parse(saved).aboutMe || ''; } catch (e) { return ''; }
        }
        return '';
    });
    const aboutMeRef = useRef(aboutMe);

    const setAboutMe = (text: string) => {
        const trimmed = text.substring(0, 190);
        setAboutMeState(trimmed);
        aboutMeRef.current = trimmed;

        const saved = localStorage.getItem('p2p_chat_identity');
        const identity = saved ? JSON.parse(saved) : {};
        identity.aboutMe = trimmed;
        localStorage.setItem('p2p_chat_identity', JSON.stringify(identity));

        connectionsRef.current.forEach(c => {
            if (c.open) c.send({ type: 'identity', payload: { name: displayNameRef.current, avatarUrl: avatarUrlRef.current, aboutMe: trimmed, status: userStatusRef.current } });
        });
    };

    const [peerStatuses, setPeerStatuses] = useState<Record<string, string>>({});
    const [peerAboutMe, setPeerAboutMe] = useState<Record<string, string>>({});

    useEffect(() => { userStatusRef.current = userStatus; }, [userStatus]);
    useEffect(() => { aboutMeRef.current = aboutMe; }, [aboutMe]);

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
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
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
            // Always show incoming call — if user accepts, existing call will end first
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

    // HEARTBEAT: Send ping every 10s, detect dead connections
    useEffect(() => {
        heartbeatIntervalRef.current = setInterval(() => {
            const conns = connectionsRef.current;
            conns.forEach(conn => {
                if (!conn.open) return;
                // Increment missed count
                heartbeatMissedRef.current[conn.peer] = (heartbeatMissedRef.current[conn.peer] || 0) + 1;

                if (heartbeatMissedRef.current[conn.peer] > HEARTBEAT_TIMEOUT) {
                    console.warn(`[HEARTBEAT] Peer ${conn.peer} is dead (${HEARTBEAT_TIMEOUT} missed pongs). Closing.`);
                    delete heartbeatMissedRef.current[conn.peer];
                    conn.close(); // This triggers auto-reconnect via conn.on('close')
                    return;
                }

                try {
                    conn.send({ type: 'ping', payload: { timestamp: Date.now() } });
                } catch {
                    console.warn(`[HEARTBEAT] Failed to send ping to ${conn.peer}`);
                }
            });
        }, HEARTBEAT_INTERVAL);

        return () => {
            if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
            // Cleanup reconnect timers
            Object.values(reconnectTimersRef.current).forEach(timer => clearTimeout(timer));
            reconnectTimersRef.current = {};
        };
    }, []);

    // PERIODIC SYNC: Re-sync messages every 60s to catch any missed ones
    useEffect(() => {
        const syncInterval = setInterval(() => {
            const conns = connectionsRef.current;
            if (conns.length === 0) return;
            const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
            const saved = localStorage.getItem(`p2p_chat_history_${activeChannelId}`);
            let latestTimestamp = 0;
            if (saved) {
                try {
                    const msgs = JSON.parse(saved);
                    if (msgs.length > 0) latestTimestamp = Math.max(...msgs.map((m: any) => m.timestamp));
                } catch { }
            }
            conns.forEach(conn => {
                if (conn.open) {
                    try { conn.send({ type: 'sync_request', payload: { timestamp: latestTimestamp, channel: activeChannelId } }); } catch { }
                }
            });
        }, 60000);
        return () => clearInterval(syncInterval);
    }, []);

    const processDecryptedMessage = async (conn: DataConnection, data: any, sharedKey: CryptoKey) => {
        try {
            const decrypted = await decryptMessage(sharedKey, data.payload.iv, data.payload.ciphertext);
            const innerData = JSON.parse(decrypted);

            if (innerData.type === 'message') {
                const payload = innerData.payload;
                setMessages(prev => {

                    if (prev.some(m => m.id === payload.id)) return prev;
                    const updated = [...prev, payload];
                    const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                    localStorage.setItem(`p2p_chat_history_${activeChannelId}`, JSON.stringify(updated.slice(-MAX_MESSAGES)));
                    return updated;
                });

                trackIncomingMessage(payload.senderId, payload.text || '', payload.timestamp);
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

            if (connectTimeoutsRef.current[conn.peer]) {
                clearTimeout(connectTimeoutsRef.current[conn.peer]);
                delete connectTimeoutsRef.current[conn.peer];
            }

            delete failedPeersRef.current[conn.peer];
            delete retryCountsRef.current[conn.peer];

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
                    // Track for auto-reconnect
                    knownConnectionsRef.current.add(conn.peer);
                    delete reconnectAttemptsRef.current[conn.peer];
                    delete heartbeatMissedRef.current[conn.peer];
                    return newConns;
                }
                return prev;
            });

            delete e2eSharedKeysRef.current[conn.peer];
            e2eKeyExchangeInProgressRef.current.delete(conn.peer);
            delete e2ePendingQueuesRef.current[conn.peer];

            if (e2eKeyPairRef.current) {
                e2eKeyExchangeInProgressRef.current.add(conn.peer);
                const pubKeyJwk = await exportPublicKey(e2eKeyPairRef.current.publicKey);
                conn.send({ type: 'e2e_pubkey', payload: pubKeyJwk });
                console.log(`[E2E] 🔑 Sent public key to ${conn.peer}`);
            }

            conn.send({ type: 'identity', payload: { name: displayNameRef.current, avatarUrl: avatarUrlRef.current, aboutMe: aboutMeRef.current, status: userStatusRef.current } });

            conn.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current } });

            // Flush offline message queue for this peer
            flushOfflineQueue(conn);

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
                // Rate limit: drop messages from peers flooding
                if (isRateLimited(conn.peer)) {
                    console.warn(`[Rate Limit] Dropping message from ${conn.peer} (flood protection)`);
                    return;
                }
                setMessages(prev => {

                    if (prev.some(m => m.id === data.payload.id)) return prev;
                    const updated = [...prev, data.payload];
                    const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';

                    localStorage.setItem(`p2p_chat_history_${activeChannelId}`, JSON.stringify(updated.slice(-MAX_MESSAGES)));
                    return updated;
                });

                trackIncomingMessage(data.payload.senderId, data.payload.text || '', data.payload.timestamp);

                // ACK: confirm receipt
                try { conn.send({ type: 'message_ack', payload: { messageId: data.payload.id } }); } catch { }
            } else if (data.type === 'identity') {
                const { name, avatarUrl: remoteAvatarUrl, aboutMe: remoteAboutMe, status: remoteStatus } = data.payload;
                setPeerNames(prev => ({ ...prev, [conn.peer]: name }));
                setKnownPeers(prev => ({ ...prev, [conn.peer]: name }));
                if (remoteAvatarUrl) {
                    setPeerAvatars(prev => ({ ...prev, [conn.peer]: remoteAvatarUrl }));
                }
                if (remoteAboutMe !== undefined) {
                    setPeerAboutMe(prev => ({ ...prev, [conn.peer]: remoteAboutMe }));
                }
                if (remoteStatus) {
                    setPeerStatuses(prev => ({ ...prev, [conn.peer]: remoteStatus }));
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

                if (activeServerRef.current && conn.peer !== activeServerRef.current.id) {
                    console.warn(`[Security] Ignoring clear_chat from non-host peer: ${conn.peer}`);
                    return;
                }

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
                    if (!Array.isArray(reactions[emoji])) reactions[emoji] = [];
                    if (!reactions[emoji].includes(userId)) {
                        reactions[emoji] = [...reactions[emoji], userId];
                    } else {
                        reactions[emoji] = reactions[emoji].filter(id => id !== userId);
                        if (reactions[emoji].length === 0) delete reactions[emoji];
                    }
                    return { ...msg, reactions };
                }));
            } else if (data.type === 'edit_message') {

                const { id, newText } = data.payload;
                // SECURITY: Only allow the original sender to edit their message
                // SECURITY: Sanitize incoming text to prevent XSS bypass
                const sanitizedText = escapeHtml(newText);
                setMessagesRaw(prev => prev.map(msg =>
                    (msg.id === id && msg.senderId === conn.peer) ? { ...msg, text: sanitizedText, edited: true } : msg
                ));
            } else if (data.type === 'delete_message') {

                const { id } = data.payload;
                // SECURITY: Only allow the original sender to delete their message
                setMessagesRaw(prev => prev.filter(msg =>
                    !(msg.id === id && msg.senderId === conn.peer)
                ));
            } else if (data.type === 'pin_message') {
                const { messageId } = data.payload;
                setPinnedMessages(prev => {
                    if (prev.includes(messageId)) return prev;
                    const next = [...prev, messageId];
                    localStorage.setItem(pinnedKeyRef.current, JSON.stringify(next));
                    return next;
                });
            } else if (data.type === 'unpin_message') {
                const { messageId } = data.payload;
                setPinnedMessages(prev => {
                    const next = prev.filter(id => id !== messageId);
                    localStorage.setItem(pinnedKeyRef.current, JSON.stringify(next));
                    return next;
                });
            } else if (data.type === 'status_update') {
                setPeerStatuses(prev => ({ ...prev, [conn.peer]: data.payload.status }));
            } else if (data.type === 'group_kick') {
                const { groupId, kickedMemberId } = data.payload;
                if (kickedMemberId === peerId) {

                    setGroupDMs(prev => {
                        const next = { ...prev };
                        delete next[groupId];
                        localStorage.setItem('p2p_chat_groups', JSON.stringify(next));
                        return next;
                    });
                    if (activeDM === groupId) setActiveDM(null);
                } else {
                    setGroupDMs(prev => {
                        const group = prev[groupId];
                        if (!group) return prev;
                        const next = { ...prev, [groupId]: { ...group, members: group.members.filter(m => m !== kickedMemberId) } };
                        localStorage.setItem('p2p_chat_groups', JSON.stringify(next));
                        return next;
                    });
                }
            } else if (data.type === 'group_ownership_transfer') {
                const { groupId, newOwnerId } = data.payload;
                setGroupDMs(prev => {
                    const group = prev[groupId];
                    if (!group) return prev;
                    const next = { ...prev, [groupId]: { ...group, owner: newOwnerId } };
                    localStorage.setItem('p2p_chat_groups', JSON.stringify(next));
                    return next;
                });
            } else if (data.type === 'ping') {
                conn.send({ type: 'pong', payload: { timestamp: data.payload.timestamp } });
            } else if (data.type === 'pong') {
                const sent = data.payload.timestamp;
                // Reset heartbeat missed counter — peer is alive
                heartbeatMissedRef.current[conn.peer] = 0;
                if (sent) {
                    const rtt = Date.now() - sent;
                    setPeerLatencies(prev => ({ ...prev, [conn.peer]: rtt }));
                }
            } else if (data.type === 'role_update') {
                const { serverId, peerId: targetPeer, role } = data.payload;
                setServerRoles(prev => {
                    const serverData = { ...(prev[serverId] || {}), [targetPeer]: role };
                    const next = { ...prev, [serverId]: serverData };
                    localStorage.setItem('p2p_chat_server_roles', JSON.stringify(next));
                    return next;
                });
            } else if (data.type === 'call-busy') {
                const busyName = peerNames[conn.peer] || conn.peer.substring(0, 8);
                setError(`${busyName} is currently in another call`);
                setTimeout(() => setError(null), 5000);
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
            const disconnectedPeerId = conn.peer;
            console.log(`[P2P] Connection closed with ${disconnectedPeerId}`);

            pendingConnectionsRef.current.delete(disconnectedPeerId);
            e2eKeyExchangeInProgressRef.current.delete(disconnectedPeerId);
            delete e2eSharedKeysRef.current[disconnectedPeerId];
            delete e2ePendingQueuesRef.current[disconnectedPeerId];
            delete heartbeatMissedRef.current[disconnectedPeerId];

            if (serverMembersRef.current.has(disconnectedPeerId)) {
                serverMembersRef.current.delete(disconnectedPeerId);
                setServerMembers(new Set(serverMembersRef.current));
            }

            setConnections(prev => {
                const updated = prev.filter(c => c.peer !== disconnectedPeerId);
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

            // AUTO-RECONNECT: if we previously had a successful connection, try to reconnect
            if (knownConnectionsRef.current.has(disconnectedPeerId)) {
                const attempts = reconnectAttemptsRef.current[disconnectedPeerId] || 0;
                if (attempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempts), 30000);
                    console.log(`[P2P] Auto-reconnecting to ${disconnectedPeerId} in ${delay}ms (attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
                    reconnectAttemptsRef.current[disconnectedPeerId] = attempts + 1;

                    // Clear any existing reconnect timer
                    if (reconnectTimersRef.current[disconnectedPeerId]) {
                        clearTimeout(reconnectTimersRef.current[disconnectedPeerId]);
                    }

                    reconnectTimersRef.current[disconnectedPeerId] = setTimeout(() => {
                        delete reconnectTimersRef.current[disconnectedPeerId];
                        // Only reconnect if still not connected
                        if (!connectionsRef.current.some(c => c.peer === disconnectedPeerId)) {
                            delete failedPeersRef.current[disconnectedPeerId];
                            connectToPeer(disconnectedPeerId, true);
                        }
                    }, delay);
                } else {
                    console.warn(`[P2P] Max reconnect attempts reached for ${disconnectedPeerId}`);
                    knownConnectionsRef.current.delete(disconnectedPeerId);
                    delete reconnectAttemptsRef.current[disconnectedPeerId];
                }
            }
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
                metadata: { displayName: displayNameRef.current, avatarUrl: avatarUrlRef.current, isMesh: isSilentMesh }
            });

            const connectTimeout = setTimeout(() => {
                delete connectTimeoutsRef.current[id];
                if (pendingConnectionsRef.current.has(id)) {
                    pendingConnectionsRef.current.delete(id);
                    failedPeersRef.current[id] = Date.now();
                    const retries = retryCountsRef.current[id] || 0;
                    console.warn(`[P2P] Connection to ${id} timed out (attempt ${retries + 1}/${MAX_RETRIES + 1})`);

                    if (retries < MAX_RETRIES) {
                        retryCountsRef.current[id] = retries + 1;

                        delete failedPeersRef.current[id];
                        setTimeout(() => {
                            console.log(`[P2P] Auto-retrying connection to ${id}...`);
                            connectToPeer(id, isSilentMesh);
                        }, 2000);
                    }
                }
            }, 30000);
            connectTimeoutsRef.current[id] = connectTimeout;

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
        setServerRole(peerId, peerId, 'owner');
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
        const groupData = { id, name, members: [...members, peerId], owner: peerId };

        setGroupDMs(prev => {
            const next = { ...prev, [id]: groupData };
            localStorage.setItem('p2p_chat_groups', JSON.stringify(next));
            return next;
        });

        members.forEach(memberId => {
            const conn = connectionsRef.current.find(c => c.peer === memberId);
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
        connectionsRef.current.forEach(conn => {
            if (conn.open) conn.send({ type: 'typing', payload: { peerId } });
        });
    };

    const addReaction = (messageId: string, emoji: string) => {

        setMessagesRaw(prev => prev.map(msg => {
            if (msg.id !== messageId) return msg;
            const reactions = { ...(msg.reactions || {}) };
            if (!Array.isArray(reactions[emoji])) reactions[emoji] = [];
            if (!reactions[emoji].includes(peerId)) {
                reactions[emoji] = [...reactions[emoji], peerId];
            } else {
                reactions[emoji] = reactions[emoji].filter(id => id !== peerId);
                if (reactions[emoji].length === 0) delete reactions[emoji];
            }
            return { ...msg, reactions };
        }));

        connectionsRef.current.forEach(conn => {
            if (conn.open) conn.send({ type: 'reaction', payload: { messageId, emoji, userId: peerId } });
        });
    };

    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [lastMessages, setLastMessages] = useState<Record<string, { text: string; timestamp: number }>>({});
    const activeDMRef = useRef<string | null>(activeDM);
    useEffect(() => { activeDMRef.current = activeDM; }, [activeDM]);

    const clearUnread = (peerId: string) => {
        setUnreadCounts(prev => {
            if (!prev[peerId]) return prev;
            const next = { ...prev };
            delete next[peerId];
            return next;
        });
    };

    const trackIncomingMessage = (senderId: string, text: string, timestamp: number) => {

        setLastMessages(prev => ({ ...prev, [senderId]: { text: text.replace(/<[^>]*>/g, '').substring(0, 50), timestamp } }));

        if (!activeServerRef.current && activeDMRef.current !== senderId) {
            setUnreadCounts(prev => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
        }
    };

    const editMessage = (messageId: string, newText: string) => {
        setMessagesRaw(prev => prev.map(msg =>
            msg.id === messageId ? { ...msg, text: newText, edited: true } : msg
        ));
        connectionsRef.current.forEach(conn => {
            if (conn.open) conn.send({ type: 'edit_message', payload: { id: messageId, newText } });
        });
    };

    const deleteMessage = (messageId: string) => {
        setMessagesRaw(prev => prev.filter(msg => msg.id !== messageId));
        connectionsRef.current.forEach(conn => {
            if (conn.open) conn.send({ type: 'delete_message', payload: { id: messageId } });
        });
    };

    const pinMessage = (messageId: string) => {
        setPinnedMessages(prev => {
            if (prev.includes(messageId)) return prev;
            const next = [...prev, messageId];
            localStorage.setItem(pinnedKeyRef.current, JSON.stringify(next));
            return next;
        });
        connectionsRef.current.forEach(conn => {
            if (conn.open) conn.send({ type: 'pin_message', payload: { messageId } });
        });
    };

    const unpinMessage = (messageId: string) => {
        setPinnedMessages(prev => {
            const next = prev.filter(id => id !== messageId);
            localStorage.setItem(pinnedKeyRef.current, JSON.stringify(next));
            return next;
        });
        connectionsRef.current.forEach(conn => {
            if (conn.open) conn.send({ type: 'unpin_message', payload: { messageId } });
        });
    };

    const removeGroupMember = (groupId: string, memberId: string) => {
        setGroupDMs(prev => {
            const group = prev[groupId];
            if (!group || (group as any).owner !== peerId) return prev;
            const updatedGroup = { ...group, members: group.members.filter(m => m !== memberId) };
            const next = { ...prev, [groupId]: updatedGroup };
            localStorage.setItem('p2p_chat_groups', JSON.stringify(next));

            connectionsRef.current.forEach(conn => {
                if (conn.open && updatedGroup.members.includes(conn.peer)) {
                    conn.send({ type: 'group_kick', payload: { groupId, kickedMemberId: memberId } });
                }
            });

            const kickedConn = connectionsRef.current.find(c => c.peer === memberId);
            if (kickedConn && kickedConn.open) {
                kickedConn.send({ type: 'group_kick', payload: { groupId, kickedMemberId: memberId } });
            }
            return next;
        });
    };

    const transferGroupOwnership = (groupId: string, newOwnerId: string) => {
        setGroupDMs(prev => {
            const group = prev[groupId];
            if (!group || (group as any).owner !== peerId) return prev;
            const updatedGroup = { ...group, owner: newOwnerId };
            const next = { ...prev, [groupId]: updatedGroup };
            localStorage.setItem('p2p_chat_groups', JSON.stringify(next));

            connectionsRef.current.forEach(conn => {
                if (conn.open && updatedGroup.members.includes(conn.peer)) {
                    conn.send({ type: 'group_ownership_transfer', payload: { groupId, newOwnerId } });
                }
            });
            return next;
        });
    };

    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    const sendMessage = (text: string, fileAttachment?: UserMessage['file'], replyTo?: UserMessage['replyTo']) => {
        if ((!text.trim() && !fileAttachment) || connectionsRef.current.length === 0) return;

        if (!activeServer && !activeDM) return;

        if (text.trim().toLowerCase() === killSwitchRef.current.toLowerCase()) {
            const activeChannelId = activeServer ? activeServer.id : 'home';

            setMessages([]);
            localStorage.removeItem(`p2p_chat_history_${activeChannelId}`);

            connectionsRef.current.forEach(conn => {
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

            connectionsRef.current.forEach(conn => {
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
                            const targetConn = connectionsRef.current.find(c => c.peer === memberId);
                            if (targetConn && targetConn.open) {
                                e2eSend(targetConn, { type: 'message', payload: newMessage });
                            }
                        }
                    });
                }
                setMessages(prev => [...prev, newMessage]);
            } else {

                newMessage.channelId = activeDM;
                const targetConn = connectionsRef.current.find(c => c.peer === activeDM);
                if (targetConn && targetConn.open) {
                    e2eSend(targetConn, { type: 'message', payload: newMessage });
                } else {
                    // Peer is offline — queue the message for delivery on reconnect
                    queueOfflineMessage(activeDM, { type: 'message', payload: newMessage });
                    console.log(`[OFFLINE] Queued message for offline peer ${activeDM}`);
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

        const videoConstraints: any = withVideo
            ? (audioSettings.videoDeviceId ? { deviceId: { exact: audioSettings.videoDeviceId } } : true)
            : false;

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
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

    const [activeCallDM, setActiveCallDM] = useState<string | null>(null);

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
                });

                mediaConnectionsRef.current[call.peer] = call;

                // Track which DM this call belongs to
                if (!activeCallDM) {
                    setActiveCallDM(activeDMRef.current);
                }
            } catch (err: any) {
                setError('Failed to start call: ' + err.message);
            }
        }
    };

    const answerCall = async () => {
        if (!incomingCall) return;

        // End existing calls first (switch to new call)
        if (Object.keys(mediaConnectionsRef.current).length > 0) {
            Object.keys(mediaConnectionsRef.current).forEach(id => {
                mediaConnectionsRef.current[id].close();
                delete mediaConnectionsRef.current[id];
            });
            setRemoteStreams({});
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                setLocalStream(null);
                localStreamRef.current = null;
                setIsScreenSharing(false);
                setIsVideoEnabled(false);
            }
        }

        let stream = await initLocalStream(incomingCallIsVideo);

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
        });

        // Set activeCallDM to the caller's DM and switch to it
        setActiveCallDM(incomingCall.peer);
        setActiveDM(incomingCall.peer);

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

        setActiveCallDM(null);
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
                    const vidConstraints = audioSettings.videoDeviceId
                        ? { deviceId: { exact: audioSettings.videoDeviceId } }
                        : true;
                    const vidStream = await navigator.mediaDevices.getUserMedia({ video: vidConstraints });
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

            const isElectron = !!(window as any).electronAPI;

            if (isElectron) {
                const sources = await (window as any).electronAPI.getDesktopSources();
                const source = sources.find((s: any) => s.id.startsWith('screen')) || sources[0];

                // Video from screen
                screenStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: source.id
                        }
                    } as any,
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
            addReaction,
            unreadCounts,
            lastMessages,
            clearUnread,
            editMessage,
            deleteMessage,
            pinnedMessages,
            pinMessage,
            unpinMessage,
            userStatus,
            setUserStatus,
            aboutMe,
            setAboutMe,
            peerStatuses,
            peerAboutMe,
            removeGroupMember,
            transferGroupOwnership,
            pttEnabled,
            setPttEnabled,
            pttKey,
            setPttKey,
            peerLatencies,
            serverRoles,
            setServerRole,
            getServerRole,
            friendsList,
            addFriend,
            removeFriend,
            peerVolumes,
            setPeerVolume,
            activeCallPeerIds: Object.keys(remoteStreams),
            activeCallDM
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
