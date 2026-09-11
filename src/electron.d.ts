export interface LinkPreview {
    url: string;
    siteName: string;
    title: string;
    description: string;
    image: string;
}

export type UpdaterState =
    | { state: 'dev' }
    | { state: 'checking' }
    | { state: 'none' }
    | { state: 'available'; version?: string }
    | { state: 'downloading'; percent?: number }
    | { state: 'ready'; version?: string }
    | { state: 'error'; message?: string };

export interface ElectronAPI {
    getDesktopSources: () => Promise<{ id: string; name: string; thumbnail?: string }[]>;
    openExternal: (url: string) => Promise<boolean>;
    fetchLinkPreview: (url: string) => Promise<LinkPreview | null>;
    getAppVersion: () => Promise<string>;
    setBadgeCount: (count: number) => Promise<boolean>;
    minimizeToTray: () => Promise<boolean>;
    setCloseToTray: (enabled: boolean) => Promise<boolean>;
    shortcuts: {
        setGlobal: (binds: Record<string, string>) => Promise<{ failed: string[] }>;
        onFired: (handler: (action: string) => void) => () => void;
    };
    platform: NodeJS.Platform | string;
    window: {
        minimize: () => Promise<boolean>;
        toggleMaximize: () => Promise<boolean>;
        isMaximized: () => Promise<boolean>;
        close: () => Promise<boolean>;
        onMaximizeChange: (handler: (maximized: boolean) => void) => () => void;
    };
    updater: {
        check: () => Promise<UpdaterState>;
        download: () => Promise<boolean>;
        install: () => Promise<boolean>;
        onStatus: (handler: (payload: UpdaterState) => void) => () => void;
    };
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
        process?: { type?: string };
        require?: (module: string) => any;
    }
}
