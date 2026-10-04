"""Synthesised soundtrack for the Cassie 60-second reel (100 BPM, cuts on the bar): warm pad + plucked arpeggio + soft groove,
UI click sounds locked to the cursor, a riser into the title and a chime on the logo click.
Pure numpy — no samples, nothing to license."""
import wave
import numpy as np

SR = 44100
DUR = 60.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def hz(name):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    n = names[name[0]]
    o = int(name[-1])
    acc = name[1:-1]
    if acc == '#': n += 1
    if acc == 'b': n -= 1
    return 440.0 * 2 ** ((n + 12 * (o + 1) - 69) / 12)


def mix_into(buf, sig, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N or i + len(sig) <= 0:
        return
    s = sig
    if i < 0:
        s = sig[-i:]; i = 0
    e = min(N, i + len(s))
    s = s[: e - i]
    l = gain * (1 - max(0, pan)) ; r = gain * (1 + min(0, pan))
    buf[0, i:e] += s * l
    buf[1, i:e] += s * r


def lowpass(x, fc, order=2):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1.0 / np.sqrt(1 + (f / fc) ** (2 * order))
    return np.fft.irfft(X, len(x))


def highpass(x, fc, order=2):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1.0 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * H, len(x))


def env_adsr(n, a, r):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    rel = np.minimum(1, (n / SR - t) / max(r, 1e-4))
    return e * rel


# ---------------------------------------------------------------- voices
def pad_note(f, dur):
    n = int(SR * dur)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for det in (-0.0035, 0.0, 0.0035):
        ff = f * (1 + det)
        for h, a in enumerate([1, .5, .33, .22, .12, .08], start=1):
            s += a * np.sin(2 * np.pi * ff * h * t + rng.uniform(0, 6.28))
    return s / 9 * env_adsr(n, 0.9, 1.4)


def pluck(f, dur=1.4, bright=1.0):
    n = int(SR * dur)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for h in range(1, 9):
        s += (1 / h ** 1.1) * np.sin(2 * np.pi * f * h * t) * np.exp(-t * (2.2 + 3.4 * h / bright))
    s *= np.minimum(1, t / 0.003)
    return s * 0.55


def bass_note(f, dur):
    n = int(SR * dur)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t)
    return s * env_adsr(n, 0.02, 0.35) * 0.5


def kick():
    n = int(SR * 0.32)
    t = np.arange(n) / SR
    f = 46 + 90 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 11) * 0.9


def hat():
    n = int(SR * 0.07)
    t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 7000) * np.exp(-t * 70) * 0.35


def clap():
    n = int(SR * 0.22)
    t = np.arange(n) / SR
    x = highpass(lowpass(rng.standard_normal(n), 3800), 900)
    e = np.exp(-t * 26) + 0.7 * np.exp(-((t - 0.012) * 90) ** 2) + 0.5 * np.exp(-((t - 0.024) * 90) ** 2)
    return x * e * 0.5


def click(strong=True):
    n = int(SR * 0.06)
    t = np.arange(n) / SR
    noise = highpass(rng.standard_normal(n), 2500) * np.exp(-t * 380)
    tone = np.sin(2 * np.pi * (2100 if strong else 1500) * t) * np.exp(-t * 130)
    return (0.55 * noise + 0.5 * tone) * (1.0 if strong else 0.5)


def tick():
    n = int(SR * 0.025)
    t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 3500) * np.exp(-t * 300) * 0.5


def chime(base=880.0, dur=2.6):
    n = int(SR * dur)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for ratio, a in [(1, 1), (2.0, .45), (3.0, .22), (4.2, .12), (5.4, .06)]:
        s += a * np.sin(2 * np.pi * base * ratio * t) * np.exp(-t * (1.6 + 1.2 * ratio))
    return s * np.minimum(1, t / 0.004) * 0.5


def whoosh(dur=0.9):
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    a = lowpass(x, 700, 2)
    b = lowpass(x, 3500, 2)
    w = np.sin(np.pi * np.minimum(1, t / dur)) ** 2
    mixf = np.clip(t / dur, 0, 1)
    return (a * (1 - mixf) + b * mixf) * w * 0.55


