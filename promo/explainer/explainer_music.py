"""Synthesised soundtrack for the Cassie 60-second explainer reel (100 BPM, cuts on the bar): warm pad + plucked arpeggio + soft groove,
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


GROOVE = [(16.8, 50.4), (52.8, 55.2)]
grooving = lambda t: any(a <= t < b for a, b in GROOVE)
def soft(f=1400):
    n = int(SR * 0.12); t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 38) * 0.35
def thock():
    n = int(SR * 0.18); t = np.arange(n) / SR
    f = 160 + 120 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18) * 0.8
def ding(f=1568):
    return chime(f, 1.6)

# ---- Intro: airy pad + a soft note for every word that floats in
for b in range(3):
    t0 = b * BAR
    for j, nm in enumerate(CH[['F', 'C', 'Dm'][b]]): mix_into(wet, pad_note(hz(nm), BAR + 1.2), t0, 0.12, pan=(j - 2) * 0.12)
words = [(0.0, 3, 0.22), (2.4, 4, 0.2), (4.8, 6, 0.24)]
notes = ['F5', 'A5', 'C6', 'A5', 'G5', 'C6']
for s0, n, gap in words:
    for i in range(n): mix_into(wet, pluck(hz(notes[i % 6]), 1.0), s0 + 0.1 + i * gap, 0.34, pan=0.3 * np.sin(i))
for t0 in (0.9, 1.02, 1.14, 3.4, 3.55): mix_into(dry, pop(), t0, 0.22)
mix_into(dry, tock(True), 6.2, 0.4); mix_into(dry, tock(False), 6.5, 0.4); mix_into(dry, tock(True), 6.8, 0.4)

# ---- Problem: darker swirl, letters thock into place, the logo rings in
mix_into(wet, drone(hz('D2'), 7.4), 7.2, 0.7)
for b in range(4):
    for j, nm in enumerate(CH[['Dm', 'Bb', 'Dm', 'C'][b]][1:]): mix_into(wet, pad_note(hz(nm), BAR + 1.0), 7.2 + b * BAR, 0.1, pan=(j - 2) * 0.15)
mix_into(dry, whoosh(1.0), 7.1, 0.4); mix_into(dry, whoosh(1.2), 9.5, 0.45)
for i in range(6): mix_into(dry, thock(), 12.05 + i * 0.08, 0.45)
mix_into(dry, whoosh(0.5), 13.55, 0.3); mix_into(wet, ding(1318.5), 13.8, 0.5)
mix_into(wet, riser(0.9), 14.5, 0.45)
mix_into(dry, click(True), 16.2, 0.6); mix_into(wet, chime(1046.5, 2.0), 16.3, 0.45); mix_into(wet, chime(1568, 1.6), 16.4, 0.25)

# ---- Features: the groove, a whoosh + pop into every feature, UI sounds on cue
bars = int(DUR / BAR) + 1
for b in range(bars):
    t0 = b * BAR
    ch = chord_at(t0 + 1e-3)
    if grooving(t0):
        for j, nm in enumerate(CH[ch]): mix_into(wet, pad_note(hz(nm), BAR + 1.2), t0 - 0.1, 0.13 * (1 if j < 3 else 0.7), pan=(j - 2) * 0.12)
        mix_into(dry, bass_note(hz(BS[ch]), BAR * 0.45), t0, 0.26)
        mix_into(dry, bass_note(hz(BS[ch]), BAR * 0.4), t0 + BAR * 0.5 + BEAT * 0.5, 0.2)
t = 16.8; i = 0
while t < 55.2:
    if grooving(t):
        ch = chord_at(t + 1e-3)
        mix_into(wet, pluck(hz(AR[ch][PAT[i % 8]]), 1.2), t, 0.34 * (1.15 if i % 2 == 0 else 0.8), pan=0.25 * np.sin(i * 0.9))
        if i % 2 == 0: mix_into(dry, kick(), t, 0.3)
        if i % 4 == 2: mix_into(dry, clap(), t, 0.32)
        mix_into(dry, hat(), t + BEAT / 4, 0.3 if i % 2 else 0.16, pan=0.3)
    t += BEAT / 2; i += 1
for tt in (16.8, 21.6, 26.4, 31.2, 33.6, 36.0, 38.4, 40.8, 43.2, 45.6, 48.0):
    mix_into(dry, whoosh(0.45), tt - 0.38, 0.3); mix_into(dry, pop(), tt, 0.4)
for j in range(26): mix_into(dry, tick(), 19.5 + j * 0.066, 0.4 + 0.2 * rng.random(), pan=0.1)   # Cassie typing her answer
mix_into(dry, click(True), 18.2, 0.4); mix_into(dry, click(False), 19.1, 0.3)
mix_into(dry, click(True), 21.9, 0.4); mix_into(dry, click(False), 22.7, 0.3)               # snip
mix_into(dry, whoosh(0.6), 22.9, 0.3)                                                          # board slides in
mix_into(dry, click(True), 25.5, 0.5); mix_into(wet, ding(1568), 25.65, 0.45)                  # check my work ✓
mix_into(wet, ding(1318.5), 29.8, 0.45); mix_into(wet, ding(1760), 29.9, 0.25)                 # reviewer file ready
mix_into(dry, click(True), 34.6, 0.45); mix_into(wet, ding(1568), 34.75, 0.5); mix_into(wet, ding(2093), 34.85, 0.3)  # correct!
mix_into(wet, chime(1318.5, 2.2), 42.5, 0.45)                                                  # timer → break
mix_into(dry, click(True), 44.2, 0.5); mix_into(dry, pop(), 44.35, 0.45)                       # switch → suit
for tt in (46.2, 46.9, 47.5): mix_into(dry, click(True), tt, 0.4); mix_into(dry, pop(), tt + 0.03, 0.2)

# ---- Try it: lighter, then a riser into the end card and a bright final chord
for b in range(4):
    t0 = 50.4 + b * BAR
    if not grooving(t0):
        for j, nm in enumerate(CH[['F', 'C', 'Dm', 'F'][b]]): mix_into(wet, pad_note(hz(nm), BAR + 1.4), t0, 0.15, pan=(j - 2) * 0.12)
mix_into(wet, riser(1.2), 54.0, 0.55)
for j, nm in enumerate(CH['F'] + ['F4', 'A4']): mix_into(wet, pad_note(hz(nm), 4.8), 55.2, 0.18, pan=(j - 3) * 0.1)
mix_into(dry, kick(), 55.2, 0.4)
for j, f in enumerate([1046.5, 1318.5, 1568, 2093]): mix_into(wet, chime(f, 2.6), 55.25 + j * 0.12, 0.36)
mix_into(dry, pop(), 57.4, 0.45); mix_into(wet, ding(2093), 57.45, 0.3)

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
with wave.open('explainer_music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote explainer_music.wav', peak)
