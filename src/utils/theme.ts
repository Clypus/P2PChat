// Theme handling.
//
// Built-in themes are plain `[data-theme="..."]` rules in index.css. A custom
// theme is the same variable set written inline on <html>, which wins over the
// stylesheet rule without needing a generated <style> block.

export type CustomTheme = {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    bgHover: string;
    bgActive: string;
    bgFloating: string;
    textNormal: string;
    textMuted: string;
    textHeader: string;
    accent: string;
    success: string;
    danger: string;
    warning: string;
};

export const THEME_KEY = 'p2p_chat_theme';
export const CUSTOM_THEME_KEY = 'p2p_chat_custom_theme';
export const CUSTOM_THEME_ID = 'custom';

export const CUSTOM_THEME_FIELDS: { key: keyof CustomTheme; label: string; hint: string }[] = [
    { key: 'bgPrimary', label: 'Chat background', hint: 'Main message area' },
    { key: 'bgSecondary', label: 'Sidebar', hint: 'Channel and DM list' },
    { key: 'bgTertiary', label: 'Rail / inputs', hint: 'Server rail and input fields' },
    { key: 'bgHover', label: 'Hover', hint: 'Row highlight on hover' },
    { key: 'bgActive', label: 'Active', hint: 'Selected row' },
    { key: 'bgFloating', label: 'Popovers', hint: 'Menus, modals, tooltips' },
    { key: 'textNormal', label: 'Body text', hint: 'Message text' },
    { key: 'textMuted', label: 'Muted text', hint: 'Timestamps and labels' },
    { key: 'textHeader', label: 'Headings', hint: 'Names and titles' },
    { key: 'accent', label: 'Accent', hint: 'Buttons, links, mentions' },
    { key: 'success', label: 'Success', hint: 'Online dots, connected state' },
    { key: 'danger', label: 'Danger', hint: 'Errors, mute, hang up' },
    { key: 'warning', label: 'Warning', hint: 'Idle status, cautions' },
];

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
    bgPrimary: '#313338',
    bgSecondary: '#2b2d31',
    bgTertiary: '#1e1f22',
    bgHover: '#35373c',
    bgActive: '#3f4147',
    bgFloating: '#111214',
    textNormal: '#dbdee1',
    textMuted: '#949ba4',
    textHeader: '#f2f3f5',
    accent: '#5865f2',
    success: '#23a55a',
    danger: '#f23f43',
    warning: '#f0b232',
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const toRgb = (hex: string): [number, number, number] => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

// Positive percent lightens, negative darkens. Used to derive hover and active
// shades so the user only has to pick one accent colour.
const shade = (hex: string, percent: number): string => {
    const [r, g, b] = toRgb(hex);
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    return '#' + [r, g, b]
        .map(c => clamp((t - c) * p + c).toString(16).padStart(2, '0'))
        .join('');
};

const rgba = (hex: string, alpha: number): string => {
    const [r, g, b] = toRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Perceived brightness, so derived shades move the right direction on a light
// theme as well as a dark one.
const isLight = (hex: string): boolean => {
    const [r, g, b] = toRgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140;
};

export const sanitizeCustomTheme = (input: unknown): CustomTheme => {
    const base = { ...DEFAULT_CUSTOM_THEME };
    if (!input || typeof input !== 'object') return base;
    const raw = input as Record<string, unknown>;
    (Object.keys(base) as (keyof CustomTheme)[]).forEach(key => {
        const v = raw[key];
        if (typeof v === 'string' && HEX.test(v)) base[key] = v;
    });
    return base;
};

export const readCustomTheme = (): CustomTheme => {
    try {
        return sanitizeCustomTheme(JSON.parse(localStorage.getItem(CUSTOM_THEME_KEY) || 'null'));
    } catch {
        return { ...DEFAULT_CUSTOM_THEME };
    }
};

export const saveCustomTheme = (theme: CustomTheme) => {
    try { localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(sanitizeCustomTheme(theme))); } catch { /* quota */ }
};

// Variables written inline when the custom theme is active. The --discord-*
// aliases in index.css point at these, so nothing else needs to change.
const buildVars = (t: CustomTheme): Record<string, string> => {
    const light = isLight(t.bgPrimary);
    return {
        '--bg-primary': t.bgPrimary,
        '--bg-secondary': t.bgSecondary,
        '--bg-tertiary': t.bgTertiary,
        '--bg-hover': t.bgHover,
        '--bg-active': t.bgActive,
        '--bg-floating': t.bgFloating,
        '--bg-message-hover': light ? 'rgba(4, 4, 5, 0.04)' : 'rgba(255, 255, 255, 0.03)',
        '--text-normal': t.textNormal,
        '--text-muted': t.textMuted,
        '--text-header': t.textHeader,
        '--accent': t.accent,
        '--accent-hover': shade(t.accent, light ? 12 : -12),
        '--accent-active': shade(t.accent, light ? 22 : -24),
        '--accent-glow': rgba(t.accent, 0.3),
        '--success': t.success,
        '--danger': t.danger,
        '--warning': t.warning,
        '--border-subtle': light ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.06)',
        '--glass-bg': rgba(t.bgFloating, 0.8),
        '--glass-border': light ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)',
    };
};

const VAR_NAMES = Object.keys(buildVars(DEFAULT_CUSTOM_THEME));

export const applyTheme = (themeId: string, custom?: CustomTheme) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', themeId);
    if (themeId === CUSTOM_THEME_ID) {
        const vars = buildVars(custom || readCustomTheme());
        Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
    } else {
        VAR_NAMES.forEach(name => root.style.removeProperty(name));
    }
};

// Called once at startup, before React mounts, so there is no flash of the
// default palette.
export const applyStoredTheme = () => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
};
