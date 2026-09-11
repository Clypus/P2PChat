import { escapeHtml } from './sanitize';

// Chat markdown renderer.
//
// The previous implementation ran every rule over one string in sequence, so
// later rules chewed on the output of earlier ones: the @mention rule mangled
// "https://x.com/@someone", and the link rule re-linked hrefs it had just
// written. Anything that produces final HTML is parked in a placeholder slot
// here and spliced back at the very end, so inline styling and mentions only
// ever see plain text.
//
// The placeholder is "<%N%>". Escaping runs first, which turns every user "<"
// into "&lt;", so a placeholder can only ever come from this file.

const SLOT_RE = /<%(\d+)%>/g;

const IMAGE_URL = /\.(gif|gifv|png|jpe?g|webp|avif|bmp)(\?[^\s<"]*)?$/i;

// Hosts that serve GIFs from paths without a file extension.
const GIF_HOST = /^https:\/\/(?:media\d*\.tenor\.com|c\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com)\//i;

const isImageUrl = (url: string) => IMAGE_URL.test(url) || GIF_HOST.test(url);

export const isGifUrl = (url: string) =>
    /\.gifv?(\?[^\s<"]*)?$/i.test(url) || GIF_HOST.test(url);

export function parseMarkdown(text: string): string {
    if (!text) return '';

    const slots: string[] = [];
    const hold = (html: string) => {
        slots.push(html);
        return '<%' + (slots.length - 1) + '%>';
    };

    let out = escapeHtml(text);

    // --- block + inline code (held first so markup inside stays literal) ---
    out = out.replace(/```([\s\S]*?)```/g, (_m, code) =>
        hold('<pre><code>' + String(code).replace(/^\n/, '') + '</code></pre>'));
    out = out.replace(/`([^`\n]+)`/g, (_m, code) =>
        hold('<code class="inline-code">' + code + '</code>'));

    // --- YouTube embeds ---
    out = out.replace(
        /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})(?:[^\s<]*)/g,
        (_m, id) => hold(
            '<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/' + id +
            '" frameborder="0" allowfullscreen></iframe></div>')
    );

    // --- direct image / GIF links render inline instead of as bare URLs ---
    out = out.replace(/https?:\/\/[^\s<"]+/g, (url) => {
        // Only https media is embedded; http would downgrade the page silently.
        if (!isImageUrl(url) || !/^https:\/\//i.test(url)) return url;
        const cls = isGifUrl(url) ? 'chat-embed-gif' : 'chat-embed-image';
        return hold('<img class="' + cls + '" src="' + url + '" alt="" />');
    });

    // --- remaining links become anchors ---
    out = out.replace(/https?:\/\/[^\s<"]+/g, (url) => {
        // Trailing sentence punctuation is almost never part of the URL.
        const trailing = url.match(/[.,!?;:)\]]+$/);
        const tail = trailing ? trailing[0] : '';
        const href = tail ? url.slice(0, url.length - tail.length) : url;
        if (!href) return url;
        return hold('<a href="' + href + '" target="_blank" rel="noreferrer noopener" class="message-link">' + href + '</a>') + tail;
    });

    // --- inline styling (longest markers first so they win) ---
    out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_\n]+)__/g, '<u>$1</u>');
    out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    out = out.replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    out = out.replace(/(?<![_\w])_([^_\n]+)_(?!_)/g, '<em>$1</em>');

    // --- spoilers: hidden until clicked ---
    out = out.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');

    // --- mentions ---
    out = out.replace(/@(everyone|here)\b/g, '<span class="mention mention-special">@$1</span>');
    out = out.replace(/@(\w[\w-]*)/g, '<span class="mention">@$1</span>');

    out = out.replace(/\n/g, '<br>');

    // --- splice the held HTML back in ---
    return out.replace(SLOT_RE, (_m, i) => slots[Number(i)] ?? '');
}
