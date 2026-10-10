#!/usr/bin/env python3
"""明路 · Akari 的美术资产工厂。

母题就一句话：**夜色棋盘上的一盏灯**。它同时也就是玩法本身——灯沿直线照亮整条
走廊，墙会挡光，墙上的数字写着它四邻放了几盏灯。所以图标不必另编象征，把盘面如实
画出来就是最好的品牌资产。

配色不凭空发明：全部取自 js/theme.js 的 Palette（同一张 token 表），美术与代码因此
不会长成两个样子。被照亮的格由 js/engine 的规则算出（LitMap），不是凭手感挑几个格
涂色——图标里的光和游戏里的光是同一条规矩。

可复现性：只用 Pillow + 标准库；随机源是自己实现的 LCG；同一命令重复跑产出逐字节
相同的 PNG（`--verify` 就把这条实测出来）。文字类资产（数字与 og 卡）依赖盘面上的
CJK 字体，实际用哪一支会记进 assets/gen/art-manifest.json。

用法:
    python3 assets/gen/make_art.py            # 产出全部资产
    python3 assets/gen/make_art.py --verify   # 重算并比对盘上字节
"""
import hashlib
import io
import json
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# --- Palette 的镜像（js/theme.js:5） ---------------------------------------------------
BG_TOP = (8, 11, 22)
BG_BOTTOM = (19, 26, 46)
SURFACE = (16, 22, 39)
SURFACE_LIFT = (24, 32, 54)
LINE = (36, 48, 80)
LINE_HEAVY = (58, 74, 114)
INK = (242, 245, 251)
UNLIT = (43, 58, 94)
LAMP = (255, 200, 92)
LAMP_EDGE = (255, 227, 166)
ERROR = (255, 92, 122)
LAMP_DEEP = (193, 134, 27)
NUMBERS = [(154, 166, 196), (123, 184, 255), (61, 220, 145), (255, 200, 92), (255, 92, 122)]

GRID = 5
# (col, row) -> 线索。四个数字各演一条规则：0 禁四邻、1 逼一条线、2 收角、3 挤到只剩一种摆法。
WALLS = {(1, 0): 2, (3, 2): 1, (0, 3): 3, (2, 4): 0}
LAMPS = [(2, 2), (0, 4)]
CROSSES = [(4, 0), (1, 2)]
SEED = 20260930

# (path, ttc index) —— 粗体位优先；没有 CJK 就只剩拉丁，标题会退化成 AKARI。
FONT_FACES = [
    ('/System/Library/Fonts/Hiragino Sans GB.ttc', 2, True),
    ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0, True),
    ('/System/Library/Fonts/Supplemental/Songti.ttc', 1, True),
    ('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 0, True),
    ('/System/Library/Fonts/STHeiti Medium.ttc', 0, True),
    ('/System/Library/Fonts/Helvetica.ttc', 1, False),
]

_FACE = None
_FONTS = {}


def resolve_font():
    """挑一支真能画 CJK 的字体，并记下用了哪支——文字资产随字体而变，不能靠猜。"""
    global _FACE
    if _FACE is None:
        chosen = (None, 0, False)
        for path, idx, cjk in FONT_FACES:
            if not os.path.exists(path):
                continue
            try:
                f = ImageFont.truetype(path, 40, index=idx)
            except OSError:
                continue
            # 拉丁字体画 '明' 会得到一个 advance≈0 的空位，用它量出"这支到底有没有汉字"。
            if not cjk or f.getbbox('明路')[2] > 40:
                chosen = (path, idx, cjk)
                break
        _FACE = chosen
    return _FACE


def font(size=40):
    path, idx, cjk = resolve_font()
    if path is None:
        return ImageFont.load_default(), False
    key = size
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(path, size, index=idx)
    return _FONTS[key], cjk


def font_label():
    path, idx, cjk = resolve_font()
    if path is None:
        return 'PIL default (no CJK)'
    return f'{os.path.basename(path)}#{idx} cjk={cjk}'


