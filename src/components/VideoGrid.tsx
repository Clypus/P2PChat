import React, { useEffect, useRef, useState } from 'react';
import { usePeer } from '../context/PeerContext';
import { Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, PhoneOff, Headphones, Maximize, Volume2 } from 'lucide-react';
import './VideoGrid.css';

interface StreamItem {
    id: string;
    stream: MediaStream;
    isLocal: boolean;
    label: string;
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
}> = ({ stream, label, muted, peerId, isLocal, voiceState, onClick, volume = 100, onVolumeChange }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const isSpeaking = useAudioActivity(stream);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

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
            <video ref={videoRef} autoPlay muted={muted} playsInline className="grid-video" />
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

export const RemoteAudioPlayback: React.FC<{ streams: Record<string, MediaStream>; isDeafened?: boolean; peerVolumes?: Record<string, number> }> = ({ streams, isDeafened = false, peerVolumes = {} }) => {
    const audioRefs = useRef<Record<string, { audio: HTMLAudioElement; ctx: AudioContext; gain: GainNode; source: MediaStreamAudioSourceNode }>>({});

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
                const vol = peerVolumes[peerId] ?? 100;
                gain.gain.value = vol / 100; // 0-2.0

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

    // Apply deafen
    useEffect(() => {
        Object.values(audioRefs.current).forEach(entry => {
            entry.gain.gain.value = isDeafened ? 0 : (peerVolumes[entry.audio.id] ?? 100) / 100;
        });
    }, [isDeafened]);

    // Apply per-peer volume via GainNode (supports 0-200%)
    useEffect(() => {
        Object.entries(audioRefs.current).forEach(([peerId, entry]) => {
            if (!isDeafened) {
                const vol = peerVolumes[peerId] ?? 100;
                entry.gain.gain.value = vol / 100; // 0.0 to 2.0
            }
        });
    }, [peerVolumes, isDeafened]);

    return null;
};

export const VideoGrid: React.FC = () => {
    const { localStream, remoteStreams, peerId, displayName, peerNames, endCall, endAllCalls, toggleMute, toggleDeafen, toggleVideo, toggleScreenShare, isMuted, isDeafened, peerVoiceStates, isVideoEnabled, isScreenSharing, peerVolumes, setPeerVolume } = usePeer();
    const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);

    const allStreams: StreamItem[] = [];
    if (localStream) {
        allStreams.push({ id: 'local', stream: localStream, isLocal: true, label: `${displayName || 'You'} (You)` });
    }

    Object.entries(remoteStreams).forEach(([id, stream]) => {
        const name = peerNames[id] || `Peer ${id.substring(0, 6)}`;
        allStreams.push({ id, stream, isLocal: false, label: name });
    });

    if (allStreams.length === 0) return null;

    return (
        <div className="video-overlay">
            { }
            <div className={`video-grid count-${Math.min(allStreams.length, 6)}`}>
                {allStreams.map(item => (
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
                    />
                ))}
            </div>

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

const VideoPlayer: React.FC<{ stream: MediaStream, muted: boolean, label: string, className?: string }> = ({ stream, muted, label, className }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div className={`video-feed-container ${className || ''}`}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted}
                className="video-element"
            />
            <div className="video-label">{label}</div>
        </div>
    );
};