def riser(dur=1.0):
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = highpass(lowpass(rng.standard_normal(n), 6000), 800) * (t / dur) ** 2
    f = 220 * 2 ** (t / dur * 2)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur) ** 2 * 0.4
    return (x * 0.5 + tone) * np.minimum(1, (dur - t) / 0.06 + 0.0) * 0.7



# ---------------------------------------------------------------- the reel
BPM = 100; BEAT = 60 / BPM; BAR = BEAT * 4
CH = {'F': ['F2', 'C3', 'F3', 'A3', 'C4'], 'C': ['C3', 'G3', 'C4', 'E4', 'G4'], 'Dm': ['D3', 'A3', 'D4', 'F4', 'A4'], 'Bb': ['Bb2', 'F3', 'Bb3', 'D4', 'F4']}
AR = {'F': ['F4', 'A4', 'C5', 'F5'], 'C': ['C5', 'E5', 'G5', 'C6'], 'Dm': ['D5', 'F5', 'A5', 'D6'], 'Bb': ['Bb4', 'D5', 'F5', 'Bb5']}
BS = {'F': 'F1', 'C': 'C2', 'Dm': 'D2', 'Bb': 'Bb1'}
PROG = ['F', 'C', 'Dm', 'Bb']
PAT = [0, 2, 1, 3, 2, 1, 3, 2]
chord_at = lambda t: PROG[int(t // BAR) % 4]
dry = np.zeros((2, N)); wet = np.zeros((2, N))

def pop():
    n = int(SR * 0.16); t = np.arange(n) / SR
    f = 300 + 900 * np.exp(-t * 40)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22) * 0.7
def snap():
    n = int(SR * 0.08); t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 2200) * np.exp(-t * 90) * 0.6
def tock(hi):
    n = int(SR * 0.09); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * (1800 if hi else 1300) * t) * np.exp(-t * 60) * 0.5 + highpass(rng.standard_normal(n), 3000) * np.exp(-t * 200) * 0.3)
def drone(f, dur):
    n = int(SR * dur); t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * h * t * (1 + 0.002 * h)) / h for h in range(1, 6))
    return lowpass(s, 500) * env_adsr(n, 0.6, 1.0) * 0.4
def keys(f, dur=1.6):
    n = int(SR * dur); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 3)
    return s * np.exp(-t * 1.6) * np.minimum(1, t / 0.006) * 0.4
def swoopdown(dur=0.45):
    n = int(SR * dur); t = np.arange(n) / SR
    f = 900 * np.exp(-t * 6)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * (1 - t / dur) * 0.35

GROOVE = [(9.6, 40.8), (48.0, 55.2)]
grooving = lambda t: any(a <= t < b for a, b in GROOVE)

# hook: plucky motif + snaps
t = 0.0
while t < 4.75:
    i = int(round(t / (BEAT / 2)))
    if i % 8 in (0, 3, 6):
        ch = chord_at(t + 1e-3)
        mix_into(wet, pluck(hz(AR[ch][PAT[i % 8]]), 1.2), t, 0.5, pan=0.2 * np.sin(i))
    if i % 4 == 2: mix_into(dry, snap(), t, 0.5)
    t += BEAT / 2
mix_into(dry, swoopdown(), 4.4, 0.6)

# 2 AM panic: low drone, a ticking clock, a heartbeat, then a riser into the drop
mix_into(wet, drone(hz('D2'), 5.0), 4.8, 0.9)
t = 4.8; k = 0
while t < 9.6:
    mix_into(dry, tock(k % 2 == 0), t, 0.55); k += 1
    if k % 2 == 1: mix_into(dry, kick(), t + 0.02, 0.18); mix_into(dry, kick(), t + 0.2, 0.1)
    t += BEAT
mix_into(wet, riser(1.6), 8.0, 0.7)

# the groove: pads, arps, bass and drums
bars = int(DUR / BAR) + 1
for b in range(bars):
    t0 = b * BAR
    ch = chord_at(t0 + 1e-3)
    if grooving(t0):
        for j, nm in enumerate(CH[ch]): mix_into(wet, pad_note(hz(nm), BAR + 1.2), t0 - 0.1, 0.16 * (1 if j < 3 else 0.7), pan=(j - 2) * 0.12)
        mix_into(dry, bass_note(hz(BS[ch]), BAR * 0.45), t0, 0.26)
        mix_into(dry, bass_note(hz(BS[ch]), BAR * 0.4), t0 + BAR * 0.5 + BEAT * 0.5, 0.2)