def lcg(seed):
    """同一段随机在两台机器上给同一个序列——资产要能重算。"""
    state = seed & 0xFFFFFFFF

    def next_int():
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return state

    return next_int


def grain(size, amount, seed):
    """细颗粒：手绘夜色该有的质地。必须按目标尺寸逐像素算——放大一份 512 的噪声
    会在 1024 母图上留下 2px 周期的灯芯绒竖纹，那在深色底上比噪点本身难看得多。"""
    w, h = size
    nxt = lcg(seed)
    raw = bytes(nxt() % 256 for _ in range(w * h))
    # 稍微糊一下：逐像素的盐粒在浏览器把图标缩到 32–128px 时会摩尔纹成竖纹。
    noise = Image.frombytes('L', (w, h), raw).filter(ImageFilter.GaussianBlur(0.45))
    layer = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    layer.putalpha(noise.point(lambda v: min(255, int(amount * v / 255.0))))
    return layer


def vgrad(size, top, bottom):
    w, h = size
    g = Image.linear_gradient('L').resize((w, h))
    chans = []
    for c in range(3):
        ramp = bytes(int(round(top[c] + (bottom[c] - top[c]) * v / 255.0)) for v in range(256))
        chans.append(g.point(ramp, 'L'))
    return Image.merge('RGB', chans).convert('RGBA')


def radial(size, color, peak_alpha, power=2.2):
    """居中柔光斑：alpha 按 (1-r)^power 衰减，比两段线性插值更像灯而非靶心。"""
    w, h = size
    sw = min(w, 256)
    sh = min(h, 256)
    cx = cy = 0.5
    nxt_ramp = bytes(int(round(peak_alpha * max(0.0, 1.0 - i / 255.0) ** power)) for i in range(256))
    out = bytearray(sw * sh * 4)
    for y in range(sh):
        dy = (y + 0.5) / sh - cy
        for x in range(sw):
            dx = (x + 0.5) / sw - cx
            r = min(1.0, ((dx * dx + dy * dy) ** 0.5) / cx)
            a = nxt_ramp[int(r * 255)]
            o = (y * sw + x) * 4
            out[o:o + 4] = bytes((color[0], color[1], color[2], a))
    img = Image.frombytes('RGBA', (sw, sh), bytes(out))
    return img.resize((w, h), Image.BILINEAR) if (sw, sh) != (w, h) else img


def rounded(size, radius, color, alpha=255):
    w, h = size
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, w - 1, h - 1], radius, fill=color + (alpha,))
    return img


def masked(img, radius_frac):
    img.putalpha(rounded(img.size, img.size[0] * radius_frac, (0, 0, 0), 255).split()[3])
    return img


class LitMap:
    """按玩法算出哪些格被照亮（墙挡光）。图标与游戏共用这条规矩。"""

    def __init__(self):
        self.set = set()
        for col, row in LAMPS:
            self._shoot([(c, row) for c in range(col - 1, -1, -1)], [(col, r) for r in range(row - 1, -1, -1)],
                        [(c, row) for c in range(col + 1, GRID)], [(col, r) for r in range(row + 1, GRID)])
            self.set.add((col, row))

    def _shoot(self, *rays):
        for ray in rays:
            for cell in ray:
                if cell in WALLS:
                    break
                self.set.add(cell)

    def isin(self, cell):
        return cell in self.set


