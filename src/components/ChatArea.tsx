import React, { useState, useRef, useEffect, memo, useCallback, useMemo, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { usePeer, UserMessage, Badge, FileTransfer } from '../context/PeerContext';
import { Send, Hash, Video, Phone, Info, PlusCircle, FileText, Download, Users, Menu, Smile, Reply, X, Search, Trash2, Edit3, Pin, ChevronUp, ChevronDown, Mic, Square, Check, CheckCheck, Image as ImageIcon, Link2, AlertTriangle, ArrowDown, Copy, ShieldAlert, ShieldCheck, History } from 'lucide-react';
import { VideoGrid } from './VideoGrid';
import { ServerMembers } from './ServerMembers';
import { GroupMembers } from './GroupMembers';
import { UserProfileCard } from './UserProfileCard';
import { sanitizeMessageHtml, stripHtml, extractLinks } from '../utils/sanitize';
import { parseMarkdown } from '../utils/markdown';
import type { LinkPreview } from '../electron';
import './ChatArea.css';

const formatBytes = (bytes: number) => {
    if (!bytes || bytes < 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
};

// Anchors are rendered into the message body, so a raw click would try to
// navigate the app away (and in Electron simply did nothing). Route every link
// through the OS browser instead.
export const openLink = (href: string) => {
    if (!/^https?:\/\//i.test(href)) return;
    if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(href).catch(() => window.open(href, '_blank', 'noopener,noreferrer'));
    } else {
        window.open(href, '_blank', 'noopener,noreferrer');
    }
};

const handleMessageClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;

    // Spoilers reveal on click and stay revealed for the session.
    const spoiler = target?.closest?.('.spoiler') as HTMLElement | null;
    if (spoiler && !spoiler.classList.contains('revealed')) {
        e.preventDefault();
        e.stopPropagation();
        spoiler.classList.add('revealed');
        return;
    }

    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    openLink(href);
};

// Preview lookups are shared across every message that mentions the same URL.
const previewCache = new Map<string, LinkPreview | null>();

const LinkPreviewCard: React.FC<{ url: string }> = ({ url }) => {
    const [data, setData] = useState<LinkPreview | null>(() => previewCache.get(url) ?? null);
    const [resolved, setResolved] = useState(() => previewCache.has(url));

    useEffect(() => {
        if (previewCache.has(url)) {
            setData(previewCache.get(url) ?? null);
            setResolved(true);
            return;
        }
        // Only the desktop build can fetch arbitrary origins; browsers are
        // blocked by CORS, so the card is simply skipped there.
        const api = window.electronAPI?.fetchLinkPreview;
        if (!api) {
            previewCache.set(url, null);
            setResolved(true);
            return;
        }
        let alive = true;
        api(url)
            .then(result => {
                previewCache.set(url, result);
                if (!alive) return;
                setData(result);
                setResolved(true);
            })
            .catch(() => {
                previewCache.set(url, null);
                if (alive) setResolved(true);
            });
        return () => { alive = false; };
    }, [url]);

    if (!resolved || !data || (!data.title && !data.description && !data.image)) return null;

    return (
        <div className="link-preview" onClick={() => openLink(data.url)} role="link" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') openLink(data.url); }}>
            <div className="link-preview-body">
                {data.siteName && <span className="link-preview-site">{data.siteName}</span>}
                {data.title && <span className="link-preview-title">{data.title}</span>}
                {data.description && <span className="link-preview-desc">{data.description}</span>}
            </div>
            {data.image && (
                <img className="link-preview-thumb" src={data.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
            )}
        </div>
    );
};

const BadgeRow: React.FC<{ badges?: Badge[] }> = ({ badges }) => {
    if (!badges || badges.length === 0) return null;
    return (
        <span className="badge-row">
            {badges.map(b => (
                <span key={b.id} className="user-badge" style={{ backgroundColor: b.color + '22', color: b.color, borderColor: b.color + '55' }} title={b.label}>
                    {b.icon && <span className="user-badge-icon">{b.icon}</span>}
                    {b.label && <span className="user-badge-label">{b.label}</span>}
                </span>
            ))}
        </span>
    );
};

const TransferCard: React.FC<{ transfer: FileTransfer }> = ({ transfer }) => {
    const pct = transfer.size > 0 ? Math.min(100, Math.round((transfer.transferred / transfer.size) * 100)) : 0;
    return (
        <div className={`transfer-card ${transfer.failed ? 'failed' : ''}`}>
            <div className="transfer-icon">
                {transfer.failed ? <AlertTriangle size={18} /> : <FileText size={18} />}
            </div>
            <div className="transfer-body">
                <div className="transfer-head">
                    <span className="transfer-name">{transfer.name}</span>
                    <span className="transfer-meta">
                        {transfer.failed
                            ? 'Transfer failed'
                            : `${formatBytes(transfer.transferred)} / ${formatBytes(transfer.size)} · ${pct}%`}
                    </span>
                </div>
                <div className="transfer-bar">
                    <div className="transfer-bar-fill" style={{ width: pct + '%' }} />
                </div>
                <span className="transfer-sub">
                    {transfer.direction === 'in'
                        ? `Receiving from ${transfer.peerName}`
                        : `Sending to ${transfer.peerName}`}
                </span>
            </div>
        </div>
    );
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

const DRAFTS_KEY = 'p2p_chat_drafts';
const LAST_READ_KEY = 'p2p_chat_last_read';

const readJsonMap = (key: string): Record<string, string> => {
    try {
        const v = JSON.parse(localStorage.getItem(key) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
};

const readNumberMap = (key: string): Record<string, number> => {
    const raw = readJsonMap(key) as unknown as Record<string, unknown>;
    const out: Record<string, number> = {};
    Object.entries(raw).forEach(([k, v]) => { if (typeof v === 'number') out[k] = v; });
    return out;
};

const GIF_RECENTS_KEY = 'p2p_chat_gif_recents';
const TENOR_KEY_STORAGE = 'p2p_chat_tenor_key';

const readGifRecents = (): string[] => {
    try {
        const v = JSON.parse(localStorage.getItem(GIF_RECENTS_KEY) || '[]');
        return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string').slice(0, 24) : [];
    } catch { return []; }
};

const rememberGif = (url: string) => {
    const next = [url, ...readGifRecents().filter(u => u !== url)].slice(0, 24);
    try { localStorage.setItem(GIF_RECENTS_KEY, JSON.stringify(next)); } catch { /* quota */ }
    return next;
};

type GifResult = { url: string; preview: string };

// Tenor search is optional: with no API key the picker still works from pasted
// links and whatever you have used before, so the feature never hard-depends on
// a third-party account.
const GifPicker: React.FC<{ onPick: (url: string) => void }> = ({ onPick }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<GifResult[]>([]);
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [manualUrl, setManualUrl] = useState('');
    const [recents, setRecents] = useState<string[]>(readGifRecents);
    const apiKey = localStorage.getItem(TENOR_KEY_STORAGE) || '';

    useEffect(() => {
        if (!apiKey) return;
        let alive = true;
        const run = async () => {
            setStatus('loading');
            const base = query.trim()
                ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query.trim())}`
                : 'https://tenor.googleapis.com/v2/featured?';
            try {
                const res = await fetch(`${base}&key=${encodeURIComponent(apiKey)}&limit=24&media_filter=gif,tinygif&client_key=p2pchat`);
                if (!res.ok) throw new Error('tenor ' + res.status);
                const json = await res.json();
                if (!alive) return;
                const items: GifResult[] = (json?.results || [])
                    .map((r: any) => ({
                        url: r?.media_formats?.gif?.url || '',
                        preview: r?.media_formats?.tinygif?.url || r?.media_formats?.gif?.url || '',
                    }))
                    .filter((r: GifResult) => /^https:\/\//i.test(r.url));
                setResults(items);
                setStatus('idle');
            } catch {
                if (alive) { setResults([]); setStatus('error'); }
            }
        };
        const t = setTimeout(run, query ? 350 : 0);
        return () => { alive = false; clearTimeout(t); };
    }, [query, apiKey]);

    const choose = (url: string) => {
        setRecents(rememberGif(url));
        onPick(url);
    };

    const submitManual = (e: React.FormEvent) => {
        e.preventDefault();
        const url = manualUrl.trim();
        if (!/^https:\/\/\S+$/i.test(url)) return;
        choose(url);
        setManualUrl('');
    };

    return (
        <div className="gif-picker">
            <div className="gif-picker-head">
                <ImageIcon size={16} />
                <span>GIF</span>
            </div>

            {apiKey ? (
                <input
                    className="emoji-search-input"
                    placeholder="Search Tenor..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                />
            ) : (
                <p className="gif-picker-hint">
                    Add a Tenor API key in Settings &rarr; Appearance to search. You can still paste a GIF link below.
                </p>
            )}

            <form className="gif-url-form" onSubmit={submitManual}>
                <Link2 size={14} />
                <input
                    placeholder="Paste a https:// GIF link"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                />
                <button type="submit" disabled={!manualUrl.trim()}>Send</button>
            </form>

            <div className="gif-scroll-area">
                {status === 'loading' && <div className="gif-empty">Loading…</div>}
                {status === 'error' && <div className="gif-empty">Tenor search failed. Check your API key.</div>}

                {results.length > 0 && (
                    <div className="gif-grid">
                        {results.map(r => (
                            <button key={r.url} className="gif-item" onClick={() => choose(r.url)} title="Send this GIF">
                                <img src={r.preview} alt="" loading="lazy" referrerPolicy="no-referrer" />
                            </button>
                        ))}
                    </div>
                )}

                {recents.length > 0 && (
                    <>
                        <div className="emoji-category-title">Recently used</div>
                        <div className="gif-grid">
                            {recents.map(url => (
                                <button key={url} className="gif-item" onClick={() => choose(url)} title="Send again">
                                    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {results.length === 0 && recents.length === 0 && status === 'idle' && (
                    <div className="gif-empty">No GIFs yet. Paste a link to send your first one.</div>
                )}
            </div>
        </div>
    );
};

type MenuState = { x: number; y: number; msg: UserMessage } | null;

// Right-click menu for a message. The hover toolbar is still there, but it is
// fiddly to hit and disappears the moment the pointer leaves the row.
const MessageContextMenu: React.FC<{
    state: NonNullable<MenuState>;
    isMine: boolean;
    isPinned: boolean;
    onClose: () => void;
    onReply: () => void;
    onReact: (emoji: string) => void;
    onPin: () => void;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ state, isMine, isPinned, onClose, onReply, onReact, onPin, onEdit, onDelete }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: state.x, top: state.y });

    // Flip the menu back inside the window when opened near an edge.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setPos({
            left: Math.min(state.x, window.innerWidth - rect.width - 8),
            top: Math.min(state.y, window.innerHeight - rect.height - 8),
        });
    }, [state.x, state.y]);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    const run = (fn: () => void) => () => { fn(); onClose(); };
    const links = extractLinks(state.msg.text);

    return (
        <div className="msg-context-menu" ref={ref} style={{ left: pos.left, top: pos.top }}>
            <div className="msg-context-reactions">
                {QUICK_REACTIONS.slice(0, 6).map(emoji => (
                    <button key={emoji} onClick={run(() => onReact(emoji))} title={emoji}>{emoji}</button>
                ))}
            </div>
            <button className="msg-context-item" onClick={run(onReply)}><Reply size={14} /> Reply</button>
            <button className="msg-context-item" onClick={run(onPin)}>
                <Pin size={14} /> {isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button className="msg-context-item" onClick={run(() => navigator.clipboard.writeText(stripHtml(state.msg.text)))}>
                <Copy size={14} /> Copy text
            </button>
            {links.length > 0 && (
                <button className="msg-context-item" onClick={run(() => navigator.clipboard.writeText(links[0]))}>
                    <Link2 size={14} /> Copy link
                </button>
            )}
            {isMine && (
                <>
                    <div className="msg-context-sep" />
                    <button className="msg-context-item" onClick={run(onEdit)}><Edit3 size={14} /> Edit</button>
                    <button className="msg-context-item danger" onClick={run(onDelete)}><Trash2 size={14} /> Delete</button>
                </>
            )}
        </div>
    );
};

interface ChatAreaProps {
    onToggleMobileMenu?: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ onToggleMobileMenu }) => {
    const { messages, sendMessage, peerId, connections, startCall, activeServer, activeChannel, activeVoiceChannel, activeDM, knownPeers, avatarUrl, peerAvatars, groupDMs, localStream, remoteStreams, typingPeers, sendTypingIndicator, addReaction, peerNames, editMessage, deleteMessage, pinnedMessages, pinMessage, unpinMessage, activeCallDM, deliveredMessageIds, audioSettings, fileTransfers, badges, peerBadges, hasEarlierMessages, loadingEarlier, loadEarlierMessages, peerKeyChanged, verifiedPeers, peerSafetyNumbers } = usePeer();
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
    const [showGifPicker, setShowGifPicker] = useState(false);
    const [isPinnedOpen, setIsPinnedOpen] = useState(false);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);
    const [profilePopup, setProfilePopup] = useState<{ userId: string, x: number, y: number } | null>(null);
    const [contextMenu, setContextMenu] = useState<MenuState>(null);
    const [headerProfileFor, setHeaderProfileFor] = useState<string | null>(null);
    const [showJumpButton, setShowJumpButton] = useState(false);
    const [dividerTs, setDividerTs] = useState(0);
    const [editingId, setEditingId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const isNearBottomRef = useRef(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const emojiToggleBtnRef = useRef<HTMLButtonElement>(null);
    const gifPickerRef = useRef<HTMLDivElement>(null);
    const gifToggleBtnRef = useRef<HTMLButtonElement>(null);
    const chatInputRef = useRef<HTMLTextAreaElement>(null);

    // Which chat the composer belongs to. Drafts and read markers hang off this.
    const chatScope = activeServer
        ? 'srv:' + activeServer.id + ':' + activeChannel
        : (activeDM ? 'dm:' + activeDM : '');

    const inputTextRef = useRef('');
    const draftsRef = useRef<Record<string, string>>(readJsonMap(DRAFTS_KEY));
    const prevScopeRef = useRef(chatScope);
    const lastReadRef = useRef<Record<string, number>>(readNumberMap(LAST_READ_KEY));

    useEffect(() => { inputTextRef.current = inputText; }, [inputText]);

    const persistDrafts = () => {
        try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(draftsRef.current)); } catch { /* quota */ }
    };
    const persistLastRead = () => {
        try { localStorage.setItem(LAST_READ_KEY, JSON.stringify(lastReadRef.current)); } catch { /* quota */ }
    };

    const stashDraft = (scope: string, value: string) => {
        if (!scope) return;
        if (value.trim()) draftsRef.current[scope] = value;
        else delete draftsRef.current[scope];
        persistDrafts();
    };

    // Swap drafts when the visible chat changes, so a half-typed message is
    // still there when you come back instead of being silently discarded.
    useEffect(() => {
        const prev = prevScopeRef.current;
        if (prev === chatScope) return;
        stashDraft(prev, inputTextRef.current);
        prevScopeRef.current = chatScope;
        const restored = draftsRef.current[chatScope] || '';
        inputTextRef.current = restored;
        setInputText(restored);
        setReplyingTo(null);
        setDividerTs(lastReadRef.current[chatScope] || 0);
        isNearBottomRef.current = true;
        setShowJumpButton(false);
    }, [chatScope]);

    // Drafts also have to survive the window closing mid-sentence.
    useEffect(() => {
        const save = () => stashDraft(prevScopeRef.current, inputTextRef.current);
        window.addEventListener('beforeunload', save);
        return () => {
            window.removeEventListener('beforeunload', save);
            save();
        };
    }, []);

    // Grow the input with its content, capped so it never swallows the chat
    const autoGrowInput = () => {
        const el = chatInputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: audioSettings.deviceId ? { deviceId: { exact: audioSettings.deviceId } } : true
            });
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

    useEffect(() => {
        if (!showGifPicker) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                gifPickerRef.current && !gifPickerRef.current.contains(e.target as Node) &&
                gifToggleBtnRef.current && !gifToggleBtnRef.current.contains(e.target as Node)
            ) {
                setShowGifPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showGifPicker]);

    // A GIF is just a message whose only content is the image link; the markdown
    // renderer turns it into an inline <img>.
    const sendGif = useCallback((url: string) => {
        if (!canChatRef.current) return;
        sendMessage(parseMarkdown(url));
        setShowGifPicker(false);
    }, [sendMessage]);

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

    const canChatRef = useRef(canChat);
    canChatRef.current = canChat;

    // Only surface transfers that belong to the chat currently on screen.
    const visibleTransfers: FileTransfer[] = Object.values(fileTransfers).filter(t => {
        if (activeServer) return t.serverId === activeServer.id && t.channelId === activeChannel;
        if (!activeDM) return false;
        if (activeDM.startsWith('group_')) return t.channelId === activeDM;
        return t.serverId === 'home' && (t.peerId === activeDM || t.channelId === activeDM);
    });

    // Must be memoized. This array feeds the scroll-to-bottom effect below, and
    // rebuilding it on every render made that effect fire on every render, which
    // yanked the view back to the bottom the moment you tried to scroll up.
    const filteredMessages = useMemo(() => (activeServer
        ? messages.filter(msg => {
            // Server view: only show messages whose serverId matches.
            // Legacy messages without serverId fall through (assumed to belong to the loaded history file).
            if (msg.serverId && msg.serverId !== activeServer.id) return false;
            return (msg.channelId || 'general') === activeChannel;
        })
        : messages.filter(msg => {
            if (!activeDM) return false;
            // DM view: ignore anything tagged to a server
            if (msg.serverId && msg.serverId !== 'home') return false;
            if (activeDM.startsWith('group_')) {
                return msg.channelId === activeDM;
            }
            return (msg.senderId === activeDM) ||
                (msg.senderId === peerId && (msg.channelId === activeDM || msg.channelId === peerId || !msg.channelId || msg.channelId === 'general'));
        })
    ), [messages, activeServer, activeChannel, activeDM, peerId]);

    // What is actually on screen after the search filter.
    const displayMessages = useMemo(() => (
        searchQuery
            ? filteredMessages.filter(m => stripHtml(m.text).toLowerCase().includes(searchQuery.toLowerCase()))
            : filteredMessages
    ), [filteredMessages, searchQuery]);

    // Only the rows near the viewport are mounted. Without this a long history
    // with images keeps thousands of nodes alive and scrolling crawls.
    const virtualizer = useVirtualizer({
        count: displayMessages.length,
        getScrollElement: () => messagesContainerRef.current,
        estimateSize: () => 52,
        overscan: 12,
        getItemKey: (index) => displayMessages[index]?.id ?? index,
    });

    // Pinning to the bottom has to survive rows growing after they measure, so
    // the scroll is re-applied on the next frame as well.
    const stickToBottom = useCallback(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => {
            const node = messagesContainerRef.current;
            if (node && isNearBottomRef.current) node.scrollTop = node.scrollHeight;
        });
    }, []);

    // Re-pin only when the conversation actually moves: a new or removed message,
    // a chat switch, or rows growing as their images finish measuring. Depending
    // on the array itself would re-run on every unrelated re-render.
    const lastMessageKey = displayMessages.length > 0
        ? displayMessages.length + ':' + displayMessages[displayMessages.length - 1].id
        : '0';
    const measuredHeight = virtualizer.getTotalSize();

    useLayoutEffect(() => {
        if (isNearBottomRef.current) stickToBottom();
    }, [lastMessageKey, measuredHeight, chatScope, stickToBottom]);

    const handleMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const threshold = 150;
        const near = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
        isNearBottomRef.current = near;
        setShowJumpButton(!near);
    };

    const scrollToBottom = () => {
        isNearBottomRef.current = true;
        setShowJumpButton(false);
        stickToBottom();
    };

    // Reading means being at the bottom with the window in front of you.
    useEffect(() => {
        if (!chatScope || filteredMessages.length === 0) return;
        if (!isNearBottomRef.current || document.hidden) return;
        const newest = filteredMessages[filteredMessages.length - 1].timestamp;
        if ((lastReadRef.current[chatScope] || 0) >= newest) return;
        lastReadRef.current[chatScope] = newest;
        persistLastRead();
    });

    // Index of the first message that arrived after the last time this chat was
    // read. Own messages never start a divider.
    const dividerIndex = useMemo(() => {
        if (!dividerTs) return -1;
        return displayMessages.findIndex(m => m.timestamp > dividerTs && m.senderId !== peerId);
    }, [dividerTs, displayMessages, peerId]);
    const unreadBelow = dividerIndex >= 0 ? displayMessages.length - dividerIndex : 0;

    // Bring the currently selected search hit into view. With virtualization the
    // row may not be mounted, so this addresses it by index rather than by
    // querying the DOM.
    useEffect(() => {
        if (!searchQuery || displayMessages.length === 0) return;
        const index = Math.min(Math.max(searchResultIndex, 0), displayMessages.length - 1);
        virtualizer.scrollToIndex(index, { align: 'center' });
    }, [searchResultIndex, searchQuery, displayMessages.length, virtualizer]);

    const formatDateSeparator = (ts: number) => {
        const d = new Date(ts);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === today.toDateString()) return 'Today';
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const handleSend = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (inputText.trim() && canChat) {
            const parsed = parseMarkdown(inputText);
            sendMessage(parsed, undefined, replyingTo ? { id: replyingTo.id, senderName: replyingTo.senderName, text: replyingTo.text } : undefined);
            setInputText('');
            inputTextRef.current = '';
            stashDraft(chatScope, '');
            setReplyingTo(null);
            setShowEmojiPicker(false);
            if (chatInputRef.current) chatInputRef.current.style.height = 'auto';
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
    const MAX_FILE_SIZE = 10 * 1024 * 1024;

    // One path for drops, the file picker and clipboard pastes.
    const sendFile = (file: File, caption = '') => {
        if (!canChatRef.current) return;
        if (file.size > MAX_FILE_SIZE) {
            alert(`File too large! Maximum size is 10MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result as string;
            const base64Data = result.split(',')[1];
            if (!base64Data) return;
            sendMessage(caption, {
                name: file.name || `pasted-${Date.now()}.png`,
                type: file.type || 'application/octet-stream',
                data: base64Data,
            });
        };
        reader.readAsDataURL(file);
    };

    // Screenshots are the single most common thing people paste into a chat.
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (!canChat) return;
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    e.preventDefault();
                    sendFile(file, inputText.trim());
                    setInputText('');
                    inputTextRef.current = '';
                    return;
                }
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => e.preventDefault();
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragging(false);
        if (!canChat) return;
        const file = e.dataTransfer.files?.[0];
        if (file) sendFile(file);
    };

    // Only surface typing indicators that belong to the chat on screen.
    // Entries without a scope come from older clients — show them everywhere.
    const typingPeerIds = Object.entries(typingPeers)
        .filter(([id, info]) => {
            if (id === peerId) return false;
            const scope = info?.scope;
            if (scope === undefined) return true;
            if (activeServer) return scope === `${activeServer.id}:${activeChannel}`;
            if (!activeDM) return false;
            if (activeDM.startsWith('group_')) return scope === activeDM;
            return id === activeDM;
        })
        .map(([id]) => id);

    const typingNames = typingPeerIds.map(id => peerNames[id] || knownPeers[id] || id.substring(0, 8));

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !canChat) return;
        sendFile(file, inputText);
        setInputText('');
        inputTextRef.current = '';
    };

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Only show video grid if there's an active call relevant to current view.
    // Server: any time you're in a voice channel of this server.
    // DM: only when viewing the same DM as the active call.
    const showVideoGrid = activeServer
        ? !!activeVoiceChannel && (!!localStream || Object.keys(remoteStreams).length > 0)
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
                    {(() => {
                        const dmPartner = !activeServer && activeDM && !activeDM.startsWith('group_') ? activeDM : null;
                        return (
                            <div
                                className={`chat-title ${dmPartner ? 'clickable' : ''}`}
                                onClick={() => dmPartner && setHeaderProfileFor(dmPartner)}
                                title={dmPartner ? 'Open profile and safety number' : undefined}
                            >
                                {TitleIcon}
                                <h3>{titleName}</h3>
                                {dmPartner && verifiedPeers[dmPartner] && (
                                    <ShieldCheck size={14} className="chat-title-verified" aria-label="Verified contact" />
                                )}
                            </div>
                        );
                    })()}
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

                {!activeServer && activeDM && !activeDM.startsWith('group_') && peerKeyChanged[activeDM] && (
                    <div className="key-change-banner">
                        <ShieldAlert size={16} />
                        <span>
                            This contact&apos;s encryption key changed. That happens after a reinstall, but it also
                            looks exactly like someone impersonating them. Compare safety numbers on their profile
                            before sharing anything sensitive.
                        </span>
                    </div>
                )}

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
                            {!activeServer && activeDM && !activeDM.startsWith('group_') && (
                                <>
                                    <div className="info-row">
                                        <span className="info-label">Identity</span>
                                        <span className="info-value" style={{ color: verifiedPeers[activeDM] ? 'var(--discord-green)' : 'var(--discord-text-muted)' }}>
                                            {verifiedPeers[activeDM] ? 'Verified' : 'Not verified'}
                                        </span>
                                    </div>
                                    {peerSafetyNumbers[activeDM] && (
                                        <div className="info-row info-row-stacked">
                                            <span className="info-label">Safety number</span>
                                            <span className="info-value safety-number">{peerSafetyNumbers[activeDM]}</span>
                                        </div>
                                    )}
                                </>
                            )}
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
                    <div className="pinned-messages-panel" onClick={handleMessageClick}>
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
                                        <div className="pinned-msg-text" dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(msg.text) }} />
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
                    const resultCount = searchQuery ? displayMessages.length : 0;
                    return (
                        <div className="search-bar">
                            <Search size={16} />
                            <input
                                className="search-input"
                                placeholder="Search messages... (Enter jumps to next result)"
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setSearchResultIndex(0); }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && resultCount > 0) {
                                        e.preventDefault();
                                        setSearchResultIndex(i => (i + 1) % resultCount);
                                    }
                                    if (e.key === 'Escape') { setSearchQuery(''); setIsSearchOpen(false); }
                                }}
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
                <div className={`message-list ${canChat ? 'active' : ''}`} ref={messagesContainerRef} onScroll={handleMessagesScroll} onClick={handleMessageClick}>
                    {hasEarlierMessages && !searchQuery && (
                        <div className="load-earlier-row">
                            <button className="load-earlier-btn" onClick={loadEarlierMessages} disabled={loadingEarlier}>
                                <History size={14} /> {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
                            </button>
                        </div>
                    )}
                    {displayMessages.length === 0 ? (
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
                        <div
                            className="virtual-message-area"
                            style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
                        >
                            {virtualizer.getVirtualItems().map(item => {
                                const index = item.index;
                                const msg = displayMessages[index];
                                if (!msg) return null;
                                const isMe = msg.senderId === peerId;
                                const prevMsg = index > 0 ? displayMessages[index - 1] : null;
                                const newDay = !prevMsg || new Date(prevMsg.timestamp).toDateString() !== new Date(msg.timestamp).toDateString();
                                const isConsecutive = !newDay && !!prevMsg && prevMsg.senderId === msg.senderId;
                                return (
                                    <div
                                        key={item.key}
                                        data-index={index}
                                        ref={virtualizer.measureElement}
                                        style={{
                                            position: 'absolute',
                                            // Offset with `top`, not `transform`. A transformed
                                            // ancestor becomes the containing block for every
                                            // position:fixed descendant, which trapped the image
                                            // lightbox and profile cards inside a single row
                                            // instead of covering the window.
                                            top: item.start,
                                            left: 0,
                                            width: '100%',
                                        }}
                                    >
                                        {newDay && (
                                            <div className="date-separator">
                                                <span>{formatDateSeparator(msg.timestamp)}</span>
                                            </div>
                                        )}
                                        {index === dividerIndex && (
                                            <div className="unread-divider"><span>New messages</span></div>
                                        )}
                                        <MessageRow
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
                                            isSearchCurrent={!!searchQuery && index === searchResultIndex}
                                            deliveryState={isMe ? (deliveredMessageIds.has(msg.id) ? 'delivered' : 'sent') : null}
                                            senderBadges={isMe ? badges : peerBadges[msg.senderId]}
                                            isEditing={editingId === msg.id}
                                            onStartEdit={() => setEditingId(msg.id)}
                                            onStopEdit={() => setEditingId(null)}
                                            onContextMenu={(x, y) => setContextMenu({ x, y, msg })}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {visibleTransfers.length > 0 && (
                        <div className="transfer-list">
                            {visibleTransfers.map(t => <TransferCard key={t.id} transfer={t} />)}
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {showJumpButton && (
                    <button className="jump-to-bottom" onClick={scrollToBottom} title="Jump to the newest message">
                        <ArrowDown size={16} />
                        {unreadBelow > 0 ? `${unreadBelow} new` : 'Jump to present'}
                    </button>
                )}

                {/* Typing Indicator */}
                {typingNames.length > 0 && (
                    <div className="typing-indicator">
                        <div className="typing-avatars">
                            {typingPeerIds.slice(0, 3).map((id, i) => (
                                <span key={id} className="typing-avatar" style={{ zIndex: 3 - i }}>
                                    {peerAvatars[id]
                                        ? <img src={peerAvatars[id]} alt="" />
                                        : (peerNames[id] || knownPeers[id] || id).substring(0, 1).toUpperCase()}
                                </span>
                            ))}
                        </div>
                        <div className="typing-dots"><span /><span /><span /></div>
                        <span className="typing-text">
                            <strong>{typingNames.slice(0, 3).join(', ')}</strong>
                            {typingNames.length > 3 ? ` and ${typingNames.length - 3} more are` : (typingNames.length === 1 ? ' is' : ' are')} typing…
                        </span>
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
                    {replyingTo && (() => {
                        const replyPreview = stripHtml(replyingTo.text);
                        return (
                            <div className="reply-preview">
                                <Reply size={14} />
                                <span>Replying to <strong>{replyingTo.senderName}</strong>: {replyPreview.substring(0, 80)}{replyPreview.length > 80 ? '...' : ''}</span>
                                <button className="reply-close" onClick={() => setReplyingTo(null)}><X size={14} /></button>
                            </div>
                        );
                    })()}
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
                            ref={chatInputRef}
                            className="chat-input"
                            placeholder={canChat ? `Message ${activeServer ? '#' : '@'}${titleName}` : "Connect to a peer to send messages..."}
                            value={inputText}
                            onChange={(e) => {
                                const val = e.target.value;
                                setInputText(val);
                                autoGrowInput();
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
                            onPaste={handlePaste}
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
                            ref={gifToggleBtnRef}
                            type="button"
                            className={`emoji-toggle-btn ${showGifPicker ? 'active' : ''}`}
                            onClick={() => { setShowGifPicker(v => !v); setShowEmojiPicker(false); }}
                            disabled={!canChat}
                            title="Send a GIF"
                        >
                            <ImageIcon size={20} />
                        </button>
                        <button
                            ref={emojiToggleBtnRef}
                            type="button"
                            className={`emoji-toggle-btn ${showEmojiPicker ? 'active' : ''}`}
                            onClick={() => { setShowEmojiPicker(v => !v); setShowGifPicker(false); }}
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
                    {showGifPicker && (
                        <div ref={gifPickerRef}>
                            <GifPicker onPick={sendGif} />
                        </div>
                    )}
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
            {headerProfileFor && (
                <UserProfileCard userId={headerProfileFor} onClose={() => setHeaderProfileFor(null)} />
            )}

            {contextMenu && (
                <MessageContextMenu
                    state={contextMenu}
                    isMine={contextMenu.msg.senderId === peerId}
                    isPinned={pinnedMessages.includes(contextMenu.msg.id)}
                    onClose={() => setContextMenu(null)}
                    onReply={() => setReplyingTo(contextMenu.msg)}
                    onReact={(emoji) => addReaction(contextMenu.msg.id, emoji)}
                    onPin={() => pinnedMessages.includes(contextMenu.msg.id)
                        ? unpinMessage(contextMenu.msg.id)
                        : pinMessage(contextMenu.msg.id)}
                    onEdit={() => setEditingId(contextMenu.msg.id)}
                    onDelete={() => deleteMessage(contextMenu.msg.id)}
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
const MessageRow = memo(({ msg, isMe, isConsecutive, avatarUrl, peerAvatars, formatTime, onReply, onReact, onEdit, onDelete, onPin, isPinned, peerId, peerNames, isSearchCurrent, deliveryState, senderBadges, isEditing, onStartEdit, onStopEdit, onContextMenu }: {
    msg: UserMessage; isMe: boolean; isConsecutive: boolean; avatarUrl: string; peerAvatars: Record<string, string>; formatTime: (t: number) => string;
    onReply: () => void; onReact: (emoji: string) => void; onEdit: (newText: string) => void; onDelete: () => void; onPin: () => void; isPinned: boolean; peerId: string; peerNames: Record<string, string>;
    isSearchCurrent?: boolean; deliveryState?: 'sent' | 'delivered' | null; senderBadges?: Badge[];
    // Editing is owned by the parent so the context menu can start it too.
    isEditing: boolean; onStartEdit: () => void; onStopEdit: () => void;
    onContextMenu: (x: number, y: number) => void;
}) => {
    const [showActions, setShowActions] = useState(false);
    const [editText, setEditText] = useState('');

    // Seed the editor with the plain text whenever editing begins.
    useEffect(() => {
        if (isEditing) setEditText(stripHtml(msg.text));
    }, [isEditing, msg.text]);
    const [showProfileCard, setShowProfileCard] = useState(false);
    const msgAvatar = isMe ? avatarUrl : peerAvatars[msg.senderId];
    const reactions = msg.reactions || {};
    // One card per message, for the first plain link it contains. Media links
    // already render inline, so they are not previewed again.
    const previewUrl = React.useMemo(() => extractLinks(msg.text)[0] || '', [msg.text]);
    return (
        <div className={`message-container ${isConsecutive ? 'consecutive' : ''} ${isSearchCurrent ? 'search-current' : ''}`}
            onMouseEnter={() => setShowActions(true)}
            onMouseLeave={() => setShowActions(false)}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY); }}
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
                        <BadgeRow badges={senderBadges} />
                        <span className="message-time">{formatTime(msg.timestamp)}</span>
                        {isPinned && <span className="pin-indicator" title="Pinned"><Pin size={12} /></span>}
                        {deliveryState && (
                            <span className={`delivery-status ${deliveryState}`} title={deliveryState === 'delivered' ? 'Delivered' : 'Sent'}>
                                {deliveryState === 'delivered' ? <CheckCheck size={13} /> : <Check size={13} />}
                            </span>
                        )}
                    </div>
                )}
                {/* Reply Quote */}
                {msg.replyTo && (
                    <div className="reply-quote">
                        <span className="reply-quote-author">{msg.replyTo.senderName}</span>
                        <span className="reply-quote-text">{stripHtml(msg.replyTo.text).substring(0, 100)}</span>
                    </div>
                )}
                {isEditing ? (
                    <div className="edit-input-container">
                        <input
                            className="edit-input"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { onEdit(parseMarkdown(editText)); onStopEdit(); }
                                if (e.key === 'Escape') onStopEdit();
                            }}
                            autoFocus
                        />
                        <span className="edit-hint">Escape to cancel • Enter to save</span>
                    </div>
                ) : (
                    <>
                        <div className="message-text" dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(msg.text) }} />
                        {msg.edited && <span className="edited-indicator">(edited)</span>}
                        {previewUrl && <LinkPreviewCard url={previewUrl} />}
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
                            <button className="action-btn" onClick={onStartEdit} title="Edit"><Edit3 size={14} /></button>
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

// Fullscreen image preview with download — replaces opening a browser tab
const ImageLightbox: React.FC<{ url: string; name: string; onClose: () => void }> = ({ url, name, onClose }) => {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="lightbox-overlay" onClick={onClose}>
            <img src={url} alt={name} className="lightbox-img" onClick={(e) => e.stopPropagation()} />
            <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
                <span className="lightbox-name">{name}</span>
                <a href={url} download={name} className="lightbox-btn" title="Download">
                    <Download size={16} /> Download
                </a>
                <button className="lightbox-btn" onClick={onClose} title="Close (Esc)">
                    <X size={16} /> Close
                </button>
            </div>
        </div>
    );
};

const FileAttachment: React.FC<{ file: NonNullable<UserMessage['file']> }> = ({ file }) => {
    const [objectUrl, setObjectUrl] = useState<string>('');
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [showLightbox, setShowLightbox] = useState(false);

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
            // Decode straight into a typed array. The previous version built an
            // intermediate JS Array of one number per byte, which stalled the UI
            // for seconds on the multi-megabyte attachments chunked transfer now
            // makes routine.
            const binary = atob(file.data);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: file.type });
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
                    <>
                        <img
                            src={objectUrl}
                            alt={file.name}
                            loading="lazy"
                            style={{ cursor: 'zoom-in' }}
                            onClick={() => setShowLightbox(true)}
                        />
                        {showLightbox && <ImageLightbox url={objectUrl} name={file.name} onClose={() => setShowLightbox(false)} />}
                    </>
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
