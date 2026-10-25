#!/usr/bin/env python3
"""生成「随身WiFi」App 图标。

设计：深蓝底(#0d1322→#1b2440) + 绿到蓝渐变(#34d399→#60a5fa)的 WiFi 扇形波纹，
      与仪表盘页面的配色一致。
用法：python3 make_icon.py      # 输出到 android/res/mipmap-*/ 与 public/icon.png
"""
import math
import os
import shutil

from PIL import Image, ImageDraw, ImageFilter

S = 4096                      # 超采样画布，最后缩到各密度
BG_TOP = (13, 19, 34)         # --bg   #0d1322
BG_BOT = (27, 36, 64)         # --card2 #1b2440
GLYPH_TOP = (52, 211, 153)    # --good  #34d399
GLYPH_BOT = (96, 165, 250)    # --blue  #60a5fa

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "res")
PUBLIC = os.path.join(HERE, "..", "..", "public")

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def vgrad(size, top, bot):
    """竖向线性渐变"""
    strip = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        strip.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return strip.resize((size, size), Image.BICUBIC)


def background():
    bg = vgrad(S, BG_TOP, BG_BOT)
    # 顶部极淡的白色柔光，避免纯色呆板（不要用主题色，否则背景会发绿发脏）
    glow = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(glow)
    r = int(S * 0.46)
    cx, cy = int(S * 0.5), int(S * 0.22)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=26)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.13))
    return Image.composite(Image.new("RGB", (S, S), (255, 255, 255)), bg, glow)


def wifi_glyph(scale=1.0):
    """WiFi 扇形：三层圆弧 + 底部圆点，等比缩放"""
    m = Image.new("L", (S, S), 0)
    g = ImageDraw.Draw(m)
    cx, cy = S * 0.5, S * 0.655
    stroke = S * 0.058 * scale
    for k in (0.160, 0.285, 0.410):
        r = S * k * scale
        g.arc([cx - r, cy - r, cx + r, cy + r], start=222, end=318,
              fill=255, width=int(stroke))
        for ang in (222, 318):                       # 圆头端点
            a = math.radians(ang)
            rr = r - stroke / 2
            x, y = cx + rr * math.cos(a), cy + rr * math.sin(a)
            g.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=255)
    dr = S * 0.050 * scale
    g.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=255)
    return m


def build(round_icon=False):
    bg = background()
    grad = vgrad(S, GLYPH_TOP, GLYPH_BOT)
    glyph = wifi_glyph(0.94 if round_icon else 1.0)
    # 波纹边缘极淡外发光，深底上更立体
    halo = glyph.filter(ImageFilter.GaussianBlur(S * 0.018)).point(lambda v: int(v * 0.30))
    img = Image.composite(Image.new("RGB", (S, S), GLYPH_TOP), bg, halo)
    img = Image.composite(grad, img, glyph)

    if round_icon:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
    else:
        mask = Image.new("L", (S, S), 0)
        rad = int(S * 0.225)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=rad, fill=255)

    out = img.convert("RGBA")
    out.putalpha(mask)

    # 内描边，浅色底上也能分辨边界
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    w = int(S * 0.005)
    if round_icon:
        rd.ellipse([w, w, S - 1 - w, S - 1 - w], outline=(255, 255, 255, 26), width=w)
    else:
        rd.rounded_rectangle([w, w, S - 1 - w, S - 1 - w], radius=int(S * 0.225) - w,
                             outline=(255, 255, 255, 26), width=w)
    return Image.alpha_composite(out, rim)


def main():
    square = build(False)
    round_ = build(True)

    for dpi, size in DENSITIES.items():
        d = os.path.join(RES, "mipmap-" + dpi)
        os.makedirs(d, exist_ok=True)
        square.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
        round_.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher_round.png"))
        t = square.resize((size, size), Image.LANCZOS)
        t.save(os.path.join(d, "ic_launcher.png"), optimize=True)

    os.makedirs(PUBLIC, exist_ok=True)
    square.resize((1024, 1024), Image.LANCZOS).save(os.path.join(PUBLIC, "icon.png"))
    square.resize((180, 180), Image.LANCZOS).save(os.path.join(PUBLIC, "apple-touch-icon.png"))
    print("icon done:", sorted(os.listdir(RES)))


if __name__ == "__main__":
    main()