def beams(img, cell, ox, oy):
    """从每盏灯沿四条方向推到第一面墙，画出被照亮的走廊。

    画成"一条宽带 + 一条细芯"两层各自模糊，是因为整格铺满渐变会读成一团雾；
    而 Akari 的光是有方向的直线——方向本身就是这张图的信息量。
    """
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    lit = LIT

    def band(x0, y0, x1, y1, t, a, blur):
        sub = Image.new('RGBA', img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(sub)
        if y0 == y1:
            d.rectangle([x0, y0 - t / 2, x1, y0 + t / 2], fill=LAMP + (a,))
        else:
            d.rectangle([x0 - t / 2, y0, x0 + t / 2, y1], fill=LAMP + (a,))
        layer.alpha_composite(sub.filter(ImageFilter.GaussianBlur(blur)))

    for col, row in LAMPS:
        cx = ox + (col + 0.5) * cell
        cy = oy + (row + 0.5) * cell
        xs = [c for c in range(GRID) if lit.isin((c, row))]
        ys = [r for r in range(GRID) if lit.isin((col, r))]
        x0 = ox + min(xs) * cell
        x1 = ox + (max(xs) + 1) * cell
        y0 = oy + min(ys) * cell
        y1 = oy + (max(ys) + 1) * cell
        for (a_x0, a_y0, a_x1, a_y1) in ((x0, cy, x1, cy), (cx, y0, cx, y1)):
            if a_x0 == a_x1 and a_y0 == a_y1:
                continue
            band(a_x0, a_y0, a_x1, a_y1, cell * 0.30, 44, cell * 0.10)
            band(a_x0, a_y0, a_x1, a_y1, cell * 0.11, 112, cell * 0.03)
    img.alpha_composite(layer)


def cells(img, cell, ox, oy):
    d = ImageDraw.Draw(img, 'RGBA')
    for row in range(GRID):
        for col in range(GRID):
            if (col, row) in WALLS:
                continue
            x, y = ox + col * cell, oy + row * cell
            warm = LIT.isin((col, row))
            d.rectangle([x + 1, y + 1, x + cell - 1, y + cell - 1],
                        fill=(LAMP if warm else UNLIT) + (30 if warm else 62,))


def walls(img, cell, ox, oy, digits=True):
    d = ImageDraw.Draw(img, 'RGBA')
    for (col, row), clue in WALLS.items():
        x, y = ox + col * cell, oy + row * cell
        m = cell * 0.055
        tile = rounded((int(cell - 2 * m), int(cell - 2 * m)), cell * 0.16, BG_BOTTOM, 255)
        img.alpha_composite(tile, (int(x + m), int(y + m)))
        d.rounded_rectangle([x + m, y + m, x + cell - m, y + cell - m], cell * 0.16,
                            outline=LINE_HEAVY + (220,), width=max(1, int(cell * 0.022)))
        if not digits or cell < 26:
            continue
        f = font(int(cell * 0.52))[0]
        txt = str(clue)
        bb = d.textbbox((0, 0), txt, font=f)
        d.text((x + cell / 2 - (bb[2] - bb[0]) / 2 - bb[0],
                y + cell / 2 - (bb[3] - bb[1]) / 2 - bb[1]),
               txt, font=f, fill=NUMBERS[min(clue, 4)] + (255,))


def crosses(img, cell, ox, oy):
    """铅笔叉：它的意思是"这里放不下灯"，所以必须比线索安静。"""
    d = ImageDraw.Draw(img, 'RGBA')
    for col, row in CROSSES:
        x, y = ox + col * cell, oy + row * cell
        k = cell * 0.20
        cx, cy = x + cell / 2, y + cell / 2
        w = max(2, int(cell * 0.055))
        d.line([cx - k, cy - k, cx + k, cy + k], fill=INK + (96,), width=w)
        d.line([cx + k, cy - k, cx - k, cy + k], fill=INK + (96,), width=w)


def lamp(img, cx, cy, r, tint=LAMP, edge=LAMP_EDGE, halo_alpha=150):
    img.alpha_composite(radial((int(r * 6.4), int(r * 6.4)), tint, halo_alpha),
                        (int(cx - r * 3.2), int(cy - r * 3.2)))
    d = ImageDraw.Draw(img, 'RGBA')
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tint + (255,))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=edge + (255,), width=max(1, int(r * 0.16)))
    if r < 7:
        # 16px 上"高光"会盖掉整颗灯，只剩一个白方块。小图只留轮廓与光晕。
        return
    d.arc([cx - r, cy - r, cx + r, cy + r], 200, 300, fill=(255, 255, 255, 120),
          width=max(2, int(r * 0.16)))
    sr = r * 0.30
    d.ellipse([cx - r * 0.40 - sr, cy - r * 0.46 - sr, cx - r * 0.40 + sr, cy - r * 0.46 + sr],
              fill=(255, 255, 255, 190))
    d.ellipse([cx - r * 0.15, cy + r * 0.30, cx + r * 0.15, cy + r * 0.60], fill=LAMP_DEEP + (150,))


