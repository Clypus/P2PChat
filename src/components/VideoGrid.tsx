import React, { useEffect, useRef, useState } from 'react';
import { usePeer } from '../context/PeerContext';
import { Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, PhoneOff, Headphones, Maximize, Volume2, VolumeX, MonitorSpeaker } from 'lucide-react';
import './VideoGrid.css';

interface StreamItem {
    id: string;
    stream: MediaStream;
    isLocal: boolean;
    label: string;
    // False when the sender says its camera and screen share are both off, so
    // the tile shows an avatar instead of the last frame it happened to send.
    hasVideo: boolean;
    avatar?: string;
}

const useAudioActivity = (stream: MediaStream | null) => {
    const [isSpeaking, setIsSpeaking] = useState(false);
    useEffect(() => {
        if (!stream || stream.getAudioTracks().length === 0) {
            setIsSpeaking(false);
            return;
        }
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.4;
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let animationFrameId: number;
            const checkAudioLevel = () => {
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
                setIsSpeaking(average > 8);
                animationFrameId = requestAnimationFrame(checkAudioLevel);
            };
            checkAudioLevel();
            return () => {
                cancelAnimationFrame(animationFrameId);
                source.disconnect();
                audioContext.close().catch(() => { });
            };
        } catch (err) { console.warn("Audio Context init fail", err); }
    }, [stream]);
    return isSpeaking;
};

const VideoCardBase: React.FC<{
    stream: MediaStream;
    label: string;
    muted: boolean;
    peerId?: string;
    isLocal?: boolean;
    voiceState?: { muted: boolean, deafened: boolean };
    onClick?: () => void;
    volume?: number;
    onVolumeChange?: (vol: number) => void;
    hasVideo?: boolean;
    avatar?: string;
}> = ({ stream, label, muted, peerId, isLocal, voiceState, onClick, volume = 100, onVolumeChange, hasVideo = true, avatar }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const isSpeaking = useAudioActivity(stream);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream, hasVideo]);

    const cardRef = useRef<HTMLDivElement>(null);

    const handleFullscreen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!document.fullscreenElement) {
            cardRef.current?.requestFullscreen().catch(console.error);
        } else {
            document.exitFullscreen().catch(console.error);
        }
    };

    return (
        <div ref={cardRef} className={`video-card ${isSpeaking && !voiceState?.muted ? 'speaking' : ''}`} onClick={onClick} onDoubleClick={handleFullscreen}>
            {hasVideo ? (
                <video ref={videoRef} autoPlay muted={muted} playsInline className="grid-video" />
            ) : (
                <div className="grid-video-placeholder">
                    {avatar
                        ? <img src={avatar} alt="" className="grid-avatar-img" />
                        : <div className="grid-avatar-initials">{(label || '?').substring(0, 2).toUpperCase()}</div>}
                </div>
            )}
            <div className="video-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                    {(voiceState?.muted || voiceState?.deafened) && <MicOff size={16} color="var(--discord-red)" style={{ marginRight: '6px', flexShrink: 0 }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                <span title="Full Screen" style={{ cursor: 'pointer', opacity: 0.7, marginLeft: '12px', display: 'flex' }} onClick={handleFullscreen}>
                    <Maximize size={14} />
                </span>
            </div>
            {!isLocal && onVolumeChange && (
                <div className="volume-slider-container">
                    <Volume2 size={14} />
                    <input
                        type="range"
                        min="0"
                        max="200"
                        value={volume}
                        onChange={(e) => onVolumeChange(Number(e.target.value))}
                        className="volume-slider"
                        title={`Volume: ${volume}%`}
                        onClick={(e) => e.stopPropagation()}
                    />
                    <span className="volume-value">{volume}%</span>
                </div>
            )}
        </div>
    );
};

// Hidden audio playback for remote streams — ensures audio plays even without active video

