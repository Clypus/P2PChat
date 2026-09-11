// Notification sounds, synthesised at play time with the Web Audio API so the
// app ships no audio files.
//
// The first version was a handful of bare sine oscillators, which read as thin
// and beepy. These are built from struck-bell partials, pitch-swept blips and a
// short feedback-delay space, wrapped in proper attack/decay envelopes.

export type NotificationPrefs = {
    messageSounds: boolean;
    callSounds: boolean;
    joinLeaveSounds: boolean;
    desktopNotifications: boolean;
};

export type SoundPackId = 'chime' | 'bubble' | 'retro';
export type SoundEvent = 'message' | 'ring' | 'connect' | 'disconnect' | 'join' | 'leave';

const PREFS_KEY = 'p2p_chat_notification_prefs';
const PACK_KEY = 'p2p_chat_sound_pack';

const PREFS_DEFAULTS: NotificationPrefs = {
    messageSounds: true,
    callSounds: true,
    joinLeaveSounds: true,
    desktopNotifications: true,
};

export const SOUND_PACKS: { id: SoundPackId; label: string; description: string }[] = [
    { id: 'chime', label: 'Chime', description: 'Glassy struck bells with a little air around them.' },
    { id: 'bubble', label: 'Bubble', description: 'Soft rounded pops, low and unobtrusive.' },
    { id: 'retro', label: 'Retro', description: 'Square-wave arcade blips.' },
];

let cachedPrefs: NotificationPrefs | null = null;

export function getNotificationPrefs(): NotificationPrefs {
    if (cachedPrefs) return cachedPrefs;
    try {
        cachedPrefs = { ...PREFS_DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
    } catch {
        cachedPrefs = { ...PREFS_DEFAULTS };
    }
    return cachedPrefs;
}

export function updateNotificationPrefs(partial: Partial<NotificationPrefs>): NotificationPrefs {
    cachedPrefs = { ...getNotificationPrefs(), ...partial };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(cachedPrefs)); } catch { /* non-fatal */ }
    return cachedPrefs;
}

let cachedPack: SoundPackId | null = null;

export function getSoundPack(): SoundPackId {
    if (cachedPack) return cachedPack;
    const saved = localStorage.getItem(PACK_KEY) as SoundPackId | null;
    cachedPack = saved && SOUND_PACKS.some(p => p.id === saved) ? saved : 'chime';
    return cachedPack;
}

export function setSoundPack(pack: SoundPackId) {
    cachedPack = pack;
    try { localStorage.setItem(PACK_KEY, pack); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------- audio graph

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let spaceIn: GainNode | null = null;

// A cheap two-tap feedback delay. Real convolution reverb would mean shipping an
// impulse response; this is enough to stop the sounds feeling bone dry.
const buildSpace = (ctx: AudioContext, destination: AudioNode) => {
    const input = ctx.createGain();
    input.gain.value = 1;

    const wet = ctx.createGain();
    wet.gain.value = 0.22;

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;

    [0.045, 0.083].forEach((time, i) => {
        const delay = ctx.createDelay(0.5);
        delay.delayTime.value = time;
        const fb = ctx.createGain();
        fb.gain.value = 0.28 - i * 0.08;
        input.connect(delay);
        delay.connect(fb);
        fb.connect(delay);
        delay.connect(tone);
    });

    tone.connect(wet);
    wet.connect(destination);
    return input;
};

function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.9;
        masterGain.connect(audioCtx.destination);
        spaceIn = buildSpace(audioCtx, masterGain);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => { });
    }
    return audioCtx;
}

type VoiceOpts = {
    type?: OscillatorType;
    freq: number;
    /** Ramp to this frequency across the note, for swept blips. */
    glideTo?: number;
    at: number;
    dur: number;
    gain: number;
    /** Attack in seconds. Very short reads as a strike, longer as a swell. */
    attack?: number;
    /** Extra low-pass on this voice only. */
    cutoff?: number;
    /** How much of this voice feeds the space. */
    send?: number;
    detune?: number;
};

