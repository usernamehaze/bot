#!/bin/sh
# frames/f_00000.jpg … + explainer_music.wav → ../cassie-explainer-reel.mp4 (Instagram: 1080×1920, 30 fps)
set -e
cd "$(dirname "$0")"
FF=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
"$FF" -y -loglevel error -framerate 30 -i frames/f_%05d.jpg -i explainer_music.wav \
  -c:v libx264 -preset slow -crf 21 -maxrate 6M -bufsize 12M -pix_fmt yuv420p -profile:v high -level 4.1 \
  -c:a aac -b:a 192k -ar 44100 -shortest -movflags +faststart ../cassie-explainer-reel.mp4
"$FF" -y -loglevel error -i frames/f_01290.jpg -q:v 2 ../cassie-explainer-cover.jpg
echo "wrote ../cassie-explainer-reel.mp4"
