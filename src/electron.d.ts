// Type declarations for Electron globals used in screen sharing
interface Window {
    process?: { type?: string };
    require?: (module: string) => any;
}
