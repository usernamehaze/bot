"""Puts the 1-minute tour together: promo/cassie-ad-60s.mp4.

   python3 promo/ad3/build.py <out-dir>

<out-dir> holds what record.cjs and frames.cjs made (a folder of frames per scene, bg-*.png,
mask.png). Each filmed scene goes into its window under its caption, the scenes cross-fade, and the
sound is Bella's voice-over (vo/*.wav) over a soft music bed made here from sine waves (no licensed
music), which dips while she talks. Needs numpy and imageio-ffmpeg (for its ffmpeg binary).
"""
import json, os, subprocess, sys, wave
import numpy as np
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'ad3-out')
DEST = os.path.join(HERE, '..', 'cassie-ad-60s.mp4')
FF = imageio_ffmpeg.get_ffmpeg_exe()
FPS, FADE, SR = 30, 0.3, 48000
WIN = (224, 196, 1472, 828)  # x, y, w, h of the footage window (frame.html)
SCRIPT = json.load(open(os.path.join(HERE, 'script.json')))


def ff(*args):
    subprocess.run([FF, '-y', '-loglevel', 'error', *args], check=True)


# ---------- 1. one clip per scene ----------
clips = []
for e in SCRIPT:
    k, n = e['key'], round(e['dur'] * FPS)
    src = os.path.join(OUT, k, 'f_%05d.jpg')
    clip = os.path.join(OUT, f'clip-{k}.mp4')
    if 'cap' in e:
        x, y, w, h = WIN
        ff('-loop', '1', '-framerate', str(FPS), '-i', os.path.join(OUT, f'bg-{k}.png'),
           '-framerate', str(FPS), '-i', src,
           '-loop', '1', '-framerate', str(FPS), '-i', os.path.join(OUT, 'mask.png'),
           '-filter_complex',
           f'[1:v]scale={w}:{h}:flags=lanczos,format=rgba[fg];[2:v]crop={w}:{h}:{x}:{y},format=gray[m];'
           f'[fg][m]alphamerge[fgm];[0:v][fgm]overlay={x}:{y},format=yuv420p[v]',
           '-map', '[v]', '-frames:v', str(n), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', clip)
    else:
        ff('-framerate', str(FPS), '-i', src, '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p',
           '-frames:v', str(n), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', clip)
    clips.append(clip)

# ---------- 2. cross-fade them ----------
starts, t = [], 0.0
for e in SCRIPT:
    starts.append(t)
    t += e['dur'] - FADE
total = t + FADE
chain, last = [], '[0:v]'
for i in range(1, len(clips)):
    out = f'[v{i}]'
    chain.append(f'{last}[{i}:v]xfade=transition=fade:duration={FADE}:offset={starts[i]:.3f}{out}')
    last = out
chain.append(f'{last}fade=t=out:st={total - 0.7:.3f}:d=0.7,format=yuv420p[vout]')
video = os.path.join(OUT, 'video.mp4')
args = []
for c in clips:
    args += ['-i', c]
ff(*args, '-filter_complex', ';'.join(chain), '-map', '[vout]', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', video)

# ---------- 3. the sound ----------
N = int(total * SR)
tt = np.arange(N) / SR


def read_wav(p):
    with wave.open(p) as w:
        sr, ch, data = w.getframerate(), w.getnchannels(), w.readframes(w.getnframes())
    a = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768
    if ch > 1:
        a = a.reshape(-1, ch).mean(1)
    if sr != SR:
        a = np.interp(np.arange(int(len(a) * SR / sr)) * sr / SR, np.arange(len(a)), a)
    return a


vo = np.zeros(N, np.float32)
for e, s in zip(SCRIPT, starts):
    p = os.path.join(HERE, 'vo', f"{e['key']}.wav")
    if not os.path.exists(p):
        continue
    a = read_wav(p)
    a = a / (np.sqrt(np.mean(a ** 2)) + 1e-9) * 0.13  # every line at the same loudness
    i = int((s + 0.35) * SR)
    vo[i:i + len(a)] += a[:N - i]

# music: 96 bpm, Cmaj7 - Am7 - Fmaj7 - G6, two bars each; quiet under the hook, fuller after
BPM = 96.0
beat = 60 / BPM
bar = 4 * beat
CHORDS = [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 52]]
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
music = np.zeros(N, np.float32)
rng = np.random.default_rng(7)
hook_end = starts[2]
for b in range(int(total / bar) + 2):
    t0 = b * bar
    if t0 >= total:
        break
    ch = CHORDS[(b // 2) % 4]
    i0, i1 = int(t0 * SR), min(N, int((t0 + bar * 1.15) * SR))
    seg = tt[i0:i1] - t0
    env = np.minimum(1, seg / 0.6) * np.exp(-np.maximum(0, seg - bar) * 3)
    pad = sum(np.sin(2 * np.pi * hz(m + 12) * seg * (1 + d)) * (0.5 if j else 0.7)
              for j, m in enumerate(ch) for d in (-0.0015, 0.0015)) / 8
    music[i0:i1] += (pad * env * 0.55).astype(np.float32)
    bass = np.sin(2 * np.pi * hz(ch[0] - 12) * seg) * np.exp(-seg * 1.2) * 0.35
    music[i0:i1] += bass.astype(np.float32)
    if t0 >= hook_end - 0.01:
        for s8 in range(8):  # an eighth-note pluck arpeggio
            ts = t0 + s8 * beat / 2
            m = ch[[0, 1, 2, 3, 2, 1, 2, 3][s8]] + 24
            j0, j1 = int(ts * SR), min(N, int((ts + 0.5) * SR))
            q = tt[j0:j1] - ts
            music[j0:j1] += ((np.sin(2 * np.pi * hz(m) * q) + 0.3 * np.sin(4 * np.pi * hz(m) * q)) * np.exp(-q * 9) * 0.10).astype(np.float32)
        for k4 in range(4):  # soft kick on every beat, a tick between
            ts = t0 + k4 * beat
            j0, j1 = int(ts * SR), min(N, int((ts + 0.25) * SR))
            q = tt[j0:j1] - ts
            music[j0:j1] += (np.sin(2 * np.pi * (45 + 70 * np.exp(-q * 30)) * q) * np.exp(-q * 14) * 0.32).astype(np.float32)
            ts2 = ts + beat / 2
            j0, j1 = int(ts2 * SR), min(N, int((ts2 + 0.06) * SR))
            nz = rng.standard_normal(j1 - j0)
            music[j0:j1] += (np.diff(nz, prepend=0) * np.exp(-(tt[j0:j1] - ts2) * 70) * 0.025).astype(np.float32)
# swell in, fade out
music *= np.minimum(1, tt / 1.2) * np.clip((total - tt) / 1.6, 0, 1)
# dip the music while Bella talks
k = int(0.25 * SR)
talking = np.convolve(np.abs(vo) > 0.01, np.ones(k) / k, mode='same')
duck = 1 - 0.55 * np.clip(talking * 4, 0, 1)
mix = vo + music * 0.55 * duck
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
mix = mix / (np.abs(mix).max() + 1e-9) * 0.89
pcm = (np.stack([mix, mix], 1) * 32767).astype(np.int16)
audio = os.path.join(OUT, 'mix.wav')
with wave.open(audio, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# ---------- 4. together ----------
ff('-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-crf', '21', '-preset', 'slow',
   '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', DEST)
# a poster for the player: the highlight scene, popup open
hi = next(i for i, e in enumerate(SCRIPT) if e['key'] == 'highlight')
ff('-ss', f'{starts[hi] + 4.2:.2f}', '-i', DEST, '-frames:v', '1', '-q:v', '3', os.path.join(HERE, '..', '..', 'landing', 'tour-poster.jpg'))
print(f'{DEST}: {total:.1f} s, {os.path.getsize(DEST) / 1e6:.1f} MB')
