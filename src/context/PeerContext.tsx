import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import {
    exportPublicKey, importPublicKey, deriveSharedKey, encryptMessage, decryptMessage,
    loadOrCreateIdentityKeyPair, keyFingerprint, safetyNumber,
} from '../crypto';
import { playMessageSound, startRingtone, stopRingtone, playCallConnectSound, playCallDisconnectSound, playUserJoinSound, playUserLeaveSound, getNotificationPrefs } from '../utils/sounds';
import { stripHtml } from '../utils/sanitize';
import { safeSetItem } from '../utils/storage';
import { IceConfig, readIceConfig, saveIceConfig, buildIceServers, turnIsConfigured } from '../utils/ice';
import {
    loadRecent, loadBefore, putMessages, deleteChannel, clearAllMessages,
    deleteMessage as dbDeleteMessage, trimChannel, migrateLegacyHistory,
    MAX_STORED_PER_CHANNEL,
} from '../utils/db';

export type UserMessage = {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
    timestamp: number;
    channelId?: string;
    serverId?: string; // 'home' for DMs, server peerId for servers
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
    edited?: boolean;
};

export type ScreenSource = { id: string; name: string; thumbnail?: string };

// User-authored profile badges. Purely cosmetic, broadcast with identity.
export type Badge = { id: string; label: string; icon: string; color: string };

export const MAX_BADGES = 5;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

// Badges arrive from other peers, so everything about them is untrusted input.
export const sanitizeBadges = (input: unknown): Badge[] => {
    if (!Array.isArray(input)) return [];
    const out: Badge[] = [];
    for (const raw of input.slice(0, MAX_BADGES)) {
        if (!raw || typeof raw !== 'object') continue;
        const b = raw as Record<string, unknown>;
        const label = typeof b.label === 'string' ? b.label.slice(0, 20) : '';
        const icon = typeof b.icon === 'string' ? [...b.icon].slice(0, 2).join('') : '';
        const color = typeof b.color === 'string' && HEX_COLOR.test(b.color) ? b.color : '#5865f2';
        if (!label && !icon) continue;
        out.push({ id: typeof b.id === 'string' ? b.id.slice(0, 40) : Math.random().toString(36).slice(2, 10), label, icon, color });
    }
    return out;
};

// A file in flight. Large attachments are streamed in chunks so both sides can
// show progress instead of freezing on one giant data-channel frame.
export type FileTransfer = {
    id: string;
    name: string;
    type: string;
    size: number;
    transferred: number;
    direction: 'in' | 'out';
    peerId: string;
    peerName: string;
    serverId: string;
    channelId: string;
    failed?: boolean;
};

export type KeybindAction = 'toggleMute' | 'toggleDeafen' | 'toggleVideo' | 'toggleScreenShare' | 'endCall' | 'toggleNotifications';

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
    toggleMute: 'Toggle Mute',
    toggleDeafen: 'Toggle Deafen',
    toggleVideo: 'Toggle Camera',
    toggleScreenShare: 'Toggle Screen Share',
    endCall: 'Disconnect Call',
    toggleNotifications: 'Mute / Unmute Notifications',
};

export const DEFAULT_KEYBINDS: Record<KeybindAction, string> = {
    toggleMute: 'Ctrl+Shift+KeyM',
    toggleDeafen: 'Ctrl+Shift+KeyD',
    toggleVideo: 'Ctrl+Shift+KeyV',
    toggleScreenShare: 'Ctrl+Shift+KeyS',
    endCall: 'Ctrl+Shift+KeyH',
    toggleNotifications: 'Ctrl+Shift+KeyN',
};

// Canonical "Ctrl+Shift+KeyM" form so binding and matching always agree.
export const describeKeyEvent = (e: KeyboardEvent | React.KeyboardEvent): string => {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    const code = (e as KeyboardEvent).code || '';
    if (!code || /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)) return '';
    parts.push(code);
    return parts.join('+');
};

export const prettyKeybind = (bind: string): string =>
    bind
        .split('+')
        .map(part => part.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num '))
        .join(' + ') || 'Unbound';

export type AudioSettings = {
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
    deviceId?: string;
    videoDeviceId?: string;
    inputSensitivity: number; // -1 = auto, 0-100 = manual threshold
    masterVolume: number; // 0-200, applied on output for all peers
    inputVolume: number; // 0-200, mic boost before sending
    highPassFilter: boolean; // remove low-freq rumble
    // Screen share capture quality. 0 height means "whatever the source is".
    screenHeight: number; // 0 | 720 | 1080 | 1440 | 2160
    screenFps: number; // 15 | 30 | 60
    screenAudioEnabled: boolean; // capture desktop audio alongside video
    screenAudioVolume: number; // 0-200, desktop audio level in the outgoing mix
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

    typingPeers: Record<string, { ts: number; scope?: string }>;
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

    // Voice channel awareness (mesh-broadcast)
    peerVoiceChannels: Record<string, string | null>;
    joinVoiceChannel: (channelId: string) => void;
    leaveVoiceChannel: () => void;

    // Mic level for live preview in settings
    micLevel: number; // 0-100

    // Wipe all chat history across servers + DMs
    clearAllHistory: () => void;

    // Older messages beyond the in-memory window
    hasEarlierMessages: boolean;
    loadingEarlier: boolean;
    loadEarlierMessages: () => void;

    // Custom text channels per server (managed by the host, synced to members)
    getServerChannels: (serverId: string) => string[];
    addServerChannel: (name: string) => void;
    removeServerChannel: (name: string) => void;

    // Unread message counts for background servers (keyed by server id)
    serverUnreads: Record<string, number>;

    // Message ids confirmed received by at least one peer
    deliveredMessageIds: Set<string>;

    // Connection state to the PeerJS signaling server
    signalStatus: 'connecting' | 'connected' | 'reconnecting';

    // TURN relay configuration. Applying it rebuilds the peer connection.
    iceConfig: IceConfig;
    applyIceConfig: (cfg: IceConfig) => void;

    // End-to-end encryption identity. The safety number is what two people read
    // to each other to confirm nobody is relaying between them.
    peerSafetyNumbers: Record<string, string>;
    verifiedPeers: Record<string, boolean>;
    setPeerVerified: (peerId: string, verified: boolean) => void;
    // Peers whose long-term key stopped matching the one we first saw
    peerKeyChanged: Record<string, boolean>;

    // Electron screen-share source picker
    screenShareSources: ScreenSource[] | null;
    selectScreenShareSource: (sourceId: string | null) => void;

    // First time we ever connected to each peer (for "member since")
    peerFirstSeen: Record<string, number>;

    // Cosmetic profile badges, mine and everyone else's
    badges: Badge[];
    setBadges: (badges: Badge[]) => void;
    peerBadges: Record<string, Badge[]>;

    // Attachments currently streaming in or out
    fileTransfers: Record<string, FileTransfer>;

    // Configurable shortcuts
    keybinds: Record<KeybindAction, string>;
    setKeybind: (action: KeybindAction, bind: string) => void;
    resetKeybinds: () => void;
    // When on, shortcuts also fire while the app is in the background
    globalKeybinds: boolean;
    setGlobalKeybinds: (enabled: boolean) => void;
    // Actions the OS refused to hand us, usually taken by another app
    globalKeybindIssues: KeybindAction[];

    // Quick mute for every sound and desktop notification
    notificationsMuted: boolean;
    toggleNotificationsMuted: () => void;

    // Minutes of inactivity before the status flips to Idle. 0 disables it.
    idleMinutes: number;
    setIdleMinutes: (minutes: number) => void;

    // Desktop audio captured with a screen share
    isScreenAudioMuted: boolean;
    toggleScreenAudio: () => void;

    // What each peer says it is actually sending, so a stopped share does not
    // leave its last frame frozen on our screen.
    peerVideoStates: Record<string, { video: boolean; screen: boolean }>;
}

// SECURITY: message HTML is sanitized at render time (see utils/sanitize.ts),
// which covers locally composed, remotely received, and remotely edited content.

const DEFAULT_CHANNELS = ['general', 'gaming'];

// A live (non-history) message must originate from the peer that delivered it —
// PeerJS authenticates the transport peer id, so a mismatch means the sender is
// spoofing someone else's identity. Also enforce the same size budget the send
// path checks, so a peer can't bypass it to bloat our storage.
const MAX_FILE_B64_LEN = 14_000_000; // ~10.5 MB binary (10 MB send cap + base64 overhead)

// Attachments above this size are streamed as chunks so neither side blocks on
// one huge data-channel frame and both can render a progress bar.
const INLINE_FILE_LIMIT = 64 * 1024;   // base64 chars
const CHUNK_B64_SIZE = 48 * 1024;      // base64 chars per chunk
const MAX_ACTIVE_INCOMING_PER_PEER = 3;
const DC_HIGH_WATER = 1_000_000;       // pause sending above this buffered amount
const DC_LOW_WATER = 256_000;          // resume once it drains below this

// base64 expands 3 bytes into 4 characters.
const b64Bytes = (len: number) => Math.floor((len * 3) / 4);
const isValidLiveMessage = (msg: any, fromPeer: string): boolean => {
    if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string') return false;
    if (msg.senderId !== fromPeer) return false;
    if (msg.file && typeof msg.file.data === 'string' && msg.file.data.length > MAX_FILE_B64_LEN) return false;
    return true;
};

// Slugify with Turkish transliteration so "Müzik Odası" → "muzik-odasi"
const sanitizeChannelName = (name: string): string =>
    name.trim()
        .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i')
        .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 24);

// History (sync) batches legitimately carry other people's messages, so the
// strict "sender must be the transport peer" rule cannot apply. Enforce shape,
// size and batch limits instead, plus a per-channel sender allowlist at the
// call site.
const MAX_SYNC_BATCH = 200;
const MAX_TEXT_LEN = 200000;
const isValidHistoryMessage = (m: any): boolean => {
    if (!m || typeof m !== 'object') return false;
    if (typeof m.id !== 'string' || m.id.length === 0 || m.id.length > 128) return false;
    if (typeof m.senderId !== 'string' || m.senderId.length === 0 || m.senderId.length > 128) return false;
    if (typeof m.timestamp !== 'number' || !isFinite(m.timestamp)) return false;
    if (m.text !== undefined && typeof m.text !== 'string') return false;
    if (typeof m.text === 'string' && m.text.length > MAX_TEXT_LEN) return false;
    if (m.senderName !== undefined && (typeof m.senderName !== 'string' || m.senderName.length > 128)) return false;
    if (m.channelId !== undefined && (typeof m.channelId !== 'string' || m.channelId.length > 128)) return false;
    if (m.file !== undefined) {
        if (!m.file || typeof m.file !== 'object') return false;
        if (typeof m.file.data !== 'string' || m.file.data.length > MAX_FILE_B64_LEN) return false;
        if (typeof m.file.name !== 'string' || typeof m.file.type !== 'string') return false;
    }
    return true;
};

const PeerContext = createContext<PeerContextType | undefined>(undefined);

interface PeerProviderProps {
    children: ReactNode;
    initialId: string;
    displayName: string;
}

