import React, { useEffect, useState } from 'react';
import './TitleBar.css';

// Discord-style custom window chrome. The native title bar is hidden in
// main.js, so this row is what the user drags, and it owns the window buttons.
// It renders only in the desktop build; in a browser there is no window to
// control and the whole component disappears.

const Glyph: React.FC<{ d: string }> = ({ d }) => (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d={d} stroke="currentColor" strokeWidth="1" fill="none" shapeRendering="crispEdges" />
    </svg>
);

const MINIMIZE = 'M0,5.5 h10';
const MAXIMIZE = 'M0.5,0.5 h9 v9 h-9 z';
const RESTORE = 'M2.5,2.5 h7 v7 h-7 z M0.5,7.5 v-7 h7';
const CLOSE = 'M0,0 l10,10 M10,0 l-10,10';

export const TitleBar: React.FC = () => {
    const api = window.electronAPI;
    const [maximized, setMaximized] = useState(false);
    const isMac = api?.platform === 'darwin';

    useEffect(() => {
        if (!api?.window) return;
        api.window.isMaximized().then(setMaximized).catch(() => { });
        return api.window.onMaximizeChange(setMaximized);
    }, [api]);

    // Mark the document so the layout can reserve the strip. Done here rather
    // than at startup so the browser build keeps its full-height layout.
    useEffect(() => {
        if (!api?.window) return;
        document.documentElement.classList.add('has-titlebar');
        if (isMac) document.documentElement.classList.add('mac-titlebar');
        return () => {
            document.documentElement.classList.remove('has-titlebar');
            document.documentElement.classList.remove('mac-titlebar');
        };
    }, [api, isMac]);

    if (!api?.window) return null;

    return (
        <div
            className="titlebar"
            onDoubleClick={() => api.window.toggleMaximize()}
        >
            <div className="titlebar-brand">
                <img src="./icon.png" alt="" className="titlebar-icon" />
                <span className="titlebar-title">P2P Chat</span>
            </div>

            <div className="titlebar-drag" />

            {/* macOS keeps its own traffic lights, so only Windows and Linux
                need buttons drawn here. */}
            {!isMac && (
                <div className="titlebar-controls">
                    <button className="titlebar-btn" title="Minimize" onClick={() => api.window.minimize()}>
                        <Glyph d={MINIMIZE} />
                    </button>
                    <button
                        className="titlebar-btn"
                        title={maximized ? 'Restore' : 'Maximize'}
                        onClick={() => api.window.toggleMaximize()}
                    >
                        <Glyph d={maximized ? RESTORE : MAXIMIZE} />
                    </button>
                    <button className="titlebar-btn close" title="Close" onClick={() => api.window.close()}>
                        <Glyph d={CLOSE} />
                    </button>
                </div>
            )}
        </div>
    );
};
