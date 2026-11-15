#!/usr/bin/env python3
"""Rebuild Sans Comic's art from Microsoft's Comic Chat source.

    git clone https://github.com/microsoft/comic-chat
    pip install pillow numpy
    python3 tools/build_art.py --source path/to/comic-chat --out .

Writes art/<character>.png (one sprite sheet each, smoothed to 2x), art/faces.png (portraits),
art/bg-<name>.jpg (backdrops) and manifest.js (where every drawing sits and how heads join bodies).
Takes a few minutes.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avb import S as Stream, parse, read_image
from PIL import Image, ImageFilter
import numpy as np

SCALE = 2
VERSION = 'v2.5-beta-1'
NAMES = {'tongtyed': 'Tongue-Tyed', 'glenda': 'Glenda', 'pedagog': 'Pedagogue'}
MAIN = ['anna', 'armando', 'buck', 'connor', 'dan', 'glenda', 'hugh', 'jordan', 'kirby', 'lance', 'margaret', 'mike',
        'pedagog', 'rainbow', 'susan', 'tiki', 'tongtyed', 'tux', 'veronica', 'waf', 'xeno']
# Bolo, Cro, Denise and Lynnea exist in both folders; the art pack versions have more poses.
PACK = ['bolo', 'cro', 'denise', 'lynnea', 'sage', 'rebecca', 'scotty', 'kwensa', 'maynard', 'kevin']
# Two drawings exist only in the main-folder versions; they are added to the art pack sets.
# name: (record list, image offset inside comicart/<name>.avb)
EXTRAS = {'cro': ('faces', 28262), 'lynnea': ('torsos', 86881)}
BACKDROPS = [('field', 'Field'), ('pastoral', 'Garden'), ('room', 'Parlor'), ('den', 'Den'), ('buckroom', 'Bedroom'),
             ('clouds', 'Clouds'), ('space', 'Space'), ('volcano', 'Volcano'), ('yellow', 'Lemon')]


def pose_rgba(a, rec):
    """Decode one drawing to RGBA. Aura pixels (the white halo) become opaque white."""
    d, adj = a['d'], a['adj']
    offs = [o + adj if o else 0 for o in rec['off']]
    w, h, bpp, pal, rows = read_image(d, offs[0], rec['fmt'][0], rec['pt'][0], a['pal'])
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = im.load()
    if rec['pt'][0] == 4:      # masked mono: 0 clear, 1 aura, 2 white, 3 black
        for y in range(h):
            for x in range(w):
                v = rows[y][x]
                if v == 3: px[x, y] = (0, 0, 0, 255)
                elif v: px[x, y] = (255, 255, 255, 255 if v == 2 else 254)
    else:
        mrows = None
        if offs[1]:
            mw, mh, _, _, mrows = read_image(d, offs[1], rec['fmt'][1], rec['pt'][1], a['pal'])
            if (mw, mh) != (w, h): mrows = None
        for y in range(h):
            for x in range(w):
                c = pal[rows[y][x]] if bpp <= 8 else rows[y][x]
                m = mrows[y][x] if mrows else 0
                mask, aura = (m & 1, m >> 1) if rec['pt'][1] == 5 else (m, 0)
                if mask or c != (255, 255, 255): px[x, y] = c + (255,)
                elif aura: px[x, y] = (255, 255, 255, 254)
    return im


def load(path):
    a = parse(path); cache = {}
    for kind in ('faces', 'torsos', 'bodies'):
        for r in a[kind]:
            key = r['off'][0]
            if key not in cache: cache[key] = pose_rgba(a, r)
            r['img'] = key
    a['imgs'] = cache
    return a


def load_with_extras(root, folder, name):
    a = load(f'{root}/{folder}/{name}.avb')
    if name in EXTRAS and folder == 'artpack1':
        kind, img = EXTRAS[name]; other = load(f'{root}/comicart/{name}.avb'); key = ('main', img)
        a['imgs'][key] = other['imgs'][img]
        a[kind] += [dict(r, img=key) for r in other[kind] if r['img'] == img]
    return a


def smooth(mask):
    """A 1-bit mask, redrawn at 2x with clean anti-aliased edges."""
    im = Image.fromarray((mask * 255).astype('uint8'))
    big = im.resize((im.width * 8, im.height * 8), Image.NEAREST).filter(ImageFilter.GaussianBlur(4.2))
    big = big.point(lambda v: 255 if v >= 128 else 0)
    return np.asarray(big.resize((im.width * SCALE, im.height * SCALE), Image.LANCZOS)).astype('float32') / 255


def upscale(im):
    a = np.asarray(im); alpha = a[..., 3] > 0; rgb = a[..., :3].astype(int)
    gray = (abs(rgb[..., 0] - rgb[..., 1]) < 12) & (abs(rgb[..., 1] - rgb[..., 2]) < 12)
    mono = bool((gray | ~alpha).all()) and len(np.unique(rgb[alpha][:, 0])) <= 3 if alpha.any() else True
    A = smooth(alpha)
    if mono:
        K = smooth(alpha & (rgb[..., 0] < 128))
        g = (255 * (1 - K)).clip(0, 255).astype('uint8'); al = (255 * np.maximum(A, K)).clip(0, 255).astype('uint8')
        return Image.merge('LA', (Image.fromarray(g), Image.fromarray(al))).convert('RGBA'), True
    colour = Image.fromarray(a[..., :3]).resize((im.width * SCALE, im.height * SCALE), Image.BICUBIC)
    return Image.fromarray(np.dstack([np.asarray(colour), (A * 255).astype('uint8')]), 'RGBA'), False


def build_character(root, folder, name, art_dir):
    a = load_with_extras(root, folder, name)
    ids = list(a['imgs']); ims = {}; mono = True
    for k in ids:
        ims[k], m = upscale(a['imgs'][k]); mono &= m
    # shelf-pack the drawings into one sheet
    W, x, y, rowh, pad, pos = 2048, 0, 0, 0, 2, {}
    for k in sorted(ids, key=lambda k: -ims[k].height):
        im = ims[k]
        if x + im.width + pad > W: x = 0; y += rowh + pad; rowh = 0
        pos[k] = (x, y); x += im.width + pad; rowh = max(rowh, im.height)
    sheet = Image.new('RGBA', (max(pos[k][0] + ims[k].width for k in ids), y + rowh), (0, 0, 0, 0))
    for k in ids: sheet.paste(ims[k], pos[k])
    sheet = sheet.quantize(colors=24 if mono else 255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    sheet.save(f'{art_dir}/{name}.png', optimize=True)
    # measure each drawing as saved: inked bounds, and where its visual weight sits (centres the face thumbnails)
    alpha = np.asarray(sheet.convert('RGBA').getchannel('A'))
    rects = [[pos[k][0], pos[k][1], ims[k].width, ims[k].height] for k in ids]; bb = []; cm = []
    for x0, y0, w, h in rects:
        s = alpha[y0:y0 + h, x0:x0 + w]
        box = Image.fromarray(s).point(lambda v: 255 if v > 40 else 0).getbbox() or (0, 0, w, h)
        bb.append([box[0], box[1], box[2] - box[0], box[3] - box[1]])
        f = s.astype('float32') / 255; tot = f.sum() or 1; ys, xs = np.mgrid[0:h, 0:w]
        cx = (f * xs).sum() / tot; cy = (f * ys).sum() / tot
        cm.append([round(float(cx), 1), round(float(cy), 1), round(float(np.sqrt((f * ((xs - cx) ** 2 + (ys - cy) ** 2)).sum() / tot)), 1)])
    idx = {k: i for i, k in enumerate(ids)}
    meta = dict(id=name, name=NAMES.get(name, a['name'].title()), flags=a.get('flags', 0), mono=mono, im=rects,
                f=[[idx[r['img']], r['em'], r['inten'], r['cx'], r['cy'], r['dx'], r['dy'], r['x'], r['y']] for r in a['faces']],
                t=[[idx[r['img']], r['em'], r['inten'], r['cx'], r['cy']] for r in a['torsos']],
                b=[[idx[r['img']], r['em'], r['inten'], r['x'], r['y']] for r in a['bodies']], bb=bb, cm=cm)
    # portrait: the neutral head, or the top of a one-piece body
    if a['type'] == 2:
        face = ims[next((r for r in a['faces'] if r['em'] == 9), a['faces'][0])['img']]
    else:
        face = ims[next((r for r in a['bodies'] if r['em'] == 9), a['bodies'][0])['img']]
        face = face.crop((0, 0, face.width, min(face.height, face.width)))
    face = face.crop(face.getbbox()); side = max(face.size); sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(face, ((side - face.width) // 2, (side - face.height) // 2))
    return meta, sq.resize((112, 112), Image.LANCZOS)


def read_backdrop(path):
    d = open(path, 'rb').read(); s = Stream(d); s.r('HHH'); adj = 0
    while True:
        tag = s.r('H'); size = s.r('H')
        if tag == 263: adj += s.r('i')
        elif tag == 258:
            off, fmt, pt = s.r('IBB')
            w, h, bpp, pal, rows = read_image(d, off + adj, fmt, pt, None)
            im = Image.new('RGB', (w, h)); im.putdata([(pal[v] if bpp <= 8 else v) for r in rows for v in r])
            return im
        elif tag in (259, 260, 261): s.cstr()
        else: s.p += size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', required=True, help='path to a clone of microsoft/comic-chat')
    ap.add_argument('--out', default='.', help='site folder to write art/ and manifest.js into')
    args = ap.parse_args()
    root = os.path.join(args.source, VERSION); art = os.path.join(args.out, 'art'); os.makedirs(art, exist_ok=True)
    chars, faces = [], []
    for name, folder in [(n, 'comicart') for n in MAIN] + [(n, 'artpack1') for n in PACK]:
        meta, face = build_character(root, folder, name, art); chars.append(meta); faces.append(face)
        print(f"{name:10} {meta['name']:12} {len(meta['im']):3} drawings  {os.path.getsize(f'{art}/{name}.png') // 1024} KB")
    sprite = Image.new('RGBA', (112 * 8, 112 * 4), (0, 0, 0, 0))      # app.css expects an 8 x 4 grid, in this order
    for i, f in enumerate(faces): sprite.paste(f, ((i % 8) * 112, (i // 8) * 112))
    sprite.save(f'{art}/faces.png', optimize=True)
    for bid, _ in BACKDROPS:
        folder = 'comicart' if os.path.exists(f'{root}/comicart/{bid}.bgb') else 'artpack1'
        im = read_backdrop(f'{root}/{folder}/{bid}.bgb'); s = min(im.size)
        im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2))
        im.resize((630, 630), Image.LANCZOS).save(f'{art}/bg-{bid}.jpg', quality=84, optimize=True)
    manifest = dict(scale=SCALE, chars=chars, bgs=[dict(id=b, name=n) for b, n in BACKDROPS])
    with open(os.path.join(args.out, 'manifest.js'), 'w') as fh:
        fh.write('window.FP_ART=' + json.dumps(manifest, separators=(',', ':')) + ';')
    print(f'{len(chars)} characters, {len(BACKDROPS)} backdrops written to {args.out}')


if __name__ == '__main__':
    main()
