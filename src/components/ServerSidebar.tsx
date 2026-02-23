import React, { useState } from 'react';
import { Compass, Plus, Download } from 'lucide-react';
import { usePeer } from '../context/PeerContext';
import { ServerActionModal } from './ServerActionModal';
import './ServerSidebar.css';

interface ServerSidebarProps {
    closeMobileMenu?: () => void;
}

export const ServerSidebar: React.FC<ServerSidebarProps> = ({ closeMobileMenu }) => {
    const { joinedServers, activeServer, switchServer } = usePeer();
    const [showModal, setShowModal] = useState(false);

    return (
        <nav className="server-sidebar">
            <div
                className={`server-icon home tooltip-wrap ${activeServer === null ? 'active' : ''}`}
                onClick={() => {
                    switchServer(null);
                    if (closeMobileMenu) closeMobileMenu();
                }}
            >
                <svg width="28" height="20" viewBox="0 0 28 20" fill="currentColor">
                    <path d="M23.0212 1.67671C21.3107 0.88091 19.5079 0.31849 17.6584 0C17.4062 0.461936 17.1749 0.932857 16.971 1.4184C15.003 1.12145 12.997 1.12145 11.0289 1.4184C10.819 0.932857 10.5877 0.461936 10.3355 0C8.48003 0.31849 6.67724 0.88091 4.96677 1.67671C1.56727 6.77884 0.649666 11.7583 1.11108 16.652C3.10102 18.1418 5.3262 19.2743 7.69177 20C8.22338 19.2743 8.69519 18.4984 9.09812 17.6918C8.32996 17.3997 7.58522 17.043 6.87684 16.6135C7.06531 16.4764 7.24726 16.3384 7.424 16.1843C11.5911 18.1749 16.408 18.1749 20.5751 16.1843C20.7468 16.3384 20.9338 16.4764 21.1172 16.6135C20.4038 17.043 19.654 17.3997 18.8859 17.6918C19.2888 18.4984 19.7606 19.2743 20.2922 20C22.6578 19.2743 24.883 18.1418 26.8729 16.652C27.4353 10.8732 25.9665 5.93721 23.0212 1.67671ZM9.68041 13.6382C8.39754 13.6382 7.34005 12.445 7.34005 10.9993C7.34005 9.5534 8.37682 8.36021 9.68041 8.36021C10.984 8.36021 12.0415 9.5534 12.0208 10.9993C12.0208 12.445 10.984 13.6382 9.68041 13.6382ZM18.3161 13.6382C17.0332 13.6382 15.9757 12.445 15.9757 10.9993C15.9757 9.5534 17.0125 8.36021 18.3161 8.36021C19.6197 8.36021 20.6772 9.5534 20.6565 10.9993C20.6565 12.445 19.6197 13.6382 18.3161 13.6382Z" />
                </svg>
                <span className="tooltip">Direct Messages</span>
            </div>

            <div className="server-separator"></div>

            {joinedServers.map(server => (
                <div
                    key={server.id}
                    className={`server-icon tooltip-wrap ${activeServer?.id === server.id ? 'active' : ''}`}
                    onClick={() => {
                        switchServer(server.id);
                        if (closeMobileMenu) closeMobileMenu();
                    }}
                >
                    <span className="server-initial">{server.name.substring(0, 1).toUpperCase()}</span>
                    <span className="tooltip">{server.name}</span>
                </div>
            ))}

            <div className="server-icon add-server tooltip-wrap" onClick={() => { if (closeMobileMenu) closeMobileMenu(); setShowModal(true); }}>
                <Plus size={24} />
                <span className="tooltip">Add a Server</span>
            </div>

            <div className="server-icon explore tooltip-wrap">
                <Compass size={24} />
                <span className="tooltip">Explore Discoverable Servers</span>
            </div>

            <div className="server-separator"></div>

            <div className="server-icon download tooltip-wrap">
                <Download size={24} />
                <span className="tooltip">Download Apps</span>
            </div>

            {showModal && <ServerActionModal onClose={() => setShowModal(false)} />}
        </nav>
    );
};
