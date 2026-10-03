"""Synthesised soundtrack for the Cassie ad: warm pad + plucked arpeggio + soft groove,
UI click sounds locked to the cursor, a riser into the title and a chime on the logo click.
Pure numpy — no samples, nothing to license."""
import json, wave
import numpy as np

SR = 44100
DUR = 60.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
BPM = 96
BEAT = 60 / BPM
BAR = BEAT * 4


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


# ---------------------------------------------------------------- harmony
CHORDS = {
    'Am': ['A2', 'E3', 'A3', 'C4', 'E4'],
    'F': ['F2', 'C3', 'F3', 'A3', 'C4'],
    'C': ['C3', 'G3', 'C4', 'E4', 'G4'],
    'G': ['G2', 'D3', 'G3', 'B3', 'D4'],
}
PROG = ['Am', 'F', 'C', 'G']
ARP = {  # upper-octave pluck notes per chord
    'Am': ['A4', 'C5', 'E5', 'A5'],
    'F': ['F4', 'A4', 'C5', 'F5'],
    'C': ['C5', 'E5', 'G5', 'C6'],
    'G': ['G4', 'B4', 'D5', 'G5'],
}
BASS = {'Am': 'A1', 'F': 'F1', 'C': 'C2', 'G': 'G1'}
PATTERN = [0, 2, 1, 3, 2, 1, 3, 2]  # eighth notes per bar

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


# ---------------------------------------------------------------- arrange
dry = np.zeros((2, N))   # drums, clicks, bass
wet = np.zeros((2, N))   # pad, arp, chimes -> reverb

def chord_at(t):
    return PROG[int(t // BAR) % 4]

def sect_gain(t):
    """overall musical energy by time"""
    if t < 3.5: return 0.45
    if t < 5.0: return 0.55
    if t < 8.1: return 0.8
    return 1.0

# pad: one note per chord tone per bar, overlapping
bars = int(DUR / BAR) + 2
for b in range(bars):
    t0 = b * BAR
    ch = chord_at(t0 + 0.01)
    if t0 >= 57.5: ch = 'C'
    g = 0.26 * sect_gain(t0)
    for i, nm in enumerate(CHORDS[ch]):
        mix_into(wet, pad_note(hz(nm), BAR + 1.6), t0 - 0.2, g * (1.0 if i < 3 else 0.7), pan=(i - 2) * 0.12)

# arp plucks (from the brand moment)
t = 0.0
step = BEAT / 2
k = 0
while t < DUR - 0.2:
    if t >= 4.6 and t < 58.0:
        ch = chord_at(t + 0.001)
        idx = PATTERN[int(round((t % BAR) / step)) % 8]
        f = hz(ARP[ch][idx])
        fade = min(1.0, (t - 4.6) / 3.5)
        low = 0.55 if (t < 10.4 or t >= 56.0) else 1.0
        accent = 1.15 if int(round((t % BAR) / step)) % 2 == 0 else 0.8
        mix_into(wet, pluck(f, 1.5), t, 0.62 * fade * low * accent, pan=0.25 * np.sin(k * 0.9))
    t += step; k += 1

# bass + groove through the product tour
for b in range(bars):
    t0 = b * BAR
    if 10.4 <= t0 < 56.0:
        mix_into(dry, bass_note(hz(BASS[chord_at(t0 + 0.01)]), BAR * 0.95), t0, 0.2)
t = 10.4
while t < 56.0:
    beat_idx = int(round((t - 10.4) / BEAT))
    mix_into(dry, kick(), t, 0.2 if t < 52 else 0.26)
    if beat_idx % 2 == 1 and t >= 18.0:
        mix_into(dry, clap(), t, 0.3 if t < 52 else 0.42)
    mix_into(dry, hat(), t + BEAT / 2, 0.6, pan=0.3)
    if t >= 18.0:
        mix_into(dry, hat(), t + BEAT / 4, 0.22, pan=-0.3)
        mix_into(dry, hat(), t + 3 * BEAT / 4, 0.22, pan=-0.3)
    t += BEAT

# riser into the title + whooshes on window entrances
mix_into(wet, riser(1.25), 3.55, 0.55)
for t0 in (10.4, 19.0, 28.0, 37.0):
    mix_into(dry, whoosh(0.9), t0 + 0.05, 0.35)
mix_into(dry, whoosh(1.0), 43.2, 0.3)

# chimes: brand click, final click, plus small sparkles
mix_into(wet, chime(880, 2.8), 8.1, 0.7)
mix_into(wet, chime(1320, 2.0), 8.12, 0.35)
mix_into(wet, chime(659.25, 3.2), 58.1, 0.7)
mix_into(wet, chime(987.77, 2.6), 58.12, 0.4)
mix_into(wet, chime(1318.5, 2.4), 58.3, 0.3)
mix_into(wet, chime(1046.5, 1.6), 41.14, 0.35)   # graph "draw on this"
mix_into(wet, chime(1174.7, 1.6), 36.9 - 0.0, 0.0)
mix_into(wet, chime(1568, 1.8), 36.4, 0.4)       # "Saved" toast

# UI clicks locked to the cursor + typing ticks in the PDF scene
for c in json.load(open('clicks.json')):
    mix_into(dry, click(c['kind'] == 'down'), c['t'], 0.5 if c['kind'] == 'down' else 0.22, pan=0.0)
for i in range(15):
    mix_into(dry, tick(), 28.0 + 2.5 + i / 22 + 0.02, 0.55 + 0.1 * rng.random(), pan=0.1)

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

wet_r = reverb(wet, 0.38)
mix = wet_r + dry
# gentle bus compression via soft clip, then loudness
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
# fades: in at start, out over the last 1.6 s
t = np.arange(N) / SR
fade = np.minimum(1, t / 0.8) * np.minimum(1, (DUR - t) / 1.6)
mix *= fade
peak = np.max(np.abs(mix))
mix = mix / peak * 0.88
pcm = (mix.T * 32767).astype(np.int16)
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote music.wav', pcm.shape, 'peak', peak)
