// WebRTC ICE configuration.
//
// STUN alone only works when at least one side's NAT is permissive enough to
// allow a direct path. Behind symmetric NAT, or on many mobile and corporate
// networks, two peers simply never connect and the failure is silent. A TURN
// relay fixes that by forwarding the encrypted media and data for them.
//
// No relay is configured by default: it costs bandwidth and sees both parties'
// IP addresses, so it is the user's decision. The payload stays end-to-end
// encrypted either way; a relay only moves bytes it cannot read.

export type IceConfig = {
    turnEnabled: boolean;
    urls: string;       // newline or comma separated
    username: string;
    credential: string;
};

export const ICE_CONFIG_KEY = 'p2p_chat_ice_config';

export const DEFAULT_ICE_CONFIG: IceConfig = {
    turnEnabled: false,
    urls: '',
    username: '',
    credential: '',
};

// Open Relay is a free, no-signup TURN service. Offered as a one-click preset so
// the feature is usable without hunting for credentials first.
export const OPEN_RELAY_PRESET: IceConfig = {
    turnEnabled: true,
    urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443',
    ].join('\n'),
    username: 'openrelayproject',
    credential: 'openrelayproject',
};

const STUN_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
];

export const readIceConfig = (): IceConfig => {
    try {
        const raw = JSON.parse(localStorage.getItem(ICE_CONFIG_KEY) || 'null');
        if (!raw || typeof raw !== 'object') return { ...DEFAULT_ICE_CONFIG };
        return {
            turnEnabled: !!raw.turnEnabled,
            urls: typeof raw.urls === 'string' ? raw.urls : '',
            username: typeof raw.username === 'string' ? raw.username : '',
            credential: typeof raw.credential === 'string' ? raw.credential : '',
        };
    } catch {
        return { ...DEFAULT_ICE_CONFIG };
    }
};

export const saveIceConfig = (cfg: IceConfig) => {
    try { localStorage.setItem(ICE_CONFIG_KEY, JSON.stringify(cfg)); } catch { /* quota */ }
};

const parseUrls = (value: string): string[] =>
    value
        .split(/[\n,]/)
        .map(u => u.trim())
        .filter(u => /^turns?:/i.test(u));

/** Build the iceServers list PeerJS is handed. STUN is always included. */
export const buildIceServers = (cfg: IceConfig): RTCIceServer[] => {
    const servers = [...STUN_SERVERS];
    if (!cfg.turnEnabled) return servers;
    const urls = parseUrls(cfg.urls);
    if (urls.length === 0) return servers;
    servers.push({
        urls,
        username: cfg.username || undefined,
        credential: cfg.credential || undefined,
    });
    return servers;
};

export const turnIsConfigured = (cfg: IceConfig): boolean =>
    cfg.turnEnabled && parseUrls(cfg.urls).length > 0;
