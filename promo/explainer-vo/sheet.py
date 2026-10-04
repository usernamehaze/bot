import sys
from PIL import Image
ts = sys.argv[2].split(',')
ims = [Image.open(f'stills/s_{t.replace(".", "_")}.jpg').crop((0, 420, 1080, 1340)).resize((324, 276)) for t in ts]
W = Image.new('RGB', (324 * 5, 276 * ((len(ims) + 4) // 5)))
for i, im in enumerate(ims): W.paste(im, ((i % 5) * 324, (i // 5) * 276))
W.save(sys.argv[1])
