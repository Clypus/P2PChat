// Render-time HTML sanitizer for chat messages.
// Messages travel over the wire as pre-rendered HTML (parseMarkdown output),
// so every string that reaches dangerouslySetInnerHTML must pass through here —
// both locally composed and remotely received content.

const ALLOWED_CLASSES = new Set([
    'mention', 'mention-special', 'inline-code', 'message-link', 'youtube-embed',
    'chat-embed-image', 'chat-embed-gif',
    // Applied by the reveal handler in ChatArea, so it has to survive a
    // re-sanitise of already-rendered content.
    'spoiler', 'revealed',
]);

// Remote media is fetched by URL, so only https (plus locally created blob/data
// URLs) may load. http:// would silently downgrade and leak the request.
const isSafeMediaSrc = (src: string) => /^(https:\/\/|blob:|data:image\/)/i.test(src);

const TAG_RULES: Record<string, (el: Element) => boolean> = {
    STRONG: () => true,
    EM: () => true,
    B: () => true,
    I: () => true,
    U: () => true,
    S: () => true,
    CODE: () => true,
    PRE: () => true,
    BR: () => true,
    SPAN: () => true,
    DIV: () => true,
    A: (el) => /^https?:\/\//i.test(el.getAttribute('href') || ''),
    IMG: (el) => isSafeMediaSrc(el.getAttribute('src') || ''),
    IFRAME: (el) => /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/[a-zA-Z0-9_-]{11}/.test(el.getAttribute('src') || ''),
};

const scrubAttributes = (el: Element) => {
    const tag = el.tagName;
    [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        let keep = false;
        if (name === 'class') {
            const classes = attr.value.split(/\s+/).filter(c => ALLOWED_CLASSES.has(c));
            if (classes.length) {
                el.setAttribute('class', classes.join(' '));
                keep = true;
            }
        } else if (tag === 'A' && name === 'href') {
            keep = true;
        } else if (tag === 'IMG' && (name === 'src' || name === 'alt')) {
            keep = true;
        } else if (tag === 'IFRAME' && (name === 'src' || name === 'allowfullscreen' || name === 'frameborder')) {
            keep = true;
        }
        if (!keep) el.removeAttribute(attr.name);
    });
    if (tag === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noreferrer noopener');
    }
    if (tag === 'IMG') {
        // Lazy so a long backlog of GIFs does not stall the message list, and
        // referrer-free so remote hosts learn nothing about the viewer.
        el.setAttribute('loading', 'lazy');
        el.setAttribute('referrerpolicy', 'no-referrer');
        el.setAttribute('decoding', 'async');
    }
};

const sanitizeNode = (node: Node) => {
    [...node.childNodes].forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) return;
        if (child.nodeType !== Node.ELEMENT_NODE) {
            node.removeChild(child);
            return;
        }
        const el = child as Element;
        const rule = TAG_RULES[el.tagName];
        if (!rule || !rule(el)) {
            node.replaceChild(document.createTextNode(el.textContent || ''), el);
            return;
        }
        scrubAttributes(el);
        sanitizeNode(el);
    });
};

const cache = new Map<string, string>();

export function sanitizeMessageHtml(html: string): string {
    if (!html) return '';
    const hit = cache.get(html);
    if (hit !== undefined) return hit;
    let out: string;
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        sanitizeNode(doc.body);
        out = doc.body.innerHTML;
    } catch {
        out = html.replace(/[<>]/g, '');
    }
    if (cache.size > 2000) cache.clear();
    cache.set(html, out);
    return out;
}

export function stripHtml(html: string): string {
    if (!html) return '';
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return doc.body.textContent || '';
    } catch {
        return html.replace(/<[^>]*>/g, '');
    }
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Pull every http(s) link out of already-rendered message HTML. Used to decide
// which URL, if any, deserves a preview card under the message.
export function extractLinks(html: string): string[] {
    if (!html) return [];
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return [...doc.querySelectorAll('a[href]')]
            .map(a => a.getAttribute('href') || '')
            .filter(href => /^https?:\/\//i.test(href));
    } catch {
        return [];
    }
}