export const RemoteAudioPlayback: React.FC<{ streams: Record<string, MediaStream>; isDeafened?: boolean; peerVolumes?: Record<string, number>; masterVolume?: number }> = ({ streams, isDeafened = false, peerVolumes = {}, masterVolume = 100 }) => {
    const audioRefs = useRef<Record<string, { audio: HTMLAudioElement; ctx: AudioContext; gain: GainNode; source: MediaStreamAudioSourceNode }>>({});

    const computeGain = (peerId: string) => {
        if (isDeafened) return 0;
        const peer = (peerVolumes[peerId] ?? 100) / 100;
        const master = (masterVolume ?? 100) / 100;
        return peer * master; // 0..4.0 — Web Audio clips at large values gracefully
    };

    useEffect(() => {
        Object.entries(streams).forEach(([peerId, stream]) => {
            if (!audioRefs.current[peerId]) {
                // Create Web Audio API chain for amplification beyond 100%
                const audio = new Audio();
                audio.autoplay = true;
                (audio as any).playsInline = true;

                const ctx = new AudioContext();
                const source = ctx.createMediaStreamSource(stream);
                const gain = ctx.createGain();
                gain.gain.value = computeGain(peerId);

                source.connect(gain);
                gain.connect(ctx.destination);

                // Still need the audio element for browser autoplay policy
                audio.srcObject = stream;
                audio.volume = 0; // Mute HTML audio — GainNode handles volume
                audio.play().catch(() => {
                    const retryPlay = () => {
                        audio.play().catch(() => { });
                        ctx.resume().catch(() => { });
                        document.removeEventListener('click', retryPlay);
                    };
                    document.addEventListener('click', retryPlay);
                });

                audioRefs.current[peerId] = { audio, ctx, gain, source };
            } else {
                if (audioRefs.current[peerId].audio.srcObject !== stream) {
                    // Reconnect with new stream
                    const entry = audioRefs.current[peerId];
                    entry.source.disconnect();
                    const newSource = entry.ctx.createMediaStreamSource(stream);
                    newSource.connect(entry.gain);
                    entry.source = newSource;
                    entry.audio.srcObject = stream;
                    entry.audio.play().catch(() => { });
                }
            }
        });

        // Cleanup removed peers
        Object.keys(audioRefs.current).forEach(peerId => {
            if (!streams[peerId]) {
                const entry = audioRefs.current[peerId];
                entry.source.disconnect();
                entry.gain.disconnect();
                entry.audio.pause();
                entry.audio.srcObject = null;
                entry.ctx.close().catch(() => { });
                delete audioRefs.current[peerId];
            }
        });

        return () => {
            Object.values(audioRefs.current).forEach(entry => {
                entry.source.disconnect();
                entry.gain.disconnect();
                entry.audio.pause();
                entry.audio.srcObject = null;
                entry.ctx.close().catch(() => { });
            });
            audioRefs.current = {};
        };
    }, [streams]);

    // Re-apply gain whenever deafen / per-peer volume / master volume changes
    useEffect(() => {
        Object.entries(audioRefs.current).forEach(([peerId, entry]) => {
            entry.gain.gain.value = computeGain(peerId);
        });
    }, [peerVolumes, isDeafened, masterVolume]);

    return null;
};