t = 9.6; i = 0
while t < 55.2:
    if grooving(t):
        ch = chord_at(t + 1e-3)
        mix_into(wet, pluck(hz(AR[ch][PAT[i % 8]]), 1.3), t, 0.42 * (1.15 if i % 2 == 0 else 0.8), pan=0.25 * np.sin(i * 0.9))
        if i % 2 == 0: mix_into(dry, kick(), t, 0.3)
        if i % 4 == 2: mix_into(dry, clap(), t, 0.36)
        mix_into(dry, hat(), t + BEAT / 4, 0.32 if i % 2 else 0.18, pan=0.3)
    t += BEAT / 2; i += 1

# outfit changes: a whoosh into each one and a felt "pop"
for n in range(6):
    tt = 16.8 + n * BAR
    mix_into(dry, whoosh(0.5), tt - 0.42, 0.32)
    mix_into(dry, pop(), tt, 0.55)
# PDF flies in, typing, then the reviewer is ready
mix_into(dry, whoosh(0.9), 31.7, 0.4)
for j in range(22): mix_into(dry, tick(), 33.0 + j * 0.115, 0.5 + 0.2 * rng.random(), pan=0.15)
mix_into(wet, chime(1046.5, 2.2), 35.6, 0.55); mix_into(wet, chime(1568, 1.8), 35.62, 0.3)
# rest: lo-fi breakdown — soft keys, vinyl crackle, a music-box chime when the break starts
for b in range(3):
    t0 = 40.8 + b * BAR
    ch = ['Dm', 'Bb', 'F'][b]
    for j, nm in enumerate(CH[ch][1:4]): mix_into(wet, keys(hz(nm), 2.4), t0 + j * 0.06, 0.5)
    for j, nm in enumerate(AR[ch]): mix_into(wet, keys(hz(nm), 1.2), t0 + BEAT * (j + 1), 0.25)
cr = highpass(rng.standard_normal(int(SR * 7.2)), 3000) * (rng.random(int(SR * 7.2)) > 0.9985) * 2.2
mix_into(dry, cr, 40.8, 0.25)
mix_into(wet, chime(1318.5, 2.4), 46.3, 0.45); mix_into(wet, chime(1760, 2.0), 46.45, 0.3)
mix_into(dry, whoosh(1.0), 47.4, 0.35)
# CTA: riser, a big chord and chimes
mix_into(wet, riser(1.2), 54.0, 0.65)
for j, nm in enumerate(CH['F'] + ['F4', 'A4']): mix_into(wet, pad_note(hz(nm), 4.8), 55.2, 0.2, pan=(j - 3) * 0.1)
mix_into(dry, kick(), 55.2, 0.4); mix_into(dry, clap(), 55.2, 0.3)
for j, f in enumerate([1046.5, 1318.5, 1568, 2093]): mix_into(wet, chime(f, 2.6), 55.25 + j * 0.12, 0.4)
mix_into(dry, pop(), 56.0, 0.45)

# ---------------------------------------------------------------- reverb + master
def reverb(x, wet_amt=0.3):
    L = int(SR * 1.8)
    tt = np.arange(L) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(L) * np.exp(-tt / 0.45)
        ir = lowpass(ir, 5500)
        ir[: int(SR * 0.012)] *= 0.2
        size = 1
        while size < x.shape[1] + L: size *= 2
        y = np.fft.irfft(np.fft.rfft(x[ch], size) * np.fft.rfft(ir, size), size)[: x.shape[1]]
        out[ch] = y
    out /= np.max(np.abs(out)) + 1e-9
    return x * (1 - wet_amt * 0.5) + out * wet_amt * np.max(np.abs(x)) * 1.6


wet_r = reverb(wet, 0.34)
mix = wet_r + dry
mix = np.tanh(mix * 1.2) / np.tanh(1.2)
t = np.arange(N) / SR
mix *= np.minimum(1, t / 0.05) * np.minimum(1, (DUR - t) / 1.4)
peak = np.max(np.abs(mix)); mix = mix / peak * 0.9
pcm = (mix.T * 32767).astype(np.int16)
with wave.open('reel_music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote reel_music.wav', peak)
