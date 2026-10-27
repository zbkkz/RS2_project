# generate_title.py
"""一次性工具脚本：生成登录页 "Hi.cut" 标题艺术字素材。

文字带白色描边（与纯白背景无法分离），故生成深蓝底版本后抠除深色背景，
保留字体渐变与描边，输出 frontend/assets/floats/title.png（横向透明 PNG）。
依赖 generate_floats.py 中的百炼调用与配置读取。
"""
import os
import sys

import requests
from PIL import Image, ImageDraw, ImageFilter

from generate_floats import load_env, gen_image_url, OUT_DIR

PROMPT = (
    "艺术字 \"Hi.cut\"，圆润可爱的气泡手写连笔英文字体，糖果果冻玻璃质感，"
    "字母填充为淡蓝色到淡粉色的柔和渐变，带白色描边与高光光泽，"
    "孤立在纯深蓝色背景上，背景均匀纯色，无渐变、无发光、无其他元素"
)


def remove_dark_bg(im, seed_max=95, thresh=48):
    """从边缘泛洪填充深色背景为透明（保留浅色文字与白色描边）。"""
    im = im.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    w, h = im.size
    magenta = (255, 0, 255)
    px = im.load()
    seeds = [(x, 0) for x in range(0, w, 8)] + [(x, h - 1) for x in range(0, w, 8)]
    seeds += [(0, y) for y in range(0, h, 8)] + [(w - 1, y) for y in range(0, h, 8)]
    for sx, sy in seeds:
        r, g, b = px[sx, sy]
        if r < seed_max and g < seed_max and b < seed_max + 40:
            ImageDraw.floodfill(im, (sx, sy), magenta, thresh=thresh)
    alpha = Image.new("L", (w, h), 255)
    apx = alpha.load()
    for yy in range(h):
        for xx in range(w):
            if px[xx, yy] == magenta:
                apx[xx, yy] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))
    alpha = alpha.point(lambda v: 0 if v < 40 else v)
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def clean_dark_holes(im, dark_max_r=110, dark_max_g=120, dark_max_b=165):
    """清除抠图后残留的深色孤岛（如字母内腔），这些区域泛洪无法从边缘到达。"""
    w, h = im.size
    px = im.load()
    for yy in range(h):
        for xx in range(w):
            r, g, b, a = px[xx, yy]
            if a > 0 and r < dark_max_r and g < dark_max_g and b < dark_max_b and b >= r:
                px[xx, yy] = (r, g, b, 0)
    alpha = im.split()[3].filter(ImageFilter.GaussianBlur(0.8))
    alpha = alpha.point(lambda v: 0 if v < 40 else v)
    im.putalpha(alpha)
    return im


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    key, base, model = load_env()
    url = None
    last_err = None
    for _ in range(2):
        try:
            print("[gen] title ...", flush=True)
            url = gen_image_url(key, base, model, PROMPT)
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    if not url:
        raise last_err
    raw = requests.get(url, timeout=(10, 60)).content
    raw_path = os.path.join(OUT_DIR, "_raw_title.png")
    with open(raw_path, "wb") as f:
        f.write(raw)
    im = Image.open(raw_path)
    im = remove_dark_bg(im)
    im = clean_dark_holes(im)
    bbox = im.split()[3].getbbox()
    if bbox:
        pad = 14
        l = max(0, bbox[0] - pad)
        t = max(0, bbox[1] - pad)
        r = min(im.width, bbox[2] + pad)
        b = min(im.height, bbox[3] + pad)
        im = im.crop((l, t, r, b))
    im.thumbnail((900, 900), Image.LANCZOS)
    out_path = os.path.join(OUT_DIR, "title.png")
    im = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    im.save(out_path, optimize=True)
    os.remove(raw_path)
    print(f"[ok] title -> {out_path} size={im.size}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
