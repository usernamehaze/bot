#!/bin/sh
# frames/ + final_mix.wav → ../cassie-explainer-full.mp4 (Instagram: 1080×1920, 30 fps, H.264 + AAC)
set -e
cd "$(dirname "$0")"
FF=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
"$FF" -y -loglevel error -framerate 30 -i frames/f_%05d.jpg -i final_mix.wav \
  -c:v libx264 -preset slow -crf 21 -maxrate 6M -bufsize 12M -pix_fmt yuv420p -profile:v high -level 4.1 \
  -c:a aac -b:a 192k -ar 44100 -shortest -movflags +faststart ../cassie-explainer-full.mp4
"$FF" -y -loglevel error -i frames/f_00600.jpg -q:v 2 ../cassie-explainer-full-cover.jpg
echo "wrote ../cassie-explainer-full.mp4"