LIT = LitMap()


def render_board_layer(S, detail=True, bleed=0.74):
    span = S * bleed
    cell = span / GRID
    ox = (S - span) / 2
    oy = (S - span) / 2
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    frame = rounded((int(span * 1.14), int(span * 1.14)), span * 0.10, SURFACE, 236)
    img.alpha_composite(frame, (int(ox - span * 0.07), int(oy - span * 0.07)))

    cells(img, cell, ox, oy)
    beams(img, cell, ox, oy)

    d = ImageDraw.Draw(img, 'RGBA')
    lw = max(1, int(cell * 0.016))
    for i in range(GRID + 1):
        p = int(round(ox + i * cell))
        q = int(round(oy + i * cell))
        d.line([p, oy, p, oy + span], fill=LINE + (230,), width=lw)
        d.line([ox, q, ox + span, q], fill=LINE + (230,), width=lw)

    crosses(img, cell, ox, oy)
    walls(img, cell, ox, oy, digits=detail)
    for col, row in LAMPS:
        lamp(img, ox + (col + 0.5) * cell, oy + (row + 0.5) * cell,
             cell * (0.30 if detail else 0.36), halo_alpha=176 if detail else 200)
    return img


def render_icon(S, detail=True, bleed=0.74, radius_frac=0.225, bleed_bg=None):
    base = vgrad((S, S), (6, 9, 18), BG_BOTTOM)
    base.alpha_composite(radial((int(S * 1.5), int(S * 1.5)), LAMP, 38),
                         (int(-S * 0.25), int(-S * 0.25)))
    base.alpha_composite(render_board_layer(S, detail, bleed))
    if bleed_bg:
        outer = Image.new('RGBA', (S, S), bleed_bg + (255,))
        outer.alpha_composite(base)
        base = outer
    shade = radial((int(S * 1.5), int(S * 1.5)), (2, 3, 8), 112, power=1.9)
    base.alpha_composite(shade, (int(-S * 0.25), int(-S * 0.25)))
    base.alpha_composite(grain((S, S), 6, SEED))
    if radius_frac:
        masked(base, radius_frac)
    return base


