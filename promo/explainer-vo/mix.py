"""Music bed + voiceover mix for the Cassie explainer reel (length from timeline.json) (100 BPM, cuts on the bar): warm pad + plucked arpeggio + soft groove,
UI click sounds locked to the cursor, a riser into the title and a chime on the logo click.
Pure numpy — no samples, nothing to license."""
import wave
import numpy as np

SR = 44100
import json as _json
_TL = _json.load(open("timeline.json"))
DUR = round(_TL[-1]["t0"] + _TL[-1]["dur"] + 1.6, 2)
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



# ---------------------------------------------------------------- music bed, cued to the scenes
TL = _TL
start = {s['key']: s['t0'] for s in TL}
end_of = lambda c: max(s['t0'] + s['dur'] for s in TL if s['chapter'] == c)
FEAT0, FEAT1, TRY0 = start['highlight'], end_of('features'), start['cta1']
def soft(f=1400):
    n = int(SR * 0.12); t = np.arange(n) / SR
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 38) * 0.35
def thock():
    n = int(SR * 0.18); t = np.arange(n) / SR
    f = 160 + 120 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18) * 0.8

# intro: airy pads + sparse plucks
for b in range(int(start['prob1'] // BAR) + 1):
    t0 = b * BAR
    for j, nm in enumerate(CH[['F', 'C', 'Dm'][b % 3]]): mix_into(wet, pad_note(hz(nm), BAR + 1.2), t0, 0.11, pan=(j - 2) * 0.12)
for i in range(int(start['prob1'] / (BEAT))):
    if i % 3 == 0: mix_into(wet, pluck(hz(['F5', 'A5', 'C6', 'G5'][i % 4]), 1.1), i * BEAT, 0.22, pan=0.3 * np.sin(i))
# problem: darker swirl
t = start['prob1']
while t < FEAT0:
    for j, nm in enumerate(CH[['Dm', 'Bb'][int(t // BAR) % 2]][1:]): mix_into(wet, pad_note(hz(nm), BAR + 1.0), t, 0.1, pan=(j - 2) * 0.15)
    t += BAR
mix_into(wet, drone(hz('D2'), FEAT0 - start['prob1']), start['prob1'], 0.55)
for i in range(6): mix_into(dry, thock(), start['simple'] + 0.05 + i * 0.07, 0.35)
mix_into(wet, chime(1318.5, 2.0), start['simple'] + 1.7, 0.4)
mix_into(dry, click(True), start['logo'] + 1.1, 0.45); mix_into(wet, chime(1046.5, 2.0), start['logo'] + 1.2, 0.4); mix_into(wet, chime(1568, 1.6), start['logo'] + 1.3, 0.22)
mix_into(wet, riser(1.0), FEAT0 - 1.0, 0.35)
# features: the groove
bars = int(DUR / BAR) + 1
grooving = lambda t: FEAT0 <= t < FEAT1
for b in range(bars):
    t0 = FEAT0 + b * BAR
    if not grooving(t0): continue
    ch = PROG[b % 4]
    for j, nm in enumerate(CH[ch]): mix_into(wet, pad_note(hz(nm), BAR + 1.2), t0 - 0.1, 0.11 * (1 if j < 3 else 0.7), pan=(j - 2) * 0.12)
    mix_into(dry, bass_note(hz(BS[ch]), BAR * 0.45), t0, 0.22)
    mix_into(dry, bass_note(hz(BS[ch]), BAR * 0.4), t0 + BAR * 0.5 + BEAT * 0.5, 0.17)
t = FEAT0; i = 0
while t < FEAT1:
    ch = PROG[int((t - FEAT0) // BAR) % 4]
    if i % 2 == 0: mix_into(wet, pluck(hz(AR[ch][PAT[(i // 2) % 8]]), 1.2), t, 0.26, pan=0.25 * np.sin(i * 0.9))
    if i % 2 == 0: mix_into(dry, kick(), t, 0.22)
    if i % 4 == 2: mix_into(dry, clap(), t, 0.2)
    mix_into(dry, hat(), t + BEAT / 4, 0.2 if i % 2 else 0.1, pan=0.3)
    t += BEAT / 2; i += 1
# try it: lift into the end card
for k, key in enumerate(['cta1', 'cta2']):
    for j, nm in enumerate(CH[['F', 'C'][k]]): mix_into(wet, pad_note(hz(nm), 3.4), start[key], 0.16, pan=(j - 2) * 0.12)
mix_into(wet, riser(1.0), start['cta3'] - 1.0, 0.5)
for j, nm in enumerate(CH['F'] + ['F4', 'A4']): mix_into(wet, pad_note(hz(nm), DUR - start['cta3']), start['cta3'], 0.17, pan=(j - 3) * 0.1)
mix_into(dry, kick(), start['cta3'], 0.35)
for j, f in enumerate([1046.5, 1318.5, 1568, 2093]): mix_into(wet, chime(f, 2.6), start['cta3'] + 0.05 + j * 0.12, 0.3)
# a soft whoosh + pop into every scene
for s in TL[1:]:
    mix_into(dry, whoosh(0.4), s['t0'] - 0.32, 0.16); mix_into(dry, pop(), s['t0'], 0.14)

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



music = reverb(wet, 0.32) + dry
music = np.tanh(music * 1.1) / np.tanh(1.1)
music /= np.max(np.abs(music)) + 1e-9

# ---------------------------------------------------------------- voiceover, placed on its cues, music ducked under it
def load_vo(path):
    w = wave.open(path); sr = w.getframerate()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    n = int(len(a) * SR / sr)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a)
vo = np.zeros(N)
for s in TL:
    v = load_vo('vo/' + s['key'] + '.wav'); i = int(s['vo'] * SR); e = min(N, i + len(v)); vo[i:e] += v[: e - i]
vo /= np.max(np.abs(vo)) + 1e-9
# a touch of warmth + presence on the voice
vo = vo + 0.18 * highpass(vo, 2500, 1)
vo = np.tanh(vo * 1.6) / np.tanh(1.6)
# ducking envelope: music drops while she talks
act = (np.abs(vo) > 0.02).astype(float)
k = int(SR * 0.25); act = np.convolve(act, np.ones(k) / k, mode='same'); act = np.clip(act * 3, 0, 1)
rel = int(SR * 0.35); env = np.zeros(N); cur = 0.0
step_a, step_r = 1 / (SR * 0.08), 1 / rel
for j in range(0, N, 64):
    target = act[j]
    cur = min(target, cur + step_a * 64) if target > cur else max(target, cur - step_r * 64)
    env[j:j + 64] = cur
duck = 1 - 0.62 * env
out = np.zeros((2, N))
out += music * duck * 0.42
out[0] += vo * 0.95; out[1] += vo * 0.95
t = np.arange(N) / SR
out *= np.minimum(1, t / 0.05) * np.minimum(1, (DUR - t) / 1.2)
out /= np.max(np.abs(out)) + 1e-9; out *= 0.92
pcm = (out.T * 32767).astype(np.int16)
with wave.open('final_mix.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote final_mix.wav', DUR, 's')