const voice = (ctx: AudioContext, o: VoiceOpts) => {
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, o.at);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), o.at + o.dur * 0.9);
    if (o.detune) osc.detune.setValueAtTime(o.detune, o.at);

    const env = ctx.createGain();
    const attack = o.attack ?? 0.004;
    env.gain.setValueAtTime(0.0001, o.at);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);

    let node: AudioNode = env;
    osc.connect(env);
    if (o.cutoff) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(o.cutoff, o.at);
        env.connect(lp);
        node = lp;
    }

    node.connect(masterGain!);
    if (o.send && spaceIn) {
        const sendGain = ctx.createGain();
        sendGain.gain.value = o.send;
        node.connect(sendGain);
        sendGain.connect(spaceIn);
    }

    osc.start(o.at);
    osc.stop(o.at + o.dur + 0.02);
};

// Tubular-bell partial ratios. Stacking these over a fundamental is what makes a
// sine sound struck rather than beeped.
const BELL_PARTIALS: [number, number][] = [[1, 1], [2.76, 0.42], [5.4, 0.18], [8.93, 0.08]];

const bell = (ctx: AudioContext, freq: number, at: number, gain: number, dur = 0.9) => {
    BELL_PARTIALS.forEach(([ratio, amp]) => {
        voice(ctx, {
            freq: freq * ratio,
            at,
            dur: dur * (1 - Math.min(0.55, (ratio - 1) * 0.09)),
            gain: gain * amp,
            attack: 0.003,
            cutoff: 9000,
            send: 0.5 * amp,
        });
    });
};

// A tiny filtered-noise transient. Sells the "something was struck" impression.
const mallet = (ctx: AudioContext, at: number, gain = 0.12) => {
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(bp); bp.connect(g); g.connect(masterGain!);
    src.start(at);
};

// ---------------------------------------------------------------- the packs

type PackDef = Record<SoundEvent, (ctx: AudioContext, t: number) => void>;