def render_simple(S):
    """16/32px 专用：三格夜色 + 一盏居中的灯，横竖各推到头。

    这个尺寸上没有细节可言，只有"亮与暗的对比"立得住，所以把盘面从 5×5 收成 3×3、
    去掉墙与数字、把灯放大到占一格。
    """
    base = vgrad((S, S), (6, 9, 18), BG_BOTTOM)
    cell = S * 0.86 / 3
    ox = oy = (S - cell * 3) / 2
    d = ImageDraw.Draw(base, 'RGBA')
    d.rounded_rectangle([ox - cell * 0.1, oy - cell * 0.1, ox + cell * 3.1, oy + cell * 3.1],
                        cell * 0.32, fill=SURFACE + (255,))
    for i in range(4):
        p = ox + i * cell
        d.line([p, oy, p, oy + 3 * cell], fill=LINE + (255,), width=max(1, S // 24))
        q = oy + i * cell
        d.line([ox, q, ox + 3 * cell, q], fill=LINE + (255,), width=max(1, S // 24))
    warm = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    wd = ImageDraw.Draw(warm)
    t = max(2, cell * 0.34)
    wd.rectangle([ox, oy + cell, ox + 3 * cell, oy + 2 * cell], fill=LAMP + (58,))
    wd.rectangle([ox + cell, oy, ox + 2 * cell, oy + 3 * cell], fill=LAMP + (58,))
    base.alpha_composite(warm.filter(ImageFilter.GaussianBlur(max(0.5, S * 0.008))))
    lamp(base, ox + 1.5 * cell, oy + 1.5 * cell, cell * 0.40, halo_alpha=200)
    base.alpha_composite(grain((S, S), 5, SEED))
    return masked(base, 0.24)


def render_og(W=1200, H=630):
    img = vgrad((W, H), (6, 9, 18), BG_BOTTOM)
    img.alpha_composite(radial((int(H * 1.7),) * 2, LAMP, 44),
                        (int(W * 0.74 - H * 0.85), int(H * 0.5 - H * 0.85)))
    art = render_icon(int(H * 0.76), detail=True, radius_frac=0.20)
    img.alpha_composite(art, (int(W * 0.745 - art.size[0] / 2), int(H / 2 - art.size[1] / 2)))
    img.alpha_composite(radial((int(H * 1.15),) * 2, (2, 3, 8), 108, power=1.9),
                        (int(-H * 0.2), int(-H * 0.27)))
    d = ImageDraw.Draw(img, 'RGBA')
    d.line([0, H - 3, W, H - 3], fill=LAMP + (200,), width=4)

    f_title, cjk = font(int(H * 0.21))
    f_sub, _ = font(int(H * 0.072))
    f_body, _ = font(int(H * 0.050))
    title = '明路' if cjk else 'AKARI'
    d.text((70, H * 0.14), title, font=f_title, fill=INK + (255,))
    tw = d.textbbox((0, 0), title, font=f_title)
    d.text((70, H * 0.14 + (tw[3] - tw[1]) + H * 0.05),
           'AKARI · 灯塔推理' if cjk else 'AKARI · LIGHT-UP LOGIC', font=f_sub, fill=LAMP + (255,))
    y = H * 0.60
    for line in ('每局唯一解', '每局都能用逻辑推到底', '提示只给可推导的格'):
        d.ellipse([70, y + H * 0.016, 70 + H * 0.019, y + H * 0.035], fill=LAMP + (255,))
        d.text((70 + H * 0.048, y), line, font=f_body, fill=INK + (205,))
        y += H * 0.074
    d.rounded_rectangle([70, H * 0.895, 70 + H * 0.66, H * 0.895 + H * 0.070], H * 0.035,
                        fill=SURFACE_LIFT + (255,), outline=LINE_HEAVY + (255,))
    d.text((70 + H * 0.032, H * 0.905), '五档难度 · 六条铅笔规则 · 零猜测', font=f_body,
           fill=INK + (215,))
    img.alpha_composite(grain((W, H), 6, SEED + 7))
    return img


# --- 游戏内位图 -------------------------------------------------------------------------

def tex_night_field(S=512):
    """可平铺的夜色底纹：极淡的 4 格网格 + 颗粒，铺在页面与棋盘下面当"纸"。"""
    img = vgrad((S, S), (10, 14, 26), (16, 22, 39))
    d = ImageDraw.Draw(img, 'RGBA')
    step = S / 4
    for i in range(4):
        p = int(round(i * step))
        d.line([p, 0, p, S], fill=LINE + (30,), width=1)
        d.line([0, p, S, p], fill=LINE + (30,), width=1)
    img.alpha_composite(grain((S, S), 5, SEED + 11))
    return img


def tex_halo(S=256, tint=LAMP, peak=118, power=2.0):
    return radial((S, S), tint, peak, power=power)


def tex_spark(S=64):
    """粒子贴图：一个十字亮芯。放灯那一下与收官的光雨共用它。"""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, 'RGBA')
    c = S / 2
    w = max(1, int(S * 0.07))
    d.line([c, S * 0.06, c, S * 0.94], fill=(255, 240, 210, 160), width=w)
    d.line([S * 0.06, c, S * 0.94, c], fill=(255, 240, 210, 160), width=w)
    img.alpha_composite(radial((S, S), (255, 236, 196), 235, power=2.8))
    return img


def png_dims(data):
    """读 IHDR 宽高：自检用，证明落到盘上的是真位图而不是 0 字节占位。"""
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    return struct.unpack('>II', data[16:24])


def main():
    verify = '--verify' in sys.argv
    jobs = [
        ('icons/icon-1024.png', render_icon(1024)),
        ('icons/icon-512.png', render_icon(512)),
        ('icons/icon-192.png', render_icon(192)),
        ('icons/icon-96.png', render_icon(96)),
        ('icons/icon-48.png', render_icon(48)),
        ('icons/apple-touch-icon.png', render_icon(180, radius_frac=0.0, bleed_bg=BG_TOP)),
        ('icons/icon-maskable-512.png', render_icon(512, bleed=0.56, radius_frac=0.0, bleed_bg=BG_TOP)),
        # 小尺寸另画一张：16/32px 上留墙、数字和铅笔叉只会糊成一团黑，
        # 能立住的只有"一盏灯 + 一个十字光"。
        ('icons/favicon-32.png', render_simple(32)),
        ('icons/favicon-16.png', render_simple(16)),
        ('assets/og/akari-og-1200x630.png', render_og()),
        ('assets/textures/night-field.png', tex_night_field()),
        ('assets/textures/lamp-halo.png', tex_halo()),
        ('assets/textures/lamp-halo-bad.png', tex_halo(tint=ERROR, peak=108)),
        ('assets/textures/spark.png', tex_spark()),
    ]

    manifest = {'generator': 'assets/gen/make_art.py', 'seed': SEED, 'font': font_label(),
                'pillow': __import__('PIL').__version__, 'files': {}}
    bad = 0
    for rel, img in jobs:
        buf = io.BytesIO()
        img.save(buf, 'PNG', optimize=True)
        data = buf.getvalue()
        path = os.path.join(REPO, rel)
        w, h = png_dims(data)
        digest = hashlib.sha256(data).hexdigest()
        assert (w, h) == img.size, f'{rel}: IHDR {w}x{h} != {img.size}'
        assert len(data) > 200, f'{rel}: 疑似空图'
        manifest['files'][rel] = {'w': w, 'h': h, 'bytes': len(data), 'sha256': digest}
        if verify:
            old = open(path, 'rb').read() if os.path.exists(path) else b''
            same = hashlib.sha256(old).hexdigest() == digest
            bad += 0 if same else 1
            print(f'{"SAME" if same else "DIFF"}\t{rel}\t{w}x{h}\t{len(data)}B')
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as fh:
            fh.write(data)
        print(f'{rel}\t{w}x{h}\t{len(data)}B\tsha256:{digest[:12]}')

    mpath = os.path.join(REPO, 'assets', 'gen', 'art-manifest.json')
    if verify:
        on_disk = json.load(open(mpath, encoding='utf-8')) if os.path.exists(mpath) else {}
        if on_disk.get('files') != manifest['files']:
            bad += 1
            print('DIFF\tassets/gen/art-manifest.json')
        print(f'字体：{manifest["font"]}  Pillow {manifest["pillow"]}  ⇒ '
              + ('全部 SAME：盘上资产可逐字节重算' if bad == 0 else f'{bad} 项与盘上不一致'))
        sys.exit(1 if bad else 0)
    with open(mpath, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write('\n')
    print(f'assets/gen/art-manifest.json\t{len(jobs)} 项\tfont={manifest["font"]}')


if __name__ == '__main__':
    main()
