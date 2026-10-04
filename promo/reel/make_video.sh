#!/bin/sh
# frames/f_00000.jpg … + reel_music.wav → cassie-reel-60s.mp4 (Instagram: 1080×1920, 30 fps, H.264 + AAC)
set -e
cd "$(dirname "$0")"
FF=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
"$FF" -y -loglevel error -framerate 30 -i frames/f_%05d.jpg -i reel_music.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -level 4.1 \
  -c:a aac -b:a 192k -ar 44100 -shortest -movflags +faststart ../cassie-reel-60s.mp4
"$FF" -y -loglevel error -i frames/f_00920.jpg -q:v 2 ../cassie-reel-cover.jpg
echo "wrote ../cassie-reel-60s.mp4 and ../cassie-reel-cover.jpg"