const PACKS: Record<SoundPackId, PackDef> = {
    chime: {
        // Two struck bells a fourth apart. Short, bright, unmistakable.
        message: (ctx, t) => {
            mallet(ctx, t, 0.1);
            bell(ctx, 1174.66, t, 0.2, 0.85);
            bell(ctx, 1567.98, t + 0.075, 0.16, 1.0);
        },
        ring: (ctx, t) => {
            for (let i = 0; i < 2; i++) {
                const at = t + i * 0.34;
                mallet(ctx, at, 0.07);
                bell(ctx, 783.99, at, 0.17, 0.5);
                bell(ctx, 1046.5, at + 0.055, 0.13, 0.55);
            }
        },
        connect: (ctx, t) => {
            [523.25, 659.25, 783.99].forEach((f, i) => bell(ctx, f, t + i * 0.065, 0.16, 0.7));
        },
        disconnect: (ctx, t) => {
            [783.99, 587.33, 440].forEach((f, i) => bell(ctx, f, t + i * 0.075, 0.15, 0.7));
        },
        join: (ctx, t) => {
            bell(ctx, 880, t, 0.13, 0.45);
            bell(ctx, 1318.51, t + 0.05, 0.1, 0.5);
        },
        leave: (ctx, t) => {
            bell(ctx, 1318.51, t, 0.12, 0.45);
            bell(ctx, 880, t + 0.05, 0.1, 0.5);
        },
    },

    bubble: {
        // Rounded sine pops with an upward pitch sweep, like a droplet.
        message: (ctx, t) => {
            voice(ctx, { freq: 420, glideTo: 940, at: t, dur: 0.15, gain: 0.28, attack: 0.012, cutoff: 2600, send: 0.3 });
            voice(ctx, { freq: 630, glideTo: 1320, at: t + 0.055, dur: 0.16, gain: 0.16, attack: 0.01, cutoff: 3200, send: 0.3 });
        },
        ring: (ctx, t) => {
            for (let i = 0; i < 2; i++) {
                const at = t + i * 0.3;
                voice(ctx, { freq: 360, glideTo: 700, at, dur: 0.2, gain: 0.24, attack: 0.015, cutoff: 2200, send: 0.25 });
            }
        },
        connect: (ctx, t) => {
            voice(ctx, { freq: 300, glideTo: 820, at: t, dur: 0.26, gain: 0.26, attack: 0.02, cutoff: 2600, send: 0.3 });
        },
        disconnect: (ctx, t) => {
            voice(ctx, { freq: 760, glideTo: 240, at: t, dur: 0.3, gain: 0.24, attack: 0.02, cutoff: 2200, send: 0.3 });
        },
        join: (ctx, t) => {
            voice(ctx, { freq: 480, glideTo: 780, at: t, dur: 0.14, gain: 0.2, attack: 0.012, cutoff: 2400, send: 0.25 });
        },
        leave: (ctx, t) => {
            voice(ctx, { freq: 700, glideTo: 420, at: t, dur: 0.16, gain: 0.2, attack: 0.012, cutoff: 2200, send: 0.25 });
        },
    },

    retro: {
        // Square waves, no space send, deliberately dry and chiptune-ish.
        message: (ctx, t) => {
            voice(ctx, { type: 'square', freq: 988, at: t, dur: 0.07, gain: 0.1, cutoff: 4000 });
            voice(ctx, { type: 'square', freq: 1319, at: t + 0.07, dur: 0.11, gain: 0.09, cutoff: 4000 });
        },
        ring: (ctx, t) => {
            for (let i = 0; i < 3; i++) {
                voice(ctx, { type: 'square', freq: i % 2 ? 784 : 1046, at: t + i * 0.11, dur: 0.09, gain: 0.09, cutoff: 3600 });
            }
        },
        connect: (ctx, t) => {
            [523, 659, 784, 1046].forEach((f, i) =>
                voice(ctx, { type: 'square', freq: f, at: t + i * 0.05, dur: 0.06, gain: 0.085, cutoff: 4000 }));
        },
        disconnect: (ctx, t) => {
            [1046, 784, 523].forEach((f, i) =>
                voice(ctx, { type: 'square', freq: f, at: t + i * 0.06, dur: 0.08, gain: 0.085, cutoff: 3600 }));
        },
        join: (ctx, t) => {
            voice(ctx, { type: 'square', freq: 660, at: t, dur: 0.05, gain: 0.08, cutoff: 3600 });
            voice(ctx, { type: 'square', freq: 990, at: t + 0.05, dur: 0.07, gain: 0.07, cutoff: 3600 });
        },
        leave: (ctx, t) => {
            voice(ctx, { type: 'square', freq: 990, at: t, dur: 0.05, gain: 0.08, cutoff: 3600 });
            voice(ctx, { type: 'square', freq: 660, at: t + 0.05, dur: 0.07, gain: 0.07, cutoff: 3600 });
        },
    },
};

const emit = (event: SoundEvent, pack?: SoundPackId) => {
    try {
        const ctx = getAudioContext();
        PACKS[pack || getSoundPack()][event](ctx, ctx.currentTime + 0.01);
    } catch (e) {
        console.warn(`[Sound] ${event} failed:`, e);
    }
};

/** Play one event from a specific pack, ignoring preference switches. */
export function previewSound(event: SoundEvent, pack?: SoundPackId) {
    emit(event, pack);
}

export function playMessageSound(force: boolean = false) {
    if (!force && !getNotificationPrefs().messageSounds) return;
    emit('message');
}

// ---------------------------------------------------------------- ringtone

let ringInterval: ReturnType<typeof setInterval> | null = null;
let ringTimeout: ReturnType<typeof setTimeout> | null = null;

export function startRingtone() {
    if (!getNotificationPrefs().callSounds) return;
    stopRingtone();
    emit('ring');
    ringInterval = setInterval(() => emit('ring'), 2400);
    // Give up after 30 seconds so a missed call does not ring forever.
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

export function playCallConnectSound() {
    if (!getNotificationPrefs().callSounds) return;
    emit('connect');
}

export function playCallDisconnectSound() {
    if (!getNotificationPrefs().callSounds) return;
    emit('disconnect');
}

export function playUserJoinSound() {
    if (!getNotificationPrefs().joinLeaveSounds) return;
    emit('join');
}

export function playUserLeaveSound() {
    if (!getNotificationPrefs().joinLeaveSounds) return;
    emit('leave');
}