export const VideoGrid: React.FC = () => {
    const {
        localStream, remoteStreams, displayName, peerNames, peerAvatars, avatarUrl,
        endAllCalls, toggleMute, toggleDeafen, toggleVideo, toggleScreenShare,
        isMuted, isDeafened, peerVoiceStates, isVideoEnabled, isScreenSharing,
        peerVolumes, setPeerVolume, peerVideoStates, isScreenAudioMuted, toggleScreenAudio,
        audioSettings, updateAudioSettings,
    } = usePeer();
    const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);

    const allStreams: StreamItem[] = [];
    if (localStream) {
        allStreams.push({
            id: 'local',
            stream: localStream,
            isLocal: true,
            label: `${displayName || 'You'} (You)`,
            hasVideo: isVideoEnabled || isScreenSharing,
            avatar: avatarUrl,
        });
    }

    Object.entries(remoteStreams).forEach(([id, stream]) => {
        const name = peerNames[id] || `Peer ${id.substring(0, 6)}`;
        const reported = peerVideoStates[id];
        // Peers that predate video_state never report, so assume they are
        // sending video and fall back to the track's own state.
        const hasVideo = reported
            ? (reported.video || reported.screen)
            : stream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled);
        allStreams.push({ id, stream, isLocal: false, label: name, hasVideo, avatar: peerAvatars[id] });
    });

    if (allStreams.length === 0) return null;

    // Spotlight: click a tile to make it large; click again (or pick another) to switch
    const focused = focusedStreamId ? allStreams.find(s => s.id === focusedStreamId) : undefined;

    const renderCard = (item: StreamItem, onClick: () => void) => (
        <VideoCardBase
            key={item.id}
            stream={item.stream}
            label={item.label}
            muted={true}
            peerId={item.id}
            isLocal={item.isLocal}
            voiceState={item.isLocal ? { muted: isMuted, deafened: isDeafened } : peerVoiceStates[item.id]}
            volume={peerVolumes[item.id] ?? 100}
            onVolumeChange={(vol) => setPeerVolume(item.id, vol)}
            onClick={onClick}
            hasVideo={item.hasVideo}
            avatar={item.avatar}
        />
    );

    return (
        <div className="video-overlay">
            { }
            {focused ? (
                <div className="video-focus-layout">
                    {renderCard(focused, () => setFocusedStreamId(null))}
                    {allStreams.length > 1 && (
                        <div className="video-thumbnail-strip">
                            {allStreams.filter(s => s.id !== focused.id).map(item =>
                                renderCard(item, () => setFocusedStreamId(item.id))
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className={`video-grid count-${Math.min(allStreams.length, 6)}`}>
                    {allStreams.map(item => renderCard(item, () => setFocusedStreamId(item.id)))}
                </div>
            )}

            {isScreenSharing && (
                <div className="screen-audio-bar">
                    <button
                        className={`screen-audio-btn ${isScreenAudioMuted ? 'muted' : ''}`}
                        onClick={toggleScreenAudio}
                        title={isScreenAudioMuted ? 'Unmute screen audio' : 'Mute screen audio'}
                    >
                        {isScreenAudioMuted ? <VolumeX size={16} /> : <MonitorSpeaker size={16} />}
                        <span>Screen audio</span>
                    </button>
                    <input
                        type="range"
                        min="0"
                        max="200"
                        value={audioSettings.screenAudioVolume ?? 100}
                        disabled={isScreenAudioMuted}
                        onChange={(e) => updateAudioSettings({ screenAudioVolume: Number(e.target.value) })}
                        className="volume-slider"
                        title={`Screen audio volume: ${audioSettings.screenAudioVolume ?? 100}%`}
                    />
                    <span className="volume-value">{isScreenAudioMuted ? 'Muted' : `${audioSettings.screenAudioVolume ?? 100}%`}</span>
                </div>
            )}

            { }
            <div className="media-controls">
                <button className={`control-btn ${isMuted ? 'danger' : ''}`} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                </button>
                <button className={`control-btn ${isDeafened ? 'danger' : ''}`} onClick={toggleDeafen} title={isDeafened ? 'Undeafen' : 'Deafen'}>
                    {isDeafened ? <Volume2 size={24} style={{ opacity: 0.5 }} /> : <Headphones size={24} />}
                </button>
                <button className={`control-btn ${!isVideoEnabled ? 'danger' : ''}`} onClick={toggleVideo} title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}>
                    {isVideoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
                </button>
                <button className={`control-btn ${isScreenSharing ? 'active' : ''}`} onClick={toggleScreenShare} title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}>
                    <MonitorUp size={24} />
                </button>
                <button className="control-btn danger" onClick={() => {
                    endAllCalls();
                }} title="End Call">
                    <PhoneOff size={24} />
                </button>
            </div>
        </div>
    );
};

