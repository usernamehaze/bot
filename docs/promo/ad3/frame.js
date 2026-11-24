// The frame around each filmed scene: a caption on top and a dark window the footage drops into.
// ?b=…&s=… sets the caption; ?mask=1 draws the window's rounded shape (white on black) for ffmpeg.
const q = new URLSearchParams(location.search);
document.querySelector('.cap b').textContent = q.get('b') || '';
document.querySelector('.cap span').textContent = q.get('s') || '';
if (q.get('mask')) document.body.classList.add('mask');
