import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server injects inline module scripts for HMR and React Fast Refresh,
// so development genuinely needs 'unsafe-inline' and 'unsafe-eval'. The
// production bundle does not: it is one external script with no inline bodies,
// no eval and no new Function. Shipping the loose policy just because the meta
// tag is static would hand any future injection bug a working execution path,
// so the policy is swapped at build time instead.
const SHARED = [
    "default-src 'self'",
    // React sets inline style attributes throughout, which needs unsafe-inline.
    "style-src 'self' 'unsafe-inline'",
    "media-src 'self' blob: data:",
    // WebRTC itself is not covered here; this is the PeerJS signalling socket
    // and the optional Tenor GIF search.
    "connect-src 'self' ws: wss: https:",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    // frame-ancestors is deliberately absent: it is ignored when delivered in a
    // meta tag and only warns. The app is never framed anyway.
    "worker-src 'self' blob:",
]

const DEV_CSP = [
    ...SHARED,
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "img-src 'self' data: blob: https: http:",
].join('; ')

const PROD_CSP = [
    ...SHARED,
    "script-src 'self'",
    // Avatars, inline embeds and preview thumbnails are all restricted to https
    // or locally created data/blob URLs, so plain http can be refused outright.
    "img-src 'self' data: blob: https:",
].join('; ')

const cspPlugin = () => ({
    name: 'p2pchat-csp',
    transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
            const csp = ctx.server ? DEV_CSP : PROD_CSP
            return html.replace(
                /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,
                (_match, before, after) => before + csp + after,
            )
        },
    },
})

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
})
