import React from 'react';
import { usePeer } from '../context/PeerContext';
import { PhoneCall, PhoneOff, Video } from 'lucide-react';
import './IncomingCallModal.css';

export const IncomingCallModal: React.FC = () => {
    const { incomingCall, incomingCallIsVideo, answerCall, rejectCall, peerNames } = usePeer();

    if (!incomingCall) return null;

    const callerId = incomingCall.peer;
    const callerName = peerNames[callerId] || 'Friend';

    return (
        <div className="incoming-call-overlay">
            <div className="incoming-call-dialog">
                <div className="call-avatar">
                    {callerName.substring(0, 2).toUpperCase()}
                </div>
                <div className="call-info">
                    <h3>{callerName}</h3>
                    <p>{incomingCallIsVideo ? 'Incoming Video Call...' : 'Incoming Voice Call...'}</p>
                </div>
                <div className="call-actions">
                    <button className="btn-reject" onClick={rejectCall}>
                        <PhoneOff size={24} />
                        Decline
                    </button>
                    <button className="btn-accept" onClick={answerCall}>
                        {incomingCallIsVideo ? <Video size={24} /> : <PhoneCall size={24} />}
                        Accept
                    </button>
                </div>
            </div>
        </div>
    );
};