export const PeerProvider: React.FC<PeerProviderProps> = ({ children, initialId, displayName }) => {
    const [peerId, setPeerId] = useState<string>('');
    // Event handlers registered in the [initialId] effect close over the mount
    // render, where peerId is '' and peer is null. Anything those handlers read
    // must come from a ref, or every incoming-connection code path misbehaves.
    const peerIdRef = useRef<string>('');
    const peerRef = useRef<Peer | null>(null);
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
    // Refs for use inside connection event handlers, which close over the render
    // they were created in and would otherwise read stale (often empty) maps.
    const peerNamesRef = useRef<Record<string, string>>({});
    const peerAvatarsRef = useRef<Record<string, string>>({});
    useEffect(() => { peerNamesRef.current = peerNames; }, [peerNames]);
    useEffect(() => { peerAvatarsRef.current = peerAvatars; }, [peerAvatars]);
    // NOTE: known peers used to share the 'p2p_chat_friends' key with the
    // friends list (an array), and the two clobbered each other. Known peers now
    // live under their own key; the old key is only read as a legacy fallback.
    const [knownPeers, setKnownPeers] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('p2p_chat_known_peers') || localStorage.getItem('p2p_chat_friends');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch (e) { return {}; }
        }
        return {};
    });

    const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => {
        const saved = localStorage.getItem('p2p_chat_audio_settings');
        const defaults = {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
            inputSensitivity: -1,
            masterVolume: 100,
            inputVolume: 100,
            highPassFilter: true,
            screenHeight: 1080,
            screenFps: 30,
            screenAudioEnabled: true,
            screenAudioVolume: 100,
        };
        if (saved) {
            try { return { ...defaults, ...JSON.parse(saved) }; } catch (e) { }
        }
        return defaults;
    });

    const updateAudioSettings = async (newSettings: Partial<AudioSettings>) => {
        const updated = { ...audioSettings, ...newSettings };
        setAudioSettings(updated);
        audioSettingsRef.current = updated;
        localStorage.setItem('p2p_chat_audio_settings', JSON.stringify(updated));

        // Live-update the processing graph so the user hears the change without rejoining
        const g = audioGraphRef.current;
        if (g) {
            const now = g.ctx.currentTime;
            if (newSettings.inputVolume !== undefined) {
                g.inputGain.gain.setTargetAtTime((updated.inputVolume ?? 100) / 100, now, 0.02);
            }
            if (newSettings.highPassFilter !== undefined) {
                g.highPass.frequency.setTargetAtTime(updated.highPassFilter ? 85 : 1, now, 0.05);
            }
        }

        // Desktop-audio level is adjustable mid-share.
        if (newSettings.screenAudioVolume !== undefined) {
            const mix = screenAudioMixRef.current;
            if (mix?.screenGain) {
                const target = isScreenAudioMutedRef.current ? 0 : (updated.screenAudioVolume ?? 100) / 100;
                mix.screenGain.gain.setTargetAtTime(target, mix.ctx.currentTime, 0.03);
            }
        }

        if (localStream) {
            const sourceTrack = (localStream.getAudioTracks()[0] as any)?._sourceTrack as MediaStreamTrack | undefined;
            const audioTrack = sourceTrack || localStream.getAudioTracks()[0];
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
    const joinedServersRef = useRef<{ id: string, name: string }[]>(joinedServers);
    useEffect(() => { joinedServersRef.current = joinedServers; }, [joinedServers]);

    // Server roles: { serverId: { peerId: 'owner'|'admin'|'mod'|'member' } }
    type ServerRole = 'owner' | 'admin' | 'mod' | 'member';
    const [serverRoles, setServerRoles] = useState<Record<string, Record<string, string>>>(() => {
        const saved = localStorage.getItem('p2p_chat_server_roles');
        if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
        return {};
    });

    // Pure lookup — must NOT set state, it's called during render.
    // The server host (peer id === server id) is implicitly the owner.
    const getServerRole = (serverId: string, targetPeerId: string): string => {
        const assigned = serverRoles[serverId]?.[targetPeerId];
        if (assigned) return assigned;
        if (targetPeerId === serverId) return 'owner';
        return 'member';
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

    // Friends list — own key ('p2p_chat_friends' legacy array is migrated once)
    const [friendsList, setFriendsList] = useState<string[]>(() => {
        const saved = localStorage.getItem('p2p_chat_friends_list') || localStorage.getItem('p2p_chat_friends');
        if (saved) { try { const parsed = JSON.parse(saved); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
        return [];
    });

    const addFriend = (targetPeerId: string) => {
        setFriendsList(prev => {
            if (prev.includes(targetPeerId)) return prev;
            const next = [...prev, targetPeerId];
            safeSetItem('p2p_chat_friends_list', JSON.stringify(next));
            return next;
        });
    };

    const removeFriend = (targetPeerId: string) => {
        setFriendsList(prev => {
            const next = prev.filter(id => id !== targetPeerId);
            safeSetItem('p2p_chat_friends_list', JSON.stringify(next));
            return next;
        });
    };

    // Per-user volume (shared state)
    const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('p2p_chat_volumes');
        if (saved) { try { return JSON.parse(saved) || {}; } catch { return {}; } }
        return {};
    });
    const setPeerVolume = (targetPeerId: string, vol: number) => {
        setPeerVolumes(prev => {
            const next = { ...prev, [targetPeerId]: vol };
            localStorage.setItem('p2p_chat_volumes', JSON.stringify(next));
            return next;
        });
    };

    const [activeChannel, setActiveChannel] = useState<string>('general');
    const activeChannelRef = useRef('general');
    useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);
    const [activeVoiceChannel, setActiveVoiceChannelRaw] = useState<string | null>(null);
    const activeVoiceChannelRef = useRef<string | null>(null);
    const setActiveVoiceChannel = (id: string | null) => {
        setActiveVoiceChannelRaw(id);
        activeVoiceChannelRef.current = id;
    };
    const [activeDM, setActiveDM] = useState<string | null>(null);

    // Custom text channels per server: { serverId: ['general', ...] }
    // The host is the source of truth and pushes the list to members on join/change.
    const [serverChannels, setServerChannels] = useState<Record<string, string[]>>(() => {
        const saved = localStorage.getItem('p2p_chat_server_channels');
        if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
        return {};
    });
    const serverChannelsRef = useRef(serverChannels);
    useEffect(() => { serverChannelsRef.current = serverChannels; }, [serverChannels]);

    const getServerChannels = (serverId: string): string[] => serverChannels[serverId] ?? DEFAULT_CHANNELS;

    const storeServerChannels = (serverId: string, channels: string[]) => {
        setServerChannels(prev => {
            const next = { ...prev, [serverId]: channels };
            serverChannelsRef.current = next;
            safeSetItem('p2p_chat_server_channels', JSON.stringify(next));
            return next;
        });
    };

    const broadcastServerChannels = (serverId: string, channels: string[]) => {
        connectionsRef.current.forEach(conn => {
            if (conn.open && serverMembersRef.current.has(conn.peer)) {
                try { conn.send({ type: 'channel_list', payload: { serverId, channels } }); } catch { }
            }
        });
    };

    const addServerChannel = (name: string) => {
        const server = activeServerRef.current;
        if (!server || server.id !== peerId) return; // host-only
        const clean = sanitizeChannelName(name);
        if (!clean) return;
        const current = serverChannelsRef.current[server.id] ?? DEFAULT_CHANNELS;
        if (current.includes(clean) || current.length >= 50) return;
        const next = [...current, clean];
        storeServerChannels(server.id, next);
        broadcastServerChannels(server.id, next);
    };

    const removeServerChannel = (name: string) => {
        const server = activeServerRef.current;
        if (!server || server.id !== peerId) return; // host-only
        if (name === 'general') return;
        const current = serverChannelsRef.current[server.id] ?? DEFAULT_CHANNELS;
        if (!current.includes(name)) return;
        const next = current.filter(c => c !== name);
        storeServerChannels(server.id, next);
        broadcastServerChannels(server.id, next);
        if (activeChannelRef.current === name) setActiveChannel('general');
    };

    // Unread counts for servers you're not currently viewing
    const [serverUnreads, setServerUnreads] = useState<Record<string, number>>({});

    // Message ids that at least one recipient has ACKed
    const [deliveredMessageIds, setDeliveredMessageIds] = useState<Set<string>>(new Set());

    // Signaling (PeerJS broker) connection state
    const [signalStatus, setSignalStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
    const brokerRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The peer instance currently in charge — events from peers torn down by a
    // previous effect run (React StrictMode double-mount) must be ignored.
    const activePeerRef = useRef<Peer | null>(null);

    // Electron screen-share source picker state
    const [screenShareSources, setScreenShareSources] = useState<ScreenSource[] | null>(null);

    // ICE / TURN. Changing it tears down and rebuilds the peer, which is the
    // only way new ICE servers can take effect, so it is an explicit action.
    const [iceConfig, setIceConfigState] = useState<IceConfig>(() => readIceConfig());
    const iceConfigRef = useRef(iceConfig);
    const [peerEpoch, setPeerEpoch] = useState(0);

    const applyIceConfig = (cfg: IceConfig) => {
        iceConfigRef.current = cfg;
        setIceConfigState(cfg);
        saveIceConfig(cfg);
        setPeerEpoch(e => e + 1);
    };

    // First-seen timestamps per peer ("member since")
    const [peerFirstSeen, setPeerFirstSeen] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem('p2p_chat_first_seen');
        if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
        return {};
    });
    useEffect(() => {
        if (!localStorage.getItem('p2p_chat_created_at')) {
            safeSetItem('p2p_chat_created_at', String(Date.now()));
        }
    }, []);

    // Voice channel awareness — synced via mesh broadcast
    const [peerVoiceChannels, setPeerVoiceChannels] = useState<Record<string, string | null>>({});

    // ---- cosmetic badges -------------------------------------------------
    const [badges, setBadgesState] = useState<Badge[]>(() => {
        const saved = localStorage.getItem('p2p_chat_badges');
        if (saved) { try { return sanitizeBadges(JSON.parse(saved)); } catch { return []; } }
        return [];
    });
    const badgesRef = useRef<Badge[]>(badges);
    const [peerBadges, setPeerBadges] = useState<Record<string, Badge[]>>({});

    // ---- file transfers in flight ---------------------------------------
    const [fileTransfers, setFileTransfers] = useState<Record<string, FileTransfer>>({});
    const incomingTransfersRef = useRef<Record<string, { info: FileTransfer; parts: string[]; received: number; message: any }>>({});

    // ---- configurable shortcuts -----------------------------------------
    const [keybinds, setKeybindsState] = useState<Record<KeybindAction, string>>(() => {
        const saved = localStorage.getItem('p2p_chat_keybinds');
        if (saved) {
            try { return { ...DEFAULT_KEYBINDS, ...JSON.parse(saved) }; } catch { return { ...DEFAULT_KEYBINDS }; }
        }
        return { ...DEFAULT_KEYBINDS };
    });

    const [globalKeybinds, setGlobalKeybindsState] = useState<boolean>(
        () => localStorage.getItem('p2p_chat_global_keybinds') === 'true');
    const [globalKeybindIssues, setGlobalKeybindIssues] = useState<KeybindAction[]>([]);

    const setGlobalKeybinds = (enabled: boolean) => {
        setGlobalKeybindsState(enabled);
        try { localStorage.setItem('p2p_chat_global_keybinds', String(enabled)); } catch { /* quota */ }
    };

    // ---- global notification mute ---------------------------------------
    const [notificationsMuted, setNotificationsMuted] = useState<boolean>(() => localStorage.getItem('p2p_chat_notif_muted') === 'true');
    const notificationsMutedRef = useRef(notificationsMuted);
    useEffect(() => { notificationsMutedRef.current = notificationsMuted; }, [notificationsMuted]);
    const toggleNotificationsMuted = () => {
        setNotificationsMuted(prev => {
            const next = !prev;
            notificationsMutedRef.current = next;
            localStorage.setItem('p2p_chat_notif_muted', String(next));
            if (next) stopRingtone();
            return next;
        });
    };

    // One place that decides whether any alert may fire. Do Not Disturb and the
    // quick mute both silence sounds and desktop notifications.
    const alertsAllowed = () => !notificationsMutedRef.current && userStatusRef.current !== 'dnd';

    // ---- screen share desktop audio -------------------------------------
    const [isScreenAudioMuted, setIsScreenAudioMuted] = useState(false);
    const isScreenAudioMutedRef = useRef(false);

    // ---- what each peer is actually sending ------------------------------
    const [peerVideoStates, setPeerVideoStates] = useState<Record<string, { video: boolean; screen: boolean }>>({});

    // A stopped screen share used to leave its final frame stuck on every
    // viewer. Two things fix that: peers are told the video ended, and the
    // outgoing track is swapped for one that keeps pushing black frames so even
    // a client that ignores the signal repaints.
    const blankTrackRef = useRef<{ track: MediaStreamTrack; timer: ReturnType<typeof setInterval> } | null>(null);

    const createBlankVideoTrack = (): MediaStreamTrack | null => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 360;
            const ctx = canvas.getContext('2d');
            const paint = () => {
                if (!ctx) return;
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            };
            paint();
            const track = (canvas as any).captureStream(4).getVideoTracks()[0] as MediaStreamTrack;
            (track as any).isBlank = true;
            const timer = setInterval(paint, 250);
            blankTrackRef.current = { track, timer };
            return track;
        } catch {
            return null;
        }
    };

    const releaseBlankTrack = () => {
        const b = blankTrackRef.current;
        if (!b) return;
        clearInterval(b.timer);
        try { b.track.stop(); } catch { /* already stopped */ }
        blankTrackRef.current = null;
    };

    // Tell peers what our outgoing video actually contains right now.
    const broadcastVideoState = (video: boolean, screen: boolean) => {
        connectionsRef.current.forEach(c => {
            if (c.open) {
                try { c.send({ type: 'video_state', payload: { video, screen } }); } catch { /* peer went away */ }
            }
        });
    };

    // Per-call type so we don't kill voice-channel calls when answering DM calls
    const callTypesRef = useRef<Record<string, 'voice-channel' | 'dm'>>({});

    // Audio processing graph — built once per call session, updated live
    const audioGraphRef = useRef<{
        ctx: AudioContext;
        source: MediaStreamAudioSourceNode;
        highPass: BiquadFilterNode;
        inputGain: GainNode;
        gateGain: GainNode;
        analyser: AnalyserNode;
        dest: MediaStreamAudioDestinationNode;
        rafId: number;
    } | null>(null);

    // Live mic level for settings UI
    const [micLevel, setMicLevel] = useState(0);
    const micLevelMonitorRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);

    // Stable ref so peer.on('call') auto-answer can call the latest initLocalStream
    // even though that listener is registered once in a [initialId] effect.
    const initLocalStreamRef = useRef<((withVideo: boolean) => Promise<MediaStream>) | null>(null);

    // Ref tracks the current audioSettings — keeps the tick() loop reading live values
    // (sensitivity threshold) without needing to rebuild the graph on every change.
    const audioSettingsRef = useRef<AudioSettings | null>(null);

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

    // History lives in IndexedDB now. The channel key is the server id, or
    // 'home' for every direct message, which matches how messages are tagged.
    const historyKey = activeServer ? activeServer.id : 'home';
    const historyKeyRef = useRef(historyKey);
    useEffect(() => { historyKeyRef.current = historyKey; }, [historyKey]);

    // How many messages are held in React state at once. The store keeps far
    // more; older ones arrive through "load earlier".
    const MAX_MESSAGES = 500;

    const [messages, setMessagesRaw] = useState<UserMessage[]>([]);
    const messagesRef = useRef<UserMessage[]>([]);
    const [hasEarlierMessages, setHasEarlierMessages] = useState(false);
    const [loadingEarlier, setLoadingEarlier] = useState(false);

    // Writes are batched: a burst of incoming messages becomes one transaction.
    const pendingWritesRef = useRef<Map<string, Map<string, UserMessage>>>(new Map());
    const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushWrites = () => {
        const batches = pendingWritesRef.current;
        pendingWritesRef.current = new Map();
        writeTimerRef.current = null;
        batches.forEach((byId, channel) => {
            const rows = [...byId.values()];
            putMessages(channel, rows).then(ok => {
                if (ok && rows.length > 0) trimChannel(channel, MAX_STORED_PER_CHANNEL);
            });
        });
    };

    const persistMessages = (channel: string, rows: UserMessage[]) => {
        if (rows.length === 0) return;
        let byId = pendingWritesRef.current.get(channel);
        if (!byId) {
            byId = new Map();
            pendingWritesRef.current.set(channel, byId);
        }
        rows.forEach(m => { if (m && typeof m.id === 'string') byId!.set(m.id, m); });
        if (!writeTimerRef.current) writeTimerRef.current = setTimeout(flushWrites, 400);
    };

    // Single entry point for message-state changes. It diffs against the previous
    // array so edits, reactions and new arrivals all persist without every call
    // site having to remember to save.
    const setMessages = (updater: UserMessage[] | ((prev: UserMessage[]) => UserMessage[])) => {
        setMessagesRaw(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            const capped = next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
            const before = new Map(prev.map(m => [m.id, m]));
            // Identity comparison is enough: every update path rebuilds the
            // objects it touches rather than mutating them in place.
            const changed = capped.filter(m => before.get(m.id) !== m);
            if (changed.length > 0) persistMessages(historyKeyRef.current, changed);
            if (capped.length < next.length) setHasEarlierMessages(true);
            return capped;
        });
    };

    const [error, setError] = useState<string | null>(null);

    // One-time move of any pre-IndexedDB history, then load the home chat.
    useEffect(() => {
        let alive = true;
        (async () => {
            await migrateLegacyHistory();
            const rows = await loadRecent('home', MAX_MESSAGES);
            if (!alive) return;
            setMessagesRaw(rows);
            setHasEarlierMessages(rows.length >= MAX_MESSAGES);
        })();
        return () => {
            alive = false;
            if (writeTimerRef.current) {
                clearTimeout(writeTimerRef.current);
                flushWrites();
            }
        };
    }, []);

    // Pull the next page of older messages for the chat on screen.
    const loadEarlierMessages = async () => {
        if (loadingEarlier) return;
        setLoadingEarlier(true);
        try {
            const channel = historyKeyRef.current;
            const oldest = messages.length > 0 ? messages[0].timestamp : Date.now();
            const older = await loadBefore(channel, oldest, 200);
            if (older.length === 0) {
                setHasEarlierMessages(false);
                return;
            }
            setMessagesRaw(prev => {
                const seen = new Set(prev.map(m => m.id));
                return [...older.filter(m => !seen.has(m.id)), ...prev];
            });
            setHasEarlierMessages(older.length >= 200);
        } finally {
            setLoadingEarlier(false);
        }
    };

    useEffect(() => {
        safeSetItem('p2p_chat_servers', JSON.stringify(joinedServers));
    }, [joinedServers]);

    useEffect(() => {
        safeSetItem('p2p_chat_known_peers', JSON.stringify(knownPeers));
    }, [knownPeers]);

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<{ [peerId: string]: MediaStream }>({});
    const [incomingCall, setIncomingCall] = useState<MediaConnection | null>(null);
    const [incomingCallIsVideo, setIncomingCallIsVideo] = useState<boolean>(true);
    const mediaConnectionsRef = useRef<{ [peerId: string]: MediaConnection }>({});
    const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);
    // Raw capture stream from getDisplayMedia/desktopCapturer, kept so every
    // screen track can be stopped on share end.
    const screenCaptureStreamRef = useRef<MediaStream | null>(null);
    // Mic + screen-audio mix pipeline. PeerJS can't renegotiate, so screen audio
    // only reaches peers by replacing the existing outgoing audio track.
    const screenAudioMixRef = useRef<{
        ctx: AudioContext;
        mixedTrack: MediaStreamTrack;
        originalTrack: MediaStreamTrack | null;
        screenGain: GainNode | null;
    } | null>(null);

    // Trust-on-first-use record for every peer we have exchanged keys with.
    type PeerKeyRecord = { fp: string; verified: boolean; firstSeen: number };
    const readPeerKeys = (): Record<string, PeerKeyRecord> => {
        try {
            const v = JSON.parse(localStorage.getItem('p2p_chat_peer_keys') || '{}');
            return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        } catch { return {}; }
    };
    const peerKeysRef = useRef<Record<string, PeerKeyRecord>>(readPeerKeys());
    const [peerSafetyNumbers, setPeerSafetyNumbers] = useState<Record<string, string>>({});
    const [verifiedPeers, setVerifiedPeers] = useState<Record<string, boolean>>(() => {
        const out: Record<string, boolean> = {};
        Object.entries(readPeerKeys()).forEach(([id, rec]) => { if (rec?.verified) out[id] = true; });
        return out;
    });
    const [peerKeyChanged, setPeerKeyChanged] = useState<Record<string, boolean>>({});

    const savePeerKeys = () => {
        safeSetItem('p2p_chat_peer_keys', JSON.stringify(peerKeysRef.current));
    };

    const setPeerVerified = (targetPeerId: string, verified: boolean) => {
        const rec = peerKeysRef.current[targetPeerId];
        if (!rec) return;
        peerKeysRef.current[targetPeerId] = { ...rec, verified };
        savePeerKeys();
        setVerifiedPeers(prev => ({ ...prev, [targetPeerId]: verified }));
        // Acknowledging the new key clears the mismatch warning.
        if (verified) setPeerKeyChanged(prev => ({ ...prev, [targetPeerId]: false }));
    };

    const e2eKeyPairRef = useRef<CryptoKeyPair | null>(null);
    const e2eSharedKeysRef = useRef<Record<string, CryptoKey>>({});
    const e2eKeyExchangeInProgressRef = useRef<Set<string>>(new Set());
    const e2ePendingQueuesRef = useRef<Record<string, any[]>>({});

    useEffect(() => {
        loadOrCreateIdentityKeyPair().then(kp => {
            e2eKeyPairRef.current = kp;
            console.log('[E2E] \u{1F511} Identity key ready');
        }).catch(err => console.error('[E2E] Identity key failed:', err));
    }, []);

    const [isMuted, setIsMuted] = useState(false);
    const isMutedRef = useRef(false);
    const [isDeafened, setIsDeafened] = useState(false);
    const isDeafenedRef = useRef(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const isVideoEnabledRef = useRef(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const isScreenSharingRef = useRef(false);
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

    // Global shortcuts. Bindings are matched against the canonical
    // "Ctrl+Shift+KeyM" string so layout-independent key codes are used.
    const keybindHandlersRef = useRef<Partial<Record<KeybindAction, () => void>>>({});
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing = !!target && (target.isContentEditable
                || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
            // A bare key must never steal focus from a text field; a chorded one
            // (with a modifier) is safe and stays available while typing.
            const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
            if (typing && !hasModifier) return;
            const pressed = describeKeyEvent(e);
            if (!pressed) return;
            for (const [action, bind] of Object.entries(keybinds)) {
                if (bind && bind === pressed) {
                    const handler = keybindHandlersRef.current[action as KeybindAction];
                    if (handler) {
                        e.preventDefault();
                        handler();
                    }
                    return;
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [keybinds]);

    // Hand the same bindings to the main process so they keep working while the
    // window is in the background. Push-to-talk is deliberately excluded: the OS
    // hotkey API reports presses only, never releases, so a hold-to-talk key
    // cannot be implemented this way.
    useEffect(() => {
        const api = window.electronAPI?.shortcuts;
        if (!api) return;
        if (!globalKeybinds) {
            api.setGlobal({}).catch(() => { });
            setGlobalKeybindIssues([]);
            return;
        }
        api.setGlobal(keybinds)
            .then(res => setGlobalKeybindIssues((res?.failed || []) as KeybindAction[]))
            .catch(() => setGlobalKeybindIssues([]));
        return () => { api.setGlobal({}).catch(() => { }); };
    }, [keybinds, globalKeybinds]);

    useEffect(() => {
        const api = window.electronAPI?.shortcuts;
        if (!api) return;
        return api.onFired((action) => {
            const handler = keybindHandlersRef.current[action as KeybindAction];
            if (handler) handler();
        });
    }, []);

    // Connection quality (ping/latency)
    const [peerLatencies, setPeerLatencies] = useState<Record<string, number>>({});
    const pingTimestampsRef = useRef<Record<string, number>>({});
    useEffect(() => { displayNameRef.current = currentDisplayName; }, [currentDisplayName]);
    useEffect(() => { avatarUrlRef.current = avatarUrl; }, [avatarUrl]);
    useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
    useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);
    useEffect(() => { isVideoEnabledRef.current = isVideoEnabled; }, [isVideoEnabled]);
    useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
    useEffect(() => { audioSettingsRef.current = audioSettings; }, [audioSettings]);

    const [groupDMs, setGroupDMs] = useState<Record<string, { id: string, name: string, members: string[], owner?: string }>>(() => {
        const saved = localStorage.getItem('p2p_chat_groups');
        if (saved) { try { return JSON.parse(saved) || {}; } catch { return {}; } }
        return {};
    });
    const groupDMsRef = useRef(groupDMs);
    useEffect(() => { groupDMsRef.current = groupDMs; }, [groupDMs]);

    // Pins used to share one global key, so a pin made in any chat appeared in
    // every other chat. The key now follows whatever is on screen.
    const pinnedKeyRef = useRef('p2p_chat_pins_home');
    const readPinList = (key: string): string[] => {
        const saved = localStorage.getItem(key);
        if (!saved) return [];
        try {
            const v = JSON.parse(saved);
            return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : [];
        } catch { return []; }
    };
    const [pinnedMessages, setPinnedMessages] = useState<string[]>(() => {
        const saved = localStorage.getItem('p2p_chat_pins_home');
        if (saved) { try { const v = JSON.parse(saved); return Array.isArray(v) ? v : []; } catch { return []; } }
        return [];
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

    // Push the current identity (name/avatar/about/status) to every open peer.
    // Refs are written synchronously by the setters below, so a broadcast right
    // after a change always carries the fresh values — not last render's.
    const broadcastIdentity = () => {
        connectionsRef.current.forEach(c => {
            if (c.open) {
                try {
                    c.send({ type: 'identity', payload: { name: displayNameRef.current, avatarUrl: avatarUrlRef.current, aboutMe: aboutMeRef.current, status: userStatusRef.current, badges: badgesRef.current } });
                } catch { }
            }
        });
    };

    const updateDisplayName = (name: string) => {
        displayNameRef.current = name;
        setCurrentDisplayName(name);
        broadcastIdentity();
    };

    const setBadges = (next: Badge[]) => {
        const clean = sanitizeBadges(next);
        badgesRef.current = clean;
        setBadgesState(clean);
        safeSetItem('p2p_chat_badges', JSON.stringify(clean));
        broadcastIdentity();
    };

    const setKeybind = (action: KeybindAction, bind: string) => {
        setKeybindsState(prev => {
            const next = { ...prev, [action]: bind };
            safeSetItem('p2p_chat_keybinds', JSON.stringify(next));
            return next;
        });
    };

    const resetKeybinds = () => {
        setKeybindsState({ ...DEFAULT_KEYBINDS });
        safeSetItem('p2p_chat_keybinds', JSON.stringify(DEFAULT_KEYBINDS));
    };

    const updateAvatarUrl = (url: string) => {
        avatarUrlRef.current = url;
        setAvatarUrl(url);
        broadcastIdentity();
    };

    const setAboutMe = (text: string) => {
        const trimmed = text.substring(0, 190);
        setAboutMeState(trimmed);
        aboutMeRef.current = trimmed;

        const saved = localStorage.getItem('p2p_chat_identity');
        let identity: any = {};
        if (saved) { try { identity = JSON.parse(saved) || {}; } catch { identity = {}; } }
        identity.aboutMe = trimmed;
        safeSetItem('p2p_chat_identity', JSON.stringify(identity));

        broadcastIdentity();
    };

    // Auto-away. Only an "online" status is ever changed automatically, and
    // only a status this code set is ever changed back, so a manual Idle, Do Not
    // Disturb or Invisible is left exactly where the user put it.
    const [idleMinutes, setIdleMinutesState] = useState<number>(() => {
        // getItem returns null when unset, and Number(null) is 0 — which would
        // silently read back as "never go idle" instead of the intended default.
        const raw = localStorage.getItem('p2p_chat_idle_minutes');
        if (raw === null) return 10;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
    });
    const idleMinutesRef = useRef(idleMinutes);
    const lastActivityRef = useRef(Date.now());
    const autoIdleRef = useRef(false);

    const setIdleMinutes = (minutes: number) => {
        const clean = Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 240) : 10;
        idleMinutesRef.current = clean;
        setIdleMinutesState(clean);
        try { localStorage.setItem('p2p_chat_idle_minutes', String(clean)); } catch { /* quota */ }
    };

    const [peerStatuses, setPeerStatuses] = useState<Record<string, string>>({});
    const [peerAboutMe, setPeerAboutMe] = useState<Record<string, string>>({});

    useEffect(() => { userStatusRef.current = userStatus; }, [userStatus]);

    useEffect(() => {
        // Activity is recorded as a timestamp rather than by resetting a timer,
        // so a busy mouse does not churn through thousands of timeouts.
        const mark = () => {
            lastActivityRef.current = Date.now();
            if (autoIdleRef.current && userStatusRef.current === 'idle') {
                autoIdleRef.current = false;
                setUserStatus('online');
            }
        };
        const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'focus'];
        events.forEach(e => window.addEventListener(e, mark, { passive: true }));

        const interval = setInterval(() => {
            const minutes = idleMinutesRef.current;
            if (minutes <= 0 || userStatusRef.current !== 'online') return;
            if (Date.now() - lastActivityRef.current >= minutes * 60000) {
                autoIdleRef.current = true;
                setUserStatus('idle');
            }
        }, 20000);

        return () => {
            events.forEach(e => window.removeEventListener(e, mark));
            clearInterval(interval);
        };
    }, []);
    useEffect(() => { aboutMeRef.current = aboutMe; }, [aboutMe]);

    useEffect(() => {

        const stream = localStreamRef.current;
        if (stream) {
            stream.getAudioTracks().forEach(t => {
                t.enabled = !isMuted && !isDeafened;
            });
        }

        connectionsRef.current.forEach(c => {
            if (c.open) c.send({ type: 'voice_state', payload: { muted: isMuted, deafened: isDeafened, voiceChannel: activeVoiceChannelRef.current } });
        });
    }, [isMuted, isDeafened, localStream]);

    useEffect(() => {

        const newPeer = new Peer(initialId, {
            debug: 1,
            config: {
                iceServers: buildIceServers(iceConfigRef.current),
            }
        });

        activePeerRef.current = newPeer;

        newPeer.on('open', (id) => {
            if (activePeerRef.current !== newPeer) return;
            console.log('My peer ID is: ' + id);
            peerIdRef.current = id;
            peerRef.current = newPeer;
            setPeerId(id);
            setPeer(newPeer);
            setSignalStatus('connected');
            if (brokerRetryRef.current) {
                clearTimeout(brokerRetryRef.current);
                brokerRetryRef.current = null;
            }
        });

        // If the websocket to the signaling server drops, keep retrying with
        // backoff — otherwise no NEW peer connections can ever be made again.
        const scheduleBrokerReconnect = (attempt: number) => {
            if (brokerRetryRef.current) clearTimeout(brokerRetryRef.current);
            const delay = Math.min(2000 * Math.pow(1.5, attempt), 15000);
            brokerRetryRef.current = setTimeout(() => {
                brokerRetryRef.current = null;
                if (newPeer.destroyed || activePeerRef.current !== newPeer) return;
                if (newPeer.disconnected) {
                    console.log(`[Signal] Reconnecting to broker (attempt ${attempt + 1})...`);
                    try { newPeer.reconnect(); } catch { /* retry below */ }
                    scheduleBrokerReconnect(attempt + 1);
                }
            }, delay);
        };

        newPeer.on('disconnected', () => {
            if (newPeer.destroyed || activePeerRef.current !== newPeer) return;
            console.warn('[Signal] Lost connection to signaling server');
            setSignalStatus('reconnecting');
            scheduleBrokerReconnect(0);
        });

        newPeer.on('connection', (conn) => {
            setupConnection(conn, true);
        });

        newPeer.on('call', (call) => {
            const isVideo = call.metadata?.withVideo !== false;
            const incomingVoiceChannel: string | undefined = call.metadata?.voiceChannel;

            // If this is a voice-channel call AND we're in the same voice channel,
            // auto-answer without showing the modal (Discord-style voice channel join)
            if (incomingVoiceChannel && incomingVoiceChannel === activeVoiceChannelRef.current) {
                (async () => {
                    let stream = localStreamRef.current;
                    if (!stream) {
                        try { stream = await initLocalStreamRef.current!(false); } catch { return; }
                    }
                    if (!stream) return;
                    callTypesRef.current[call.peer] = 'voice-channel';
                    call.answer(stream);
                    call.on('stream', (remoteStream) => {
                        setRemoteStreams(prev => ({ ...prev, [call.peer]: remoteStream }));
                        playUserJoinSound();
                    });
                    call.on('close', () => {
                        setRemoteStreams(prev => {
                            const next = { ...prev };
                            delete next[call.peer];
                            return next;
                        });
                        delete mediaConnectionsRef.current[call.peer];
                        delete callTypesRef.current[call.peer];
                        playUserLeaveSound();
                    });
                    mediaConnectionsRef.current[call.peer] = call;
                })();
                return;
            }

            // Otherwise — show the manual answer/reject modal (DM call)
            setIncomingCallIsVideo(isVideo);
            setIncomingCall(call);
            if (alertsAllowed()) {
                startRingtone();
                // A ringing call is the one notification worth raising even when
                // the window is focused but buried behind something else.
                if (getNotificationPrefs().desktopNotifications && Notification.permission === 'granted') {
                    const callerName = peerNamesRef.current[call.peer] || call.peer.substring(0, 8);
                    try {
                        const n = new Notification(callerName, {
                            body: isVideo ? 'Incoming video call' : 'Incoming voice call',
                            icon: peerAvatarsRef.current[call.peer] || undefined,
                            tag: 'p2pchat-call',
                            requireInteraction: true,
                        });
                        n.onclick = () => {
                            try {
                                window.focus();
                                if ('electronAPI' in window && (window as any).electronAPI?.window?.restore) {
                                    (window as any).electronAPI.window.restore();
                                }
                                setActiveServer(null);
                                setActiveDM(call.peer);
                            } catch { }
                            n.close();
                        };
                        call.on('close', () => { try { n.close(); } catch { } });
                    } catch { }
                }
            }

            call.on('close', () => {
                stopRingtone();
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
            if (brokerRetryRef.current) {
                clearTimeout(brokerRetryRef.current);
                brokerRetryRef.current = null;
            }
            if (peerRef.current === newPeer) peerRef.current = null;
            newPeer.destroy();
        };
    }, [initialId, peerEpoch]);

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

    // Newest timestamp currently held for the visible chat, kept as refs so the
    // sync paths can read them without re-subscribing or round-tripping through
    // a setState call purely to peek at current state.
    const latestTimestampRef = useRef(0);
    useEffect(() => {
        messagesRef.current = messages;
        latestTimestampRef.current = messages.length > 0
            ? messages[messages.length - 1].timestamp
            : 0;
    }, [messages]);

    // PERIODIC SYNC: Re-sync messages every 60s to catch any missed ones
    useEffect(() => {
        const syncInterval = setInterval(() => {
            const conns = connectionsRef.current;
            if (conns.length === 0) return;
            const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
            const latestTimestamp = latestTimestampRef.current;
            conns.forEach(conn => {
                if (conn.open) {
                    try { conn.send({ type: 'sync_request', payload: { timestamp: latestTimestamp, channel: activeChannelId } }); } catch { }
                }
            });
        }, 60000);
        return () => clearInterval(syncInterval);
    }, []);

    // Persist an inbound message, update badges, and acknowledge it. Shared by
    // the plaintext path, the encrypted path, and completed chunked transfers.
    const storeIncomingMessage = (conn: DataConnection, payload: UserMessage) => {
        const incomingServerId = payload.serverId || 'home';
        const currentServerId = activeServerRef.current ? activeServerRef.current.id : 'home';

        if (incomingServerId === currentServerId) {
            setMessages(prev => (prev.some(m => m.id === payload.id) ? prev : [...prev, payload]));
        } else {
            // A chat that is not on screen never touches React state; the row
            // goes straight to the store.
            persistMessages(incomingServerId, [payload]);
        }

        trackIncomingMessage(payload);
        try { conn.send({ type: 'message_ack', payload: { messageId: payload.id } }); } catch { /* peer went away */ }
    };


    // One place that raises the ping and the desktop notification for an inbound
    // message. It has to be explicit per message: a chunked attachment arrives as
    // hundreds of e2e_message frames, and alerting on the envelope type would
    // fire the sound once per chunk.
    const notifyIncoming = (fromPeer: string, preview: string, msg?: UserMessage) => {
        if (!alertsAllowed()) return;
        playMessageSound();
        if (getNotificationPrefs().desktopNotifications && document.hidden && Notification.permission === 'granted') {
            const senderName = peerNamesRef.current[fromPeer] || fromPeer.substring(0, 8);
            try {
                const n = new Notification(senderName, {
                    body: preview || 'Sent a file',
                    icon: peerAvatarsRef.current[fromPeer] || undefined,
                    tag: 'p2pchat-msg',
                });
                n.onclick = () => {
                    try {
                        window.focus();
                        if ('electronAPI' in window && (window as any).electronAPI?.window?.restore) {
                            (window as any).electronAPI.window.restore();
                        }
                        if (msg) {
                            const serverId = msg.serverId || 'home';
                            if (serverId !== 'home') {
                                const srv = joinedServersRef.current.find(s => s.id === serverId) || { id: serverId, name: 'Server' };
                                setActiveServer(srv);
                                if (msg.channelId) setActiveChannel(msg.channelId);
                            } else {
                                const dmKey = msg.channelId?.startsWith('group_') ? msg.channelId : msg.senderId;
                                setActiveServer(null);
                                setActiveDM(dmKey);
                            }
                        } else {
                            setActiveServer(null);
                            setActiveDM(fromPeer);
                        }
                    } catch { }
                    n.close();
                };
            } catch { /* notifications unavailable */ }
        }
    };

    const dropTransfer = (transferId: string) => {
        delete incomingTransfersRef.current[transferId];
        setFileTransfers(prev => {
            if (!(transferId in prev)) return prev;
            const next = { ...prev };
            delete next[transferId];
            return next;
        });
    };

    // Chunked attachment frames. Returns true when the frame was consumed, so
    // the caller can skip the regular message dispatch chain.
    const handleFileFrame = (conn: DataConnection, data: any): boolean => {
        if (!data || typeof data.type !== 'string') return false;

        if (data.type === 'file_start') {
            const { transferId, message, file } = data.payload || {};
            if (typeof transferId !== 'string' || transferId.length > 80) return true;
            if (!file || typeof file !== 'object') return true;
            const length = Number(file.length);
            const chunks = Number(file.chunks);
            if (!isFinite(length) || length <= 0 || length > MAX_FILE_B64_LEN) return true;
            if (!isFinite(chunks) || chunks <= 0 || chunks > 4000) return true;
            if (typeof file.name !== 'string' || typeof file.type !== 'string') return true;
            // SECURITY: the attached message must obey the same impersonation
            // rule as a live message.
            if (!isValidLiveMessage(message, conn.peer)) {
                console.warn(`[Security] Dropping spoofed file_start from ${conn.peer}`);
                return true;
            }
            const active = Object.values(incomingTransfersRef.current).filter(t => t.info.peerId === conn.peer).length;
            if (active >= MAX_ACTIVE_INCOMING_PER_PEER) {
                console.warn(`[Transfer] Too many concurrent transfers from ${conn.peer}`);
                try { conn.send({ type: 'file_abort', payload: { transferId } }); } catch { /* ignore */ }
                return true;
            }
            // Only the opening frame counts against the flood limit; the chunks
            // that follow are bounded by size and concurrency caps instead.
            if (isRateLimited(conn.peer)) {
                console.warn(`[Rate Limit] ${conn.peer} is starting transfers too quickly`);
                try { conn.send({ type: 'file_abort', payload: { transferId } }); } catch { /* ignore */ }
                return true;
            }

            const info: FileTransfer = {
                id: transferId,
                name: String(file.name).slice(0, 180),
                type: String(file.type).slice(0, 100),
                size: b64Bytes(length),
                transferred: 0,
                direction: 'in',
                peerId: conn.peer,
                peerName: peerNamesRef.current[conn.peer] || conn.peer.substring(0, 8),
                serverId: message.serverId || 'home',
                channelId: message.channelId || 'general',
            };
            incomingTransfersRef.current[transferId] = {
                info,
                parts: new Array(chunks).fill(''),
                received: 0,
                message,
            };
            setFileTransfers(prev => ({ ...prev, [transferId]: info }));
            notifyIncoming(conn.peer, stripHtml(message.text || '') || `Sending ${info.name}`, message);
            return true;
        }

        if (data.type === 'file_chunk') {
            const { transferId, index, data: chunk } = data.payload || {};
            const entry = incomingTransfersRef.current[transferId];
            if (!entry || entry.info.peerId !== conn.peer) return true;
            const i = Number(index);
            if (!isFinite(i) || i < 0 || i >= entry.parts.length) return true;
            if (typeof chunk !== 'string' || chunk.length > CHUNK_B64_SIZE * 2) return true;
            if (entry.parts[i]) return true; // duplicate chunk
            entry.parts[i] = chunk;
            entry.received += chunk.length;
            if (entry.received > MAX_FILE_B64_LEN) {
                console.warn(`[Transfer] ${conn.peer} overshot the declared size`);
                dropTransfer(transferId);
                return true;
            }
            const bytes = b64Bytes(entry.received);
            setFileTransfers(prev => {
                const cur = prev[transferId];
                if (!cur) return prev;
                // Repaint only on visible movement; chunks land far faster than
                // the UI needs to update.
                if (Math.abs(bytes - cur.transferred) < cur.size / 60 && bytes < cur.size) return prev;
                return { ...prev, [transferId]: { ...cur, transferred: bytes } };
            });
            return true;
        }

        if (data.type === 'file_end') {
            const { transferId } = data.payload || {};
            const entry = incomingTransfersRef.current[transferId];
            if (!entry || entry.info.peerId !== conn.peer) return true;
            if (entry.parts.some(part => !part)) {
                console.warn(`[Transfer] ${transferId} ended with missing chunks`);
                setFileTransfers(prev => prev[transferId] ? { ...prev, [transferId]: { ...prev[transferId], failed: true } } : prev);
                setTimeout(() => dropTransfer(transferId), 6000);
                delete incomingTransfersRef.current[transferId];
                return true;
            }
            const assembled: UserMessage = {
                ...entry.message,
                file: { name: entry.info.name, type: entry.info.type, data: entry.parts.join('') },
            };
            dropTransfer(transferId);
            // No alert here: the transfer was already announced when it started.
            storeIncomingMessage(conn, assembled);
            return true;
        }

        if (data.type === 'file_abort') {
            const { transferId } = data.payload || {};
            if (typeof transferId === 'string') dropTransfer(transferId);
            return true;
        }

        return false;
    };

    // Pause while the data channel is backed up, so a big attachment cannot
    // starve heartbeats and chat traffic on the same connection.
    const waitForDrain = (conn: DataConnection) => new Promise<void>(resolve => {
        const dc: RTCDataChannel | undefined = conn.dataChannel;
        if (!dc || dc.bufferedAmount < DC_HIGH_WATER) { resolve(); return; }
        const check = () => {
            if (!conn.open || !dc || dc.bufferedAmount < DC_LOW_WATER) resolve();
            else setTimeout(check, 30);
        };
        setTimeout(check, 30);
    });

    // Stream one attachment to a set of peers, reporting progress as the
    // slowest recipient drains.
    const streamFileToPeers = async (
        targets: DataConnection[],
        message: UserMessage,
        file: NonNullable<UserMessage['file']>,
    ) => {
        const open = targets.filter(c => c.open);
        if (open.length === 0) return;
        const transferId = `${message.id}-${Math.random().toString(36).slice(2, 8)}`;
        const total = file.data.length;
        const chunkCount = Math.ceil(total / CHUNK_B64_SIZE);
        const { file: _omit, ...header } = message as any;

        const info: FileTransfer = {
            id: transferId,
            name: file.name,
            type: file.type,
            size: b64Bytes(total),
            transferred: 0,
            direction: 'out',
            peerId: open[0].peer,
            peerName: peerNamesRef.current[open[0].peer] || open[0].peer.substring(0, 8),
            serverId: message.serverId || 'home',
            channelId: message.channelId || 'general',
        };
        setFileTransfers(prev => ({ ...prev, [transferId]: info }));

        try {
            for (const conn of open) {
                await e2eSend(conn, {
                    type: 'file_start',
                    payload: {
                        transferId,
                        message: header,
                        file: { name: file.name, type: file.type, length: total, chunks: chunkCount },
                    },
                });
            }

            for (let i = 0; i < chunkCount; i++) {
                const slice = file.data.slice(i * CHUNK_B64_SIZE, (i + 1) * CHUNK_B64_SIZE);
                for (const conn of open) {
                    if (!conn.open) continue;
                    await waitForDrain(conn);
                    await e2eSend(conn, { type: 'file_chunk', payload: { transferId, index: i, data: slice } });
                }
                const sent = b64Bytes(Math.min(total, (i + 1) * CHUNK_B64_SIZE));
                setFileTransfers(prev => {
                    const cur = prev[transferId];
                    if (!cur) return prev;
                    return { ...prev, [transferId]: { ...cur, transferred: sent } };
                });
            }

            for (const conn of open) {
                if (conn.open) await e2eSend(conn, { type: 'file_end', payload: { transferId } });
            }
        } catch (err) {
            console.warn('[Transfer] Upload failed:', err);
            setFileTransfers(prev => prev[transferId] ? { ...prev, [transferId]: { ...prev[transferId], failed: true } } : prev);
            setTimeout(() => dropTransfer(transferId), 6000);
            return;
        }
        dropTransfer(transferId);
    };

    const processDecryptedMessage = async (conn: DataConnection, data: any, sharedKey: CryptoKey) => {
        try {
            const decrypted = await decryptMessage(sharedKey, data.payload.iv, data.payload.ciphertext);
            const innerData = JSON.parse(decrypted);

            if (handleFileFrame(conn, innerData)) return;

            if (innerData.type === 'message') {
                const payload = innerData.payload as UserMessage;
                // SECURITY: reject messages whose claimed sender isn't the peer
                // that actually delivered them (impersonation), and oversized files
                if (!isValidLiveMessage(payload, conn.peer)) {
                    console.warn(`[Security] Dropping spoofed/oversized E2E message from ${conn.peer}`);
                    return;
                }
                storeIncomingMessage(conn, payload);
                notifyIncoming(conn.peer, stripHtml(payload.text || ''), payload);
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

    // Abandon any half-received transfer from a peer that just dropped, so its
    // chunks cannot be resumed by whoever reconnects on that id next.
    const abortTransfersFrom = (deadPeerId: string) => {
        Object.entries(incomingTransfersRef.current).forEach(([id, entry]) => {
            if (entry.info.peerId === deadPeerId) delete incomingTransfersRef.current[id];
        });
        setFileTransfers(prev => {
            const next: Record<string, FileTransfer> = {};
            let changed = false;
            Object.entries(prev).forEach(([id, t]) => {
                if (t.direction === 'in' && t.peerId === deadPeerId) { changed = true; return; }
                next[id] = t;
            });
            return changed ? next : prev;
        });
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

            // Record when we first ever met this peer ("member since")
            setPeerFirstSeen(prev => {
                if (prev[conn.peer]) return prev;
                const next = { ...prev, [conn.peer]: Date.now() };
                safeSetItem('p2p_chat_first_seen', JSON.stringify(next));
                return next;
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

            conn.send({ type: 'identity', payload: { name: displayNameRef.current, avatarUrl: avatarUrlRef.current, aboutMe: aboutMeRef.current, status: userStatusRef.current, badges: badgesRef.current } });

            conn.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, voiceChannel: activeVoiceChannelRef.current } });
            conn.send({ type: 'video_state', payload: { video: isVideoEnabledRef.current, screen: isScreenSharingRef.current } });

            // Flush offline message queue for this peer
            flushOfflineQueue(conn);

            const activeChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
            conn.send({ type: 'sync_request', payload: { timestamp: latestTimestampRef.current, channel: activeChannelId } });
        });

        conn.on('data', async (data: any) => {

            if (data.type === 'e2e_pubkey') {
                try {
                    const peerPubKey = await importPublicKey(data.payload);
                    if (e2eKeyPairRef.current) {
                        const sharedKey = await deriveSharedKey(e2eKeyPairRef.current.privateKey, peerPubKey);
                        e2eSharedKeysRef.current[conn.peer] = sharedKey;
                        console.log(`[E2E] 🔐 Shared key derived with ${conn.peer}`);

                        // Trust on first use: remember the key we first saw for
                        // this peer id and shout if it ever changes underneath us.
                        const fp = await keyFingerprint(peerPubKey);
                        const known = peerKeysRef.current[conn.peer];
                        if (!known) {
                            peerKeysRef.current[conn.peer] = { fp, verified: false, firstSeen: Date.now() };
                            savePeerKeys();
                        } else if (known.fp !== fp) {
                            console.warn(`[E2E] Identity key changed for ${conn.peer}`);
                            peerKeysRef.current[conn.peer] = { fp, verified: false, firstSeen: known.firstSeen };
                            savePeerKeys();
                            setVerifiedPeers(prev => ({ ...prev, [conn.peer]: false }));
                            setPeerKeyChanged(prev => ({ ...prev, [conn.peer]: true }));
                        }

                        const number = await safetyNumber(e2eKeyPairRef.current.publicKey, peerPubKey);
                        setPeerSafetyNumbers(prev => ({ ...prev, [conn.peer]: number }));

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

            // Chunked attachment frames handle their own limits and alerting.
            if (handleFileFrame(conn, data)) return;

            if (data.type === 'message') {
                // Rate limit: drop messages from peers flooding
                if (isRateLimited(conn.peer)) {
                    console.warn(`[Rate Limit] Dropping message from ${conn.peer} (flood protection)`);
                    return;
                }
                const msg = data.payload as UserMessage;
                // SECURITY: reject impersonated or oversized messages before storing
                if (!isValidLiveMessage(msg, conn.peer)) {
                    console.warn(`[Security] Dropping spoofed/oversized message from ${conn.peer}`);
                    return;
                }
                storeIncomingMessage(conn, msg);
                notifyIncoming(conn.peer, stripHtml(msg.text || ''), msg);
            } else if (data.type === 'identity') {
                const { name, avatarUrl: remoteAvatarUrl, aboutMe: remoteAboutMe, status: remoteStatus, badges: remoteBadges } = data.payload;
                if (remoteBadges !== undefined) {
                    setPeerBadges(prev => ({ ...prev, [conn.peer]: sanitizeBadges(remoteBadges) }));
                }
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
            } else if (data.type === 'video_state') {
                const { video, screen } = data.payload || {};
                setPeerVideoStates(prev => ({ ...prev, [conn.peer]: { video: !!video, screen: !!screen } }));
            } else if (data.type === 'voice_state') {
                const { muted, deafened, voiceChannel } = data.payload || {};
                setPeerVoiceStates(prev => ({ ...prev, [conn.peer]: { muted: !!muted, deafened: !!deafened } }));
                // voiceChannel can be undefined (legacy peers), null (left), or a string id
                if (voiceChannel !== undefined) {
                    setPeerVoiceChannels(prev => ({ ...prev, [conn.peer]: voiceChannel }));
                }
            } else if (data.type === 'group_invite') {
                const groupData = data.payload;
                // SECURITY: only accept an invite that actually lists us as a member,
                // and don't let a non-member silently overwrite an existing group
                // (members/owner hijack).
                if (!groupData || typeof groupData.id !== 'string' || !Array.isArray(groupData.members)) return;
                if (!groupData.members.includes(peerIdRef.current)) {
                    console.warn(`[Security] Ignoring group_invite that doesn't include us from ${conn.peer}`);
                    return;
                }
                setGroupDMs(prev => {
                    const existing = prev[groupData.id];
                    if (existing && !existing.members.includes(conn.peer)) {
                        console.warn(`[Security] Ignoring group overwrite from non-member ${conn.peer}`);
                        return prev;
                    }
                    const next = { ...prev, [groupData.id]: groupData };
                    safeSetItem('p2p_chat_groups', JSON.stringify(next));
                    return next;
                });
            } else if (data.type === 'sync_request') {

                const { timestamp: requestTimestamp, channel: requestChannel } = data.payload || {};
                if (typeof requestChannel !== 'string' || typeof requestTimestamp !== 'number') return;
                // SECURITY: a peer may only pull shared DM history, history for a
                // server they themselves host, or the server we are both in.
                const hereId = activeServerRef.current ? activeServerRef.current.id : 'home';
                const mayRead = requestChannel === 'home'
                    || requestChannel === conn.peer
                    || (requestChannel === hereId && serverMembersRef.current.has(conn.peer));
                if (!mayRead) {
                    console.warn('[Security] Ignoring sync_request for ' + requestChannel + ' from ' + conn.peer);
                    return;
                }

                const historyToSync = await loadRecent(requestChannel, MAX_MESSAGES);
                const newerMessages = historyToSync.filter(m => m.timestamp > requestTimestamp);
                if (newerMessages.length > 0) {
                    conn.send({ type: 'sync_response', payload: { messages: newerMessages, channel: requestChannel } });
                }
            } else if (data.type === 'server_join') {

                const { serverId } = data.payload;
                if (activeServerRef.current && activeServerRef.current.id === peerIdRef.current && serverId === peerIdRef.current) {

                    serverMembersRef.current.add(conn.peer);
                    setServerMembers(new Set(serverMembersRef.current));
                    console.log(`[Server] ${conn.peer} joined server. Members:`, Array.from(serverMembersRef.current));

                    const memberIds = Array.from(serverMembersRef.current);
                    connectionsRef.current.forEach(c => {
                        if (c.open && serverMembersRef.current.has(c.peer)) {
                            c.send({ type: 'room_peers', payload: memberIds });
                        }
                    });

                    // Sync this server's channel list to the joining member
                    const channels = serverChannelsRef.current[peerIdRef.current] ?? DEFAULT_CHANNELS;
                    try { conn.send({ type: 'channel_list', payload: { serverId: peerIdRef.current, channels } }); } catch { }
                }
            } else if (data.type === 'server_leave') {

                if (activeServerRef.current && activeServerRef.current.id === peerIdRef.current) {
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

                    if (id !== peerIdRef.current && !alreadyConnected && !isPending && !isCoolingDown) {

                        if (peerIdRef.current < id) {
                            connectToPeer(id, true);
                        }

                    }
                });
            } else if (data.type === 'sync_response') {

                const { messages: rawMessages, channel: responseChannel } = (data.payload || {}) as { messages: UserMessage[], channel: string };
                if (typeof responseChannel !== 'string' || !Array.isArray(rawMessages)) return;
                // SECURITY: history batches are shape- and size-checked and capped.
                // For DM history the sending peer may only vouch for messages from
                // themselves, from us, or from a group we share with them.
                const newMessages = rawMessages.slice(0, MAX_SYNC_BATCH).filter((m: any) => {
                    if (!isValidHistoryMessage(m)) return false;
                    if (responseChannel !== 'home') return true;
                    if (m.senderId === conn.peer || m.senderId === peerIdRef.current) return true;
                    const gid = m.channelId;
                    if (typeof gid === 'string' && gid.startsWith('group_')) {
                        const g = groupDMsRef.current[gid];
                        return !!g && g.members.includes(conn.peer) && g.members.includes(m.senderId);
                    }
                    return false;
                }) as UserMessage[];
                if (newMessages.length === 0) return;

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
                        if (added) merged.sort((a, b) => a.timestamp - b.timestamp);
                        return merged;
                    });
                } else {
                    // Not the chat on screen: straight to the store, no state churn.
                    persistMessages(responseChannel, newMessages);
                }
            } else if (data.type === 'clear_chat') {
                // SECURITY: a peer may only clear history it has authority over.
                // In this app a server's id IS the host's peer id, so:
                //   'home'        → shared DM history (kill switch from a DM contact)
                //   conn.peer     → your 1:1 DM with them, OR a server they host
                // Anything else (e.g. some other server's id) is rejected, so a
                // peer can't pass an arbitrary channelId to wipe unrelated history.
                const requested = data.payload?.channelId
                    || (activeServerRef.current ? activeServerRef.current.id : 'home');
                if (requested !== 'home' && requested !== conn.peer) {
                    console.warn(`[Security] Ignoring unauthorized clear_chat for ${requested} from ${conn.peer}`);
                    return;
                }
                await deleteChannel(requested);
                const currentActiveChannelId = activeServerRef.current ? activeServerRef.current.id : 'home';
                if (currentActiveChannelId === requested) {
                    setMessagesRaw([]);
                    setHasEarlierMessages(false);
                }
            } else if (data.type === 'typing') {

                setTypingPeers(prev => ({ ...prev, [conn.peer]: { ts: Date.now(), scope: data.payload?.scope } }));
            } else if (data.type === 'reaction') {

                // SECURITY: the reacting user is whoever sent the frame. Trusting
                // payload.userId let any peer react (or un-react) as anyone else.
                const { messageId, emoji } = data.payload || {};
                const userId = conn.peer;
                if (typeof messageId !== 'string' || typeof emoji !== 'string' || emoji.length > 16) return;
                setMessages(prev => prev.map(msg => {
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
                // SECURITY: Only allow the original sender to edit their message.
                // The text is stored as-is; rendering goes through sanitizeMessageHtml,
                // which both blocks XSS and keeps legitimate formatting intact.
                setMessages(prev => prev.map(msg =>
                    (msg.id === id && msg.senderId === conn.peer) ? { ...msg, text: String(newText ?? ''), edited: true } : msg
                ));
            } else if (data.type === 'delete_message') {

                const { id } = data.payload;
                // SECURITY: Only allow the original sender to delete their message
                setMessagesRaw(prev => {
                    const target = prev.find(m => m.id === id && m.senderId === conn.peer);
                    if (!target) return prev;
                    dbDeleteMessage(historyKeyRef.current, id);
                    return prev.filter(msg => msg.id !== id);
                });
            } else if (data.type === 'pin_message' || data.type === 'unpin_message') {
                // SECURITY: a pin may only touch a chat the sender belongs to, and
                // only that chat's own pin store. Previously any peer could pin
                // anything into whatever chat you happened to have open.
                const { messageId, scope } = data.payload || {};
                if (typeof messageId !== 'string' || messageId.length > 128) return;
                const pinKey = resolvePinKey(scope, conn.peer);
                if (!pinKey) {
                    console.warn('[Security] Ignoring ' + data.type + ' with unauthorized scope from ' + conn.peer);
                    return;
                }
                const currentPins = readPinList(pinKey);
                const nextPins = data.type === 'pin_message'
                    ? (currentPins.includes(messageId) ? currentPins : [...currentPins, messageId].slice(-200))
                    : currentPins.filter(id => id !== messageId);
                safeSetItem(pinKey, JSON.stringify(nextPins));
                if (pinKey === pinnedKeyRef.current) setPinnedMessages(nextPins);
            } else if (data.type === 'status_update') {
                setPeerStatuses(prev => ({ ...prev, [conn.peer]: data.payload.status }));
            } else if (data.type === 'group_kick') {
                const { groupId, kickedMemberId } = data.payload;
                // SECURITY: only the group's owner may kick. Reject otherwise so a
                // random peer can't remove you (or others) from a group.
                const grp = groupDMsRef.current[groupId];
                if (grp && grp.owner && grp.owner !== conn.peer) {
                    console.warn(`[Security] Ignoring group_kick from non-owner ${conn.peer}`);
                    return;
                }
                if (kickedMemberId === peerIdRef.current) {

                    setGroupDMs(prev => {
                        const next = { ...prev };
                        delete next[groupId];
                        safeSetItem('p2p_chat_groups', JSON.stringify(next));
                        return next;
                    });
                    if (activeDMRef.current === groupId) setActiveDM(null);
                } else {
                    setGroupDMs(prev => {
                        const group = prev[groupId];
                        if (!group) return prev;
                        const next = { ...prev, [groupId]: { ...group, members: group.members.filter(m => m !== kickedMemberId) } };
                        safeSetItem('p2p_chat_groups', JSON.stringify(next));
                        return next;
                    });
                }
            } else if (data.type === 'group_ownership_transfer') {
                const { groupId, newOwnerId } = data.payload;
                // SECURITY: only the current owner may transfer ownership
                setGroupDMs(prev => {
                    const group = prev[groupId];
                    if (!group) return prev;
                    if (group.owner && group.owner !== conn.peer) {
                        console.warn(`[Security] Ignoring ownership transfer from non-owner ${conn.peer}`);
                        return prev;
                    }
                    const next = { ...prev, [groupId]: { ...group, owner: newOwnerId } };
                    safeSetItem('p2p_chat_groups', JSON.stringify(next));
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
                const { serverId, peerId: targetPeer, role } = data.payload || {};
                // SECURITY: only the server host (peer id === server id) is trusted
                // to assign roles. This stops any member from broadcasting a
                // role_update that promotes themselves to owner/admin.
                if (conn.peer !== serverId) {
                    console.warn(`[Security] Ignoring role_update from non-host ${conn.peer}`);
                    return;
                }
                if (!['owner', 'admin', 'mod', 'member'].includes(role)) return;
                setServerRoles(prev => {
                    const serverData = { ...(prev[serverId] || {}), [targetPeer]: role };
                    const next = { ...prev, [serverId]: serverData };
                    localStorage.setItem('p2p_chat_server_roles', JSON.stringify(next));
                    return next;
                });
            } else if (data.type === 'message_ack') {
                const ackedId = data.payload?.messageId;
                if (ackedId) {
                    setDeliveredMessageIds(prev => {
                        if (prev.has(ackedId)) return prev;
                        const next = new Set(prev);
                        next.add(ackedId);
                        return next;
                    });
                }
            } else if (data.type === 'channel_list') {
                const { serverId, channels } = data.payload || {};
                // Only the server host is allowed to dictate the channel list
                if (serverId && conn.peer === serverId && Array.isArray(channels)) {
                    const clean = channels
                        .filter((c: unknown) => typeof c === 'string')
                        .map((c: string) => sanitizeChannelName(c))
                        .filter(Boolean)
                        .slice(0, 50);
                    if (!clean.includes('general')) clean.unshift('general');
                    storeServerChannels(serverId, clean);
                    if (activeServerRef.current?.id === serverId && !clean.includes(activeChannelRef.current)) {
                        setActiveChannel('general');
                    }
                }
            } else if (data.type === 'call-busy') {
                const busyName = peerNamesRef.current[conn.peer] || conn.peer.substring(0, 8);
                setError(`${busyName} is currently in another call`);
                setTimeout(() => setError(null), 5000);
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
            abortTransfersFrom(disconnectedPeerId);
            setPeerVoiceChannels(prev => {
                if (!(disconnectedPeerId in prev)) return prev;
                const next = { ...prev };
                delete next[disconnectedPeerId];
                return next;
            });
            setPeerVideoStates(prev => {
                if (!(disconnectedPeerId in prev)) return prev;
                const next = { ...prev };
                delete next[disconnectedPeerId];
                return next;
            });

            if (serverMembersRef.current.has(disconnectedPeerId)) {
                serverMembersRef.current.delete(disconnectedPeerId);
                setServerMembers(new Set(serverMembersRef.current));
            }

            setConnections(prev => {
                const updated = prev.filter(c => c.peer !== disconnectedPeerId);
                connectionsRef.current = updated;

                if (activeServerRef.current && activeServerRef.current.id === peerIdRef.current) {
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
        const activePeer = peerRef.current;
        if (!activePeer || id === peerIdRef.current) return;

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
            const conn = activePeer.connect(id, {
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
                    } else if (!turnIsConfigured(iceConfigRef.current)) {
                        // Repeated failures with no relay configured is the classic
                        // symmetric-NAT signature, and it is otherwise invisible.
                        setError('Could not reach that peer. If you are both behind a strict network, add a TURN relay under Settings, Voice and Video.');
                        setTimeout(() => setError(null), 10000);
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
        const newServer = { id: peerId, name };
        if (!joinedServers.find(s => s.id === peerId)) {
            setJoinedServers(prev => prev.find(s => s.id === peerId) ? prev : [...prev, newServer]);
        }
        setServerRole(peerId, peerId, 'owner');
        // Pass the server along — joinedServers state isn't updated yet this render
        switchServer(peerId, newServer);
    };

    const joinServer = (id: string, name: string) => {
        const newServer = { id, name };
        if (!joinedServers.find(s => s.id === id)) {
            setJoinedServers(prev => prev.find(s => s.id === id) ? prev : [...prev, newServer]);
        }
        switchServer(id, newServer);
    };

    const loadHistoryFor = async (channel: string) => {
        setMessagesRaw([]);
        setHasEarlierMessages(false);
        const rows = await loadRecent(channel, MAX_MESSAGES);
        // Guard against a fast second switch landing out of order.
        if (historyKeyRef.current !== channel) return;
        setMessagesRaw(rows);
        setHasEarlierMessages(rows.length >= MAX_MESSAGES);
    };

    // justAdded covers the create/join flow where the server isn't in
    // joinedServers state yet (setState hasn't flushed within this call).
    const switchServer = (id: string | null, justAdded?: { id: string, name: string }) => {

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
            historyKeyRef.current = 'home';
            loadHistoryFor('home');
        } else {
            const server = joinedServers.find(s => s.id === id) || (justAdded?.id === id ? justAdded : undefined);
            if (server) {
                setActiveServer(server);
                activeServerRef.current = server;
                // Clear this server's unread badge and land on a valid channel
                setServerUnreads(prev => {
                    if (!prev[id]) return prev;
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
                const channels = serverChannelsRef.current[id] ?? DEFAULT_CHANNELS;
                if (!channels.includes(activeChannelRef.current)) setActiveChannel('general');
                historyKeyRef.current = id;
                loadHistoryFor(id);

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

    const [typingPeers, setTypingPeers] = useState<Record<string, { ts: number; scope?: string }>>({});
    const lastTypingSentRef = useRef<number>(0);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setTypingPeers(prev => {
                const next: Record<string, { ts: number; scope?: string }> = {};
                let changed = false;
                Object.entries(prev).forEach(([id, info]) => {
                    if (now - info.ts < 4000) next[id] = info;
                    else changed = true;
                });
                return changed ? next : prev;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Typing is scoped so peers only see the indicator inside the chat you're
    // actually typing in: "serverId:channel" for servers, the group id for group
    // DMs, and the recipient's own peer id for 1:1 DMs.
    const sendTypingIndicator = () => {
        const now = Date.now();
        if (now - lastTypingSentRef.current < 3000) return;
        lastTypingSentRef.current = now;

        if (activeServerRef.current) {
            const scope = `${activeServerRef.current.id}:${activeChannelRef.current}`;
            connectionsRef.current.forEach(conn => {
                if (conn.open && serverMembersRef.current.has(conn.peer)) {
                    conn.send({ type: 'typing', payload: { peerId, scope } });
                }
            });
            return;
        }

        const dm = activeDMRef.current;
        if (!dm) return;
        if (dm.startsWith('group_')) {
            const group = groupDMs[dm];
            connectionsRef.current.forEach(conn => {
                if (conn.open && group?.members.includes(conn.peer)) {
                    conn.send({ type: 'typing', payload: { peerId, scope: dm } });
                }
            });
        } else {
            const conn = connectionsRef.current.find(c => c.peer === dm);
            if (conn?.open) conn.send({ type: 'typing', payload: { peerId, scope: peerId } });
        }
    };

    const addReaction = (messageId: string, emoji: string) => {

        setMessages(prev => prev.map(msg => {
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

        activeChatRecipients().forEach(conn => {
            try { conn.send({ type: 'reaction', payload: { messageId, emoji } }); } catch { }
        });
    };

    // Repoint the pin store whenever the visible chat changes.
    useEffect(() => {
        const key = activeServer
            ? 'p2p_chat_pins_' + activeServer.id + '_' + activeChannel
            : (activeDM ? 'p2p_chat_pins_dm_' + activeDM : 'p2p_chat_pins_home');
        pinnedKeyRef.current = key;
        setPinnedMessages(readPinList(key));
    }, [activeServer, activeChannel, activeDM]);

    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [lastMessages, setLastMessages] = useState<Record<string, { text: string; timestamp: number }>>({});
    const activeDMRef = useRef<string | null>(activeDM);
    useEffect(() => { activeDMRef.current = activeDM; }, [activeDM]);

    // Only peers that belong to the chat on screen should receive its
    // side-channel events (reactions, pins, edits). Broadcasting to every open
    // connection leaked activity across unrelated servers and DMs.
    const activeChatRecipients = (): DataConnection[] => {
        if (activeServerRef.current) {
            return connectionsRef.current.filter(c => c.open && serverMembersRef.current.has(c.peer));
        }
        const dm = activeDMRef.current;
        if (!dm) return [];
        if (dm.startsWith('group_')) {
            const g = groupDMsRef.current[dm];
            return g ? connectionsRef.current.filter(c => c.open && g.members.includes(c.peer)) : [];
        }
        return connectionsRef.current.filter(c => c.open && c.peer === dm);
    };

    // Wire-format scope for the chat on screen. A 1:1 DM needs no id because
    // both endpoints already identify each other by transport peer id.
    const currentChatScope = (): string | null => {
        if (activeServerRef.current) return 'srv:' + activeServerRef.current.id + ':' + activeChannelRef.current;
        const dm = activeDMRef.current;
        if (!dm) return null;
        return dm.startsWith('group_') ? 'grp:' + dm : 'dm';
    };

    // Map an incoming scope onto a local pin store, rejecting scopes the sending
    // peer has no standing in.
    const resolvePinKey = (scope: unknown, fromPeer: string): string | null => {
        if (typeof scope !== 'string' || scope.length > 160) return null;
        if (scope === 'dm') return 'p2p_chat_pins_dm_' + fromPeer;
        if (scope.startsWith('grp:')) {
            const gid = scope.slice(4);
            const g = groupDMsRef.current[gid];
            if (!g || !g.members.includes(fromPeer)) return null;
            return 'p2p_chat_pins_dm_' + gid;
        }
        if (scope.startsWith('srv:')) {
            const rest = scope.slice(4);
            const idx = rest.indexOf(':');
            if (idx < 0) return null;
            const sid = rest.slice(0, idx);
            const ch = rest.slice(idx + 1);
            if (fromPeer !== sid && !serverMembersRef.current.has(fromPeer)) return null;
            if (!/^[a-z0-9-]{1,24}$/.test(ch)) return null;
            return 'p2p_chat_pins_' + sid + '_' + ch;
        }
        return null;
    };

    const clearUnread = (peerId: string) => {
        setUnreadCounts(prev => {
            if (!prev[peerId]) return prev;
            const next = { ...prev };
            delete next[peerId];
            return next;
        });
    };

    const trackIncomingMessage = (msg: UserMessage) => {
        const serverId = msg.serverId || 'home';

        // Server messages: bump the server badge unless that server is on screen
        if (serverId !== 'home') {
            if (activeServerRef.current?.id !== serverId) {
                setServerUnreads(prev => ({ ...prev, [serverId]: (prev[serverId] || 0) + 1 }));
            }
            return;
        }

        // DMs: group messages are keyed by the group id, 1:1 by the sender
        const dmKey = msg.channelId?.startsWith('group_') ? msg.channelId : msg.senderId;
        const preview = stripHtml(msg.text || '').substring(0, 50);
        setLastMessages(prev => ({ ...prev, [dmKey]: { text: preview, timestamp: msg.timestamp } }));

        // Count as unread when this DM isn't the one on screen — including
        // while you're looking at a server.
        if (activeServerRef.current || activeDMRef.current !== dmKey) {
            setUnreadCounts(prev => ({ ...prev, [dmKey]: (prev[dmKey] || 0) + 1 }));
        }
    };

    const editMessage = (messageId: string, newText: string) => {
        setMessages(prev => prev.map(msg =>
            msg.id === messageId ? { ...msg, text: newText, edited: true } : msg
        ));
        activeChatRecipients().forEach(conn => {
            try { conn.send({ type: 'edit_message', payload: { id: messageId, newText } }); } catch { }
        });
    };

    const deleteMessage = (messageId: string) => {
        dbDeleteMessage(historyKeyRef.current, messageId);
        setMessagesRaw(prev => prev.filter(msg => msg.id !== messageId));
        activeChatRecipients().forEach(conn => {
            try { conn.send({ type: 'delete_message', payload: { id: messageId } }); } catch { }
        });
    };

    const pinMessage = (messageId: string) => {
        setPinnedMessages(prev => {
            if (prev.includes(messageId)) return prev;
            const next = [...prev, messageId].slice(-200);
            safeSetItem(pinnedKeyRef.current, JSON.stringify(next));
            return next;
        });
        const scope = currentChatScope();
        if (!scope) return;
        activeChatRecipients().forEach(conn => {
            try { conn.send({ type: 'pin_message', payload: { messageId, scope } }); } catch { }
        });
    };

    const unpinMessage = (messageId: string) => {
        setPinnedMessages(prev => {
            const next = prev.filter(id => id !== messageId);
            safeSetItem(pinnedKeyRef.current, JSON.stringify(next));
            return next;
        });
        const scope = currentChatScope();
        if (!scope) return;
        activeChatRecipients().forEach(conn => {
            try { conn.send({ type: 'unpin_message', payload: { messageId, scope } }); } catch { }
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

            setMessagesRaw([]);
            setHasEarlierMessages(false);
            deleteChannel(activeChannelId);

            // Only broadcast to actual participants of this server/DM, not every peer we know
            const recipients = activeServer
                ? connectionsRef.current.filter(c => serverMembersRef.current.has(c.peer))
                : connectionsRef.current;
            recipients.forEach(conn => {
                if (conn.open) {
                    conn.send({ type: 'clear_chat', payload: { channelId: activeChannelId } });
                }
            });
            return;
        }

        if (activeServer) {
            const newMessage: UserMessage = {
                id: Math.random().toString(36).substring(7),
                senderId: peerId,
                senderName: currentDisplayName,
                text,
                timestamp: Date.now(),
                serverId: activeServer.id,
                channelId: activeChannel || 'general',
                ...(fileAttachment && { file: fileAttachment }),
                ...(replyTo && { replyTo })
            };

            // Only deliver to peers that are actually members of THIS server
            const serverTargets = connectionsRef.current.filter(c => c.open && serverMembersRef.current.has(c.peer));
            if (fileAttachment && fileAttachment.data.length > INLINE_FILE_LIMIT) {
                streamFileToPeers(serverTargets, newMessage, fileAttachment);
            } else {
                serverTargets.forEach(conn => { e2eSend(conn, { type: 'message', payload: newMessage }); });
            }

            setMessages(prev => [...prev, newMessage]);
        } else if (activeDM) {
            const isGroup = activeDM.startsWith('group_');
            const newMessage: UserMessage = {
                id: Math.random().toString(36).substring(7),
                senderId: peerId,
                senderName: currentDisplayName,
                text,
                timestamp: Date.now(),
                serverId: 'home',
                channelId: activeDM,
                ...(fileAttachment && { file: fileAttachment }),
                ...(replyTo && { replyTo })
            };

            const streamed = !!fileAttachment && fileAttachment.data.length > INLINE_FILE_LIMIT;

            if (isGroup) {
                const group = groupDMs[activeDM];
                const targets = group
                    ? group.members
                        .filter(m => m !== peerId)
                        .map(m => connectionsRef.current.find(c => c.peer === m))
                        .filter((c): c is DataConnection => !!c && c.open)
                    : [];
                if (streamed) {
                    streamFileToPeers(targets, newMessage, fileAttachment!);
                } else {
                    targets.forEach(conn => { e2eSend(conn, { type: 'message', payload: newMessage }); });
                }
                setMessages(prev => [...prev, newMessage]);
            } else {
                const targetConn = connectionsRef.current.find(c => c.peer === activeDM);
                if (targetConn && targetConn.open) {
                    if (streamed) {
                        streamFileToPeers([targetConn], newMessage, fileAttachment!);
                    } else {
                        e2eSend(targetConn, { type: 'message', payload: newMessage });
                    }
                } else if (!streamed) {
                    // Peer is offline — queue the message for delivery on reconnect
                    queueOfflineMessage(activeDM, { type: 'message', payload: newMessage });
                    console.log(`[OFFLINE] Queued message for offline peer ${activeDM}`);
                } else {
                    // Streaming a multi-megabyte attachment into the offline queue
                    // would blow the storage quota; history sync carries it once
                    // the peer is back.
                    console.log(`[OFFLINE] Skipped queueing large attachment for ${activeDM}`);
                }
                setMessages(prev => [...prev, newMessage]);
            }
        }
    };

    const teardownVideoExtras = () => {
        releaseBlankTrack();
    };

    const teardownAudioGraph = () => {
        const g = audioGraphRef.current;
        if (!g) return;
        try {
            cancelAnimationFrame(g.rafId);
            g.source.disconnect();
            g.highPass.disconnect();
            g.inputGain.disconnect();
            g.gateGain.disconnect();
            g.analyser.disconnect();
            g.dest.disconnect();
            g.ctx.close().catch(() => {});
        } catch {}
        audioGraphRef.current = null;
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

        // Build the processing audio graph: high-pass → input gain → smoothed noise gate → output
        teardownAudioGraph();
        const rawAudio = stream.getAudioTracks()[0];
        let processedStream = stream;
        if (rawAudio) {
            try {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const source = ctx.createMediaStreamSource(new MediaStream([rawAudio]));
                const highPass = ctx.createBiquadFilter();
                highPass.type = 'highpass';
                highPass.frequency.value = audioSettings.highPassFilter ? 85 : 1;
                highPass.Q.value = 0.7;

                const inputGain = ctx.createGain();
                inputGain.gain.value = (audioSettings.inputVolume ?? 100) / 100;

                const gateGain = ctx.createGain();
                gateGain.gain.value = 1;

                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.5;

                const dest = ctx.createMediaStreamDestination();

                source.connect(highPass);
                highPass.connect(inputGain);
                inputGain.connect(analyser); // analyse post-gain so threshold scales with mic boost
                inputGain.connect(gateGain);
                gateGain.connect(dest);

                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                const ATTACK = 0.005; // 5ms ramp up
                const RELEASE = 0.12; // 120ms ramp down — smoother than a hard cut
                let openUntil = 0; // hold-open until this timestamp to avoid choppy speech
                let lastMicLevelPush = 0;
                const HOLD_MS = 200;

                const tick = () => {
                    if (!audioGraphRef.current) return;
                    analyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                    const avg = sum / dataArray.length;
                    const level = Math.min(100, (avg / 255) * 100 * 1.6);

                    // Throttle React state updates to ~20fps; gate logic still runs every frame
                    const tNow = performance.now();
                    if (tNow - lastMicLevelPush > 50) {
                        setMicLevel(level);
                        lastMicLevelPush = tNow;
                    }

                    const muted = isMutedRef.current || isDeafenedRef.current;
                    const liveSettings = audioSettingsRef.current!;
                    let target: number;
                    if (muted) {
                        target = 0;
                    } else if (liveSettings.inputSensitivity < 0) {
                        target = 1; // auto: gate fully open
                    } else {
                        const threshold = liveSettings.inputSensitivity;
                        if (level > threshold) {
                            openUntil = tNow + HOLD_MS;
                            target = 1;
                        } else if (tNow < openUntil) {
                            target = 1; // hold open during pauses
                        } else {
                            target = 0;
                        }
                    }
                    const now = ctx.currentTime;
                    const ramp = target > gateGain.gain.value ? ATTACK : RELEASE;
                    gateGain.gain.cancelScheduledValues(now);
                    gateGain.gain.setTargetAtTime(target, now, ramp);

                    audioGraphRef.current.rafId = requestAnimationFrame(tick);
                };

                audioGraphRef.current = { ctx, source, highPass, inputGain, gateGain, analyser, dest, rafId: 0 };
                audioGraphRef.current.rafId = requestAnimationFrame(tick);

                // Replace the raw audio track with the processed one in the outgoing stream
                const processedAudio = dest.stream.getAudioTracks()[0];
                stream.removeTrack(rawAudio);
                // Keep the raw track ref so we can stop it on teardown
                (processedAudio as any)._sourceTrack = rawAudio;
                stream.addTrack(processedAudio);
                processedStream = stream;
            } catch (err) {
                console.warn('[Audio] Could not build processing graph, falling back to raw stream:', err);
            }
        }

        setLocalStream(processedStream);
        localStreamRef.current = processedStream;

        if (isMuted || isDeafened) {
            processedStream.getAudioTracks().forEach(t => { t.enabled = false; });
        }

        return processedStream;
    };

    // Keep the ref in sync with the latest closure
    initLocalStreamRef.current = initLocalStream;

    const [activeCallDM, setActiveCallDM] = useState<string | null>(null);

    const startCall = async (id: string, withVideo: boolean, voiceChannel?: string) => {
        if (!peer) return;

        // Starting a DM call (no voiceChannel arg) while you're in a voice channel must
        // leave that channel first — otherwise both audio sources play simultaneously.
        if (!voiceChannel && activeVoiceChannelRef.current) {
            Object.keys(callTypesRef.current).forEach(cid => {
                if (callTypesRef.current[cid] === 'voice-channel') {
                    mediaConnectionsRef.current[cid]?.close();
                    delete mediaConnectionsRef.current[cid];
                    delete callTypesRef.current[cid];
                }
            });
            setRemoteStreams(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(pid => {
                    if (!mediaConnectionsRef.current[pid]) delete next[pid];
                });
                return next;
            });
            connectionsRef.current.forEach(c => {
                if (c.open) c.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, voiceChannel: null } });
            });
            setActiveVoiceChannel(null);
            // If no other calls remain, drop the stream so the new DM call gets a fresh one with the right video flag
            if (Object.keys(mediaConnectionsRef.current).length === 0 && localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(t => t.stop());
                teardownAudioGraph();
                setLocalStream(null);
                localStreamRef.current = null;
                setMicLevel(0);
            }
        }

        let stream = localStreamRef.current;
        if (!stream) {
            stream = await initLocalStream(withVideo);
        }
        if (stream) {
            try {
                const metadata: any = { withVideo };
                if (voiceChannel) metadata.voiceChannel = voiceChannel;
                const call = peer.call(id, stream, { metadata });

                callTypesRef.current[id] = voiceChannel ? 'voice-channel' : 'dm';

                call.on('stream', (userVideoStream) => {
                    setRemoteStreams(prev => ({ ...prev, [call.peer]: userVideoStream }));
                    playUserJoinSound();
                });

                call.on('close', () => {
                    setRemoteStreams(prev => {
                        const newStreams = { ...prev };
                        delete newStreams[call.peer];
                        return newStreams;
                    });
                    delete mediaConnectionsRef.current[call.peer];
                    delete callTypesRef.current[call.peer];
                    playUserLeaveSound();
                });

                mediaConnectionsRef.current[call.peer] = call;

                // Track which DM this call belongs to (for DM-scoped UI)
                if (!voiceChannel && !activeCallDM) {
                    setActiveCallDM(activeDMRef.current);
                }
            } catch (err: any) {
                setError('Failed to start call: ' + err.message);
            }
        }
    };

    const answerCall = async () => {
        if (!incomingCall) return;

        // Accepting a DM call switches you out of any active voice channel and any other
        // active DM call — otherwise the audio from both would play at the same time.
        const allOpenIds = Object.keys(mediaConnectionsRef.current);
        if (allOpenIds.length > 0) {
            allOpenIds.forEach(id => {
                mediaConnectionsRef.current[id].close();
                delete mediaConnectionsRef.current[id];
                delete callTypesRef.current[id];
            });
            setRemoteStreams({});
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                teardownAudioGraph();
                setLocalStream(null);
                localStreamRef.current = null;
                setIsScreenSharing(false);
                setIsVideoEnabled(false);
                setMicLevel(0);
            }
        }
        // If we were in a voice channel, broadcast that we left so peers update their UI
        if (activeVoiceChannelRef.current) {
            setActiveVoiceChannel(null);
            connectionsRef.current.forEach(c => {
                if (c.open) c.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, voiceChannel: null } });
            });
        }

        let stream = localStreamRef.current;
        if (!stream) stream = await initLocalStream(incomingCallIsVideo);

        if (stream) {
            incomingCall.answer(stream);
        } else {
            incomingCall.answer();
        }

        callTypesRef.current[incomingCall.peer] = 'dm';

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
            delete callTypesRef.current[incomingCall.peer];
        });

        // Set activeCallDM to the caller's DM and switch to it
        setActiveCallDM(incomingCall.peer);
        setActiveDM(incomingCall.peer);

        stopRingtone();
        playCallConnectSound();
        setIncomingCall(null);
    };

    const rejectCall = () => {
        if (incomingCall) {
            incomingCall.close();
            stopRingtone();
            setIncomingCall(null);
        }
    };

    const endCall = (id: string) => {
        if (mediaConnectionsRef.current[id]) {
            mediaConnectionsRef.current[id].close();
            delete mediaConnectionsRef.current[id];
            delete callTypesRef.current[id];
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
            teardownAudioGraph();
            teardownVideoExtras();
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
            delete callTypesRef.current[id];
        });
        setRemoteStreams({});

        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
            });
            teardownAudioGraph();
            teardownVideoExtras();
            setLocalStream(null);
            localStreamRef.current = null;
            setIsScreenSharing(false);
            setIsVideoEnabled(false);
            broadcastVideoState(false, false);
        }

        if (incomingCall) {
            incomingCall.close();
            setIncomingCall(null);
        }

        // If we were in a voice channel, broadcast that we left so peers update their UI
        if (activeVoiceChannelRef.current) {
            setActiveVoiceChannel(null);
            connectionsRef.current.forEach(c => {
                if (c.open) c.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, voiceChannel: null } });
            });
        }

        stopRingtone();
        playCallDisconnectSound();
        setActiveCallDM(null);
        setMicLevel(0);
    };

    // Voice channel join: broadcast presence, then call peers already in this channel.
    // Receivers in the same channel auto-answer (no modal) so 3+ users connect properly.
    const joinVoiceChannel = async (channelId: string) => {
        if (activeVoiceChannelRef.current === channelId) return;

        // Switching voice channels — close every voice-channel call from the old channel
        // so the user doesn't end up hearing two channels at once.
        if (activeVoiceChannelRef.current) {
            Object.keys(callTypesRef.current).forEach(id => {
                if (callTypesRef.current[id] === 'voice-channel') {
                    mediaConnectionsRef.current[id]?.close();
                    delete mediaConnectionsRef.current[id];
                    delete callTypesRef.current[id];
                }
            });
            setRemoteStreams(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(id => {
                    if (!mediaConnectionsRef.current[id]) delete next[id];
                });
                return next;
            });
            // Tell peers I left the old channel
            connectionsRef.current.forEach(c => {
                if (c.open) c.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, voiceChannel: null } });
            });
            // If no calls remain (no DM call running), drop the stream so a fresh one
            // is built for the new channel — stale gain/gate state won't carry over.
            if (Object.keys(mediaConnectionsRef.current).length === 0 && localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(t => t.stop());
                teardownAudioGraph();
                setLocalStream(null);
                localStreamRef.current = null;
                setMicLevel(0);
            }
        }

        setActiveVoiceChannel(channelId);

        // Make sure my mic is up before peers try to call me back
        try {
            if (!localStreamRef.current) await initLocalStream(false);
        } catch (e) { console.warn('[Voice] init stream failed', e); }

        // Tell every peer I'm in this voice channel
        connectionsRef.current.forEach(c => {
            if (c.open) c.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, voiceChannel: channelId } });
        });

        // Call only peers already in the same voice channel — others stay silent
        connectionsRef.current.forEach(conn => {
            if (!conn.open) return;
            if (peerVoiceChannels[conn.peer] === channelId) {
                startCall(conn.peer, false, channelId);
            }
        });
    };

    const leaveVoiceChannel = () => {
        setActiveVoiceChannel(null);
        // Close only voice-channel calls, keep DM calls alive
        Object.keys(callTypesRef.current).forEach(id => {
            if (callTypesRef.current[id] === 'voice-channel') {
                mediaConnectionsRef.current[id]?.close();
                delete mediaConnectionsRef.current[id];
                delete callTypesRef.current[id];
            }
        });
        setRemoteStreams(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(id => {
                if (!mediaConnectionsRef.current[id]) delete next[id];
            });
            return next;
        });
        // If no calls remain, drop the local stream
        if (Object.keys(mediaConnectionsRef.current).length === 0 && localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            teardownAudioGraph();
            setLocalStream(null);
            localStreamRef.current = null;
            setIsScreenSharing(false);
            setIsVideoEnabled(false);
            setMicLevel(0);
        }
        // Tell peers I left
        connectionsRef.current.forEach(c => {
            if (c.open) c.send({ type: 'voice_state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, voiceChannel: null } });
        });
        playCallDisconnectSound();
    };

    const clearAllHistory = async () => {
        // Drop any queued writes first, or they would repopulate the store.
        pendingWritesRef.current = new Map();
        if (writeTimerRef.current) {
            clearTimeout(writeTimerRef.current);
            writeTimerRef.current = null;
        }
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('p2p_chat_history_')) localStorage.removeItem(k);
        }
        await clearAllMessages();
        setMessagesRaw([]);
        setHasEarlierMessages(false);
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
                    broadcastVideoState(true, isScreenSharingRef.current);
                } catch (e) {
                    setError('Could not access camera');
                }
            } else if (videoTrack) {
                videoTrack.enabled = true;
                setIsVideoEnabled(true);
                broadcastVideoState(true, isScreenSharingRef.current);
            }
        } else {

            if (videoTrack) {
                videoTrack.enabled = false;
            }
            setIsVideoEnabled(false);
            broadcastVideoState(false, isScreenSharingRef.current);
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
        // Restoring the camera is easy. With no camera to restore, handing the
        // sender a still-live black track is what actually clears the frozen
        // last frame on the far side — replaceTrack(null) leaves it painted.
        const replacement = (origTrack && origTrack.readyState === 'live')
            ? origTrack
            : createBlankVideoTrack();
        if (replacement) {
            if (replacement !== origTrack) (replacement as any).isDummy = true;
            localStream.addTrack(replacement);
            Object.values(mediaConnectionsRef.current).forEach(call => {
                const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(replacement).catch(() => { });
            });
        }
        const cameraBack = !!(origTrack && origTrack.readyState === 'live' && origTrack.enabled);
        setIsVideoEnabled(cameraBack);
        broadcastVideoState(cameraBack, false);
        originalVideoTrackRef.current = null;

        // Restore the plain mic track on the audio sender and tear down the mix
        const mix = screenAudioMixRef.current;
        if (mix) {
            Object.values(mediaConnectionsRef.current).forEach(call => {
                const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'audio');
                if (sender) sender.replaceTrack(mix.originalTrack).catch(() => { });
            });
            try { mix.mixedTrack.stop(); } catch { }
            mix.ctx.close().catch(() => { });
            screenAudioMixRef.current = null;
        }

        // Stop any leftover capture tracks (e.g. desktop audio)
        screenCaptureStreamRef.current?.getTracks().forEach(t => {
            if (t.readyState === 'live') { try { t.stop(); } catch { } }
        });
        screenCaptureStreamRef.current = null;

        setIsScreenSharing(false);
    };

    // Swap the outgoing video to the captured screen and, when the capture has
    // audio, mix it with the mic so peers hear both.
    const applyScreenStream = (screenStream: MediaStream) => {
        const screenVideoTrack = screenStream.getVideoTracks()[0];
        if (!screenVideoTrack) {
            setError('Screen share failed: no video track.');
            screenStream.getTracks().forEach(t => t.stop());
            return;
        }
        const screenAudioTrack = screenStream.getAudioTracks()[0] || null;
        screenCaptureStreamRef.current = screenStream;

        if (localStream) {
            originalVideoTrackRef.current = localStream.getVideoTracks()[0] || null;
            if (originalVideoTrackRef.current) {
                localStream.removeTrack(originalVideoTrackRef.current);
            }
            localStream.addTrack(screenVideoTrack);

            if (screenAudioTrack) {
                try {
                    const micTrack = localStream.getAudioTracks()[0] || null;
                    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const dest = ctx.createMediaStreamDestination();
                    if (micTrack) ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
                    // Desktop audio goes through its own gain so it can be muted
                    // or levelled without touching the microphone.
                    const screenGain = ctx.createGain();
                    screenGain.gain.value = isScreenAudioMutedRef.current ? 0 : (audioSettingsRef.current?.screenAudioVolume ?? 100) / 100;
                    ctx.createMediaStreamSource(new MediaStream([screenAudioTrack])).connect(screenGain);
                    screenGain.connect(dest);
                    const mixedTrack = dest.stream.getAudioTracks()[0];
                    screenAudioMixRef.current = { ctx, mixedTrack, originalTrack: micTrack, screenGain };

                    Object.values(mediaConnectionsRef.current).forEach(call => {
                        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'audio');
                        if (sender) sender.replaceTrack(mixedTrack).catch(() => { });
                    });
                } catch (e) {
                    console.warn('[ScreenShare] Audio mix failed, sharing video only:', e);
                }
            }
        }

        setIsScreenSharing(true);
        releaseBlankTrack();

        Object.values(mediaConnectionsRef.current).forEach(call => {
            const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(screenVideoTrack);
        });

        broadcastVideoState(true, true);
        screenVideoTrack.onended = () => stopScreenShare();
    };

    // Mute or restore the desktop audio inside an active share without
    // disturbing the microphone that is mixed alongside it.
    const toggleScreenAudio = () => {
        setIsScreenAudioMuted(prev => {
            const next = !prev;
            isScreenAudioMutedRef.current = next;
            const mix = screenAudioMixRef.current;
            if (mix?.screenGain) {
                const target = next ? 0 : (audioSettingsRef.current?.screenAudioVolume ?? 100) / 100;
                mix.screenGain.gain.setTargetAtTime(target, mix.ctx.currentTime, 0.03);
            }
            return next;
        });
    };

    // Capture constraints derived from the user's quality settings. 0 height
    // means "leave the source alone".
    const screenVideoConstraints = (): MediaTrackConstraints => {
        const cfg = audioSettingsRef.current;
        const height = cfg?.screenHeight ?? 1080;
        const fps = cfg?.screenFps ?? 30;
        const c: MediaTrackConstraints = { frameRate: { ideal: fps, max: fps } };
        if (height > 0) {
            c.height = { ideal: height, max: height };
            c.width = { ideal: Math.round((height * 16) / 9), max: Math.round((height * 16) / 9) };
        }
        return c;
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

        const isElectron = !!(window as any).electronAPI;

        if (isElectron) {
            // Show the source picker — the share continues in selectScreenShareSource
            try {
                const sources = await (window as any).electronAPI.getDesktopSources();
                if (Array.isArray(sources) && sources.length > 0) {
                    setScreenShareSources(sources);
                    return;
                }
            } catch (e) {
                console.error('[ScreenShare] Could not enumerate sources', e);
            }
            setError('Could not list screens to share.');
            return;
        }

        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: screenVideoConstraints(),
                audio: audioSettingsRef.current?.screenAudioEnabled !== false,
            });
            applyScreenStream(screenStream);
        } catch (err) {
            console.error('Failed sharing screen', err);
            setError('Screen share cancelled or failed.');
        }
    };

    // Called by the picker modal; null = user cancelled.
    const selectScreenShareSource = async (sourceId: string | null) => {
        setScreenShareSources(null);
        if (!sourceId) return;

        const cfg = audioSettingsRef.current;
        const height = cfg?.screenHeight ?? 1080;
        const fps = cfg?.screenFps ?? 30;
        // Electron's desktop capturer only honours the legacy mandatory form.
        const mandatory: Record<string, unknown> = {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxFrameRate: fps,
            minFrameRate: Math.min(fps, 15),
        };
        if (height > 0) {
            mandatory.maxHeight = height;
            mandatory.maxWidth = Math.round((height * 16) / 9);
        }
        const videoConstraints = { mandatory } as any;

        try {
            if (cfg?.screenAudioEnabled === false) throw new Error('desktop audio disabled');
            const screenStream = await navigator.mediaDevices.getUserMedia({
                audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } as any,
                video: videoConstraints
            });
            applyScreenStream(screenStream);
        } catch {
            // Some sources refuse loopback audio — retry video-only before giving up
            try {
                const screenStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
                applyScreenStream(screenStream);
            } catch (err: any) {
                console.error('Failed sharing screen', err);
                setError('Screen share failed: ' + (err?.message || 'unknown error'));
            }
        }
    };

    // Bindings fire the current versions of these actions. No dependency array
    // on purpose: the ref is refreshed each render so a shortcut never calls a
    // stale closure holding last render's stream or call list.
    useEffect(() => {
        keybindHandlersRef.current = {
            toggleMute,
            toggleDeafen,
            toggleVideo: () => { void toggleVideo(); },
            toggleScreenShare: () => { void toggleScreenShare(); },
            endCall: endAllCalls,
            toggleNotifications: toggleNotificationsMuted,
        };
    });

    // Surface unread counts on the taskbar/tray and in the window title, which
    // is the only cue left once the window is hidden to tray.
    useEffect(() => {
        const dmTotal = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
        const serverTotal = Object.values(serverUnreads).reduce((a, b) => a + b, 0);
        const total = dmTotal + serverTotal;
        document.title = total > 0 ? `(${total}) P2P Chat` : 'P2P Chat';
        window.electronAPI?.setBadgeCount?.(total);
    }, [unreadCounts, serverUnreads]);

    return (
        <PeerContext.Provider value={{
            peerId,
            displayName: currentDisplayName,
            setDisplayName: updateDisplayName,
            avatarUrl,
            setAvatarUrl: updateAvatarUrl,
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
            activeCallDM,
            peerVoiceChannels,
            joinVoiceChannel,
            leaveVoiceChannel,
            micLevel,
            clearAllHistory,
            hasEarlierMessages,
            loadingEarlier,
            loadEarlierMessages,
            getServerChannels,
            addServerChannel,
            removeServerChannel,
            serverUnreads,
            deliveredMessageIds,
            signalStatus,
            iceConfig,
            applyIceConfig,
            peerSafetyNumbers,
            verifiedPeers,
            setPeerVerified,
            peerKeyChanged,
            screenShareSources,
            selectScreenShareSource,
            peerFirstSeen,
            badges,
            setBadges,
            peerBadges,
            fileTransfers,
            keybinds,
            setKeybind,
            resetKeybinds,
            globalKeybinds,
            setGlobalKeybinds,
            globalKeybindIssues,
            notificationsMuted,
            toggleNotificationsMuted,
            idleMinutes,
            setIdleMinutes,
            isScreenAudioMuted,
            toggleScreenAudio,
            peerVideoStates,
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
