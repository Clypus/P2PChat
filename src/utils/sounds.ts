// Sound effects generated via Web Audio API — no external files needed

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => { });
    }
    return audioCtx;
}

// Discord-like message notification ping
export function playMessageSound() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        // Two-tone ping (like Discord)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now); // A5
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1320, now); // E6

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now + 0.08);
        osc1.stop(now + 0.15);
        osc2.stop(now + 0.3);
    } catch (e) {
        console.warn('[Sound] Message sound failed:', e);
    }
}

// Incoming call ringtone — repeating ring
let ringInterval: ReturnType<typeof setInterval> | null = null;
let ringTimeout: ReturnType<typeof setTimeout> | null = null;

function playRingOnce() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        // Ring pattern: two short bursts
        for (let i = 0; i < 2; i++) {
            const offset = i * 0.25;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now + offset); // A4
            osc.frequency.setValueAtTime(520, now + offset + 0.05); // C5
            osc.frequency.setValueAtTime(440, now + offset + 0.1); // A4

            gain.gain.setValueAtTime(0, now + offset);
            gain.gain.linearRampToValueAtTime(0.2, now + offset + 0.02);
            gain.gain.setValueAtTime(0.2, now + offset + 0.12);
            gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.2);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.2);
        }
    } catch (e) {
        console.warn('[Sound] Ring sound failed:', e);
    }
}

export function startRingtone() {
    stopRingtone();
    playRingOnce();
    ringInterval = setInterval(playRingOnce, 2000); // Ring every 2 seconds
    // Auto-stop after 30 seconds
    ringTimeout = setTimeout(stopRingtone, 30000);
}

export function stopRingtone() {
    if (ringInterval) {
        clearInterval(ringInterval);
        ringInterval = null;
    }
    if (ringTimeout) {
        clearTimeout(ringTimeout);
        ringTimeout = null;
    }
}

// Call connected sound (short ascending tone)
export function playCallConnectSound() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.1);
        osc.frequency.linearRampToValueAtTime(800, now + 0.2);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
    } catch (e) {
        console.warn('[Sound] Connect sound failed:', e);
    }
}

// Call disconnected sound (short descending tone)
export function playCallDisconnectSound() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(300, now + 0.25);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
    } catch (e) {
        console.warn('[Sound] Disconnect sound failed:', e);
    }
}

// User join voice channel sound
export function playUserJoinSound() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, now); // C5
        osc.frequency.setValueAtTime(659, now + 0.08); // E5

        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
    } catch (e) {
        console.warn('[Sound] Join sound failed:', e);
    }
}

// User leave voice channel sound
export function playUserLeaveSound() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659, now); // E5
        osc.frequency.setValueAtTime(523, now + 0.08); // C5

        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
    } catch (e) {
        console.warn('[Sound] Leave sound failed:', e);
    }
}
