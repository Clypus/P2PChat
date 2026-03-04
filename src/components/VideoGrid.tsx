import React, { useEffect, useRef, useState } from 'react';
import { usePeer } from '../context/PeerContext';
import { Mic, MicOff, Video as VideoIcon, VideoOff, MonitorUp, PhoneOff, Headphones, Maximize } from 'lucide-react';
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
    voiceState?: { muted: boolean, deafened: boolean };
    onClick?: () => void;
}> = ({ stream, label, muted, voiceState, onClick }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const isSpeaking = useAudioActivity(stream);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    const handleFullscreen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!document.fullscreenElement) {
            videoRef.current?.requestFullscreen().catch(console.error);
        } else {
            document.exitFullscreen().catch(console.error);
        }
    };

    return (
        <div className={`video-card ${isSpeaking && !voiceState?.muted ? 'speaking' : ''}`} onClick={onClick} onDoubleClick={handleFullscreen}>
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
        </div>
    );
};

// Hidden audio playback for remote streams — ensures audio plays even without active video

export const RemoteAudioPlayback: React.FC<{ streams: Record<string, MediaStream>; isDeafened?: boolean }> = ({ streams, isDeafened = false }) => {
    const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

    useEffect(() => {
        
        Object.entries(streams).forEach(([peerId, stream]) => {
            if (!audioRefs.current[peerId]) {
                const audio = new Audio();
                audio.autoplay = true;
                (audio as any).playsInline = true;
                audio.srcObject = stream;
                audio.muted = isDeafened; 
                audioRefs.current[peerId] = audio;
                
                audio.play().catch(() => {
                    
                    const retryPlay = () => {
                        audio.play().catch(() => { });
                        document.removeEventListener('click', retryPlay);
                    };
                    document.addEventListener('click', retryPlay);
                });
            } else {
                
                if (audioRefs.current[peerId].srcObject !== stream) {
                    audioRefs.current[peerId].srcObject = stream;
                    audioRefs.current[peerId].play().catch(() => { });
                }
            }
        });

        Object.keys(audioRefs.current).forEach(peerId => {
            if (!streams[peerId]) {
                audioRefs.current[peerId].pause();
                audioRefs.current[peerId].srcObject = null;
                delete audioRefs.current[peerId];
            }
        });

        return () => {
            Object.values(audioRefs.current).forEach(audio => {
                audio.pause();
                audio.srcObject = null;
            });
            audioRefs.current = {};
        };
    }, [streams]);

    useEffect(() => {
        Object.values(audioRefs.current).forEach(audio => {
            audio.muted = isDeafened;
        });
    }, [isDeafened]);

    return null; 
};

export const VideoGrid: React.FC = () => {
    const { localStream, remoteStreams, peerId, displayName, peerNames, endCall, endAllCalls, toggleMute, toggleVideo, toggleScreenShare, isMuted, isDeafened, peerVoiceStates, isVideoEnabled, isScreenSharing } = usePeer();
    const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);

    const allStreams: StreamItem[] = [];
    if (localStream) {
        allStreams.push({ id: 'local', stream: localStream, isLocal: true, label: `${displayName} (You)` });
    }

    Object.entries(remoteStreams).forEach(([id, stream]) => {
        const name = peerNames[id] || `Peer ${id.substring(0, 6)}`;
        allStreams.push({ id, stream, isLocal: false, label: name });
    });

    if (allStreams.length === 0) return null;

    return (
        <div className="video-overlay">
            {}
            <div className={`video-grid count-${Math.min(allStreams.length, 6)}`}>
                {allStreams.map(item => (
                    <VideoCardBase
                        key={item.id}
                        stream={item.stream}
                        label={item.label}
                        muted={true}  
                        voiceState={item.isLocal ? { muted: isMuted, deafened: isDeafened } : peerVoiceStates[item.id]}
                    />
                ))}
            </div>

            {}
            <div className="media-controls">
                <button className={`control-btn ${isMuted ? 'danger' : ''}`} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
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
