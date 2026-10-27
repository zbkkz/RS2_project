# generate_brand.py
"""一次性工具脚本：生成首页顶端「Hi.cut」**枯笔手写艺术字**品牌标素材。

与登录页标题（`generate_title.py`：果冻气泡字，浮在紫色方块下方）刻意区分风格：
这里按用户提供的参考图做「枯笔 / 马克笔手写连笔字 + 双色」（前半段深藏青蓝、
后半段玫粉），输出 `frontend/assets/brand/brand.png`（横向透明 PNG）。

硬要求：**必须横向单行**。首页头部高度锁定 88rpx（登录页转场飞行的落点公式依赖它），
竖排/换行会把品牌头撑变形，所以提示词里明确禁止竖排，且成品本身是一张图
（`<image>` 渲染，天然不可能换行）。

流程：百炼文生图（纯白背景）→ 边缘泛洪填充去白底 → 剔除字母内腔的封闭白块
→ 按 alpha 裁边留白 → 缩到头部用尺寸 → 输出 PNG。可重复执行。
依赖 `generate_floats.py` 的配置读取（backend/.env）。
"""
import os
import sys

import requests
from PIL import Image, ImageDraw, ImageFilter

from generate_floats import load_env

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "frontend", "assets", "brand"))

# 注意：素材脚本是**文生图**（payload 里只有 text），与 app 的图像编辑模型不能共用一个变量
# （见 generate_floats.load_env 的说明），故仍用 AI_T2I_MODEL。
PROMPT = (
    "艺术字 \"Hi.cut\"，马克笔枯笔手写英文连笔字，笔画带干枯飞白的笔触质感，"
    "颜色为双色：前半段字母深藏青蓝色，后半段（含点号）玫粉色，"
    "**整行文字横向水平排列在同一基线上，单行不换行、不竖排**，"
    "笔画略向右上倾斜、有书法韵味，孤立在纯白色背景上，"
    "背景干净纯白均匀，无阴影、无倒影、无其他元素"
)

# 与 generate_floats.gen_image_url 的区别只有负向词：那里的「文字」会把艺术字一起压掉，
# 这里反过来要禁止竖排/多行/错字。
NEGATIVE = "低质量、模糊、变形、噪点、阴影、倒影、多个物体、竖排、多行、换行、乱码、错别字、重复字母"


def gen_image_url(key, base, model, prompt):
    """调用百炼多模态生成接口（文生图），返回结果图 URL。"""
    payload = {
        "model": model,
        "input": {"messages": [{"role": "user", "content": [{"text": prompt}]}]},
        "parameters": {
            "negative_prompt": NEGATIVE,
            "watermark": False,
            # 方形画布 + 提示词里的「横向单行」= 参考图那种宽扁的居中艺术字；
            # 出图后按 alpha 裁边，方形画布里的空白不会留在成品里
            "size": "1024*1024",
        },
    }
    resp = requests.post(
        f"{base}/services/aigc/multimodal-generation/generation",
        json=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        timeout=(10, 180),
    )
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    content = resp.json()["output"]["choices"][0]["message"]["content"]
    for part in content:
        if part.get("image"):
            return part["image"]
    raise RuntimeError("响应中没有图片")


def remove_white_bg(im, max_edge=1024, seed_min=238, thresh=40):
    """从边缘泛洪填充纯白背景为透明。

    ⚠️ 与 `generate_floats.remove_white_bg` 的关键差异：**缩放保持宽高比**。
    那把实现固定缩到 512×512，横向艺术字会被压扁（首版就踩了这个坑）。
    """
    im = im.convert("RGB")
    im.thumbnail((max_edge, max_edge), Image.LANCZOS)
    w, h = im.size
    magenta = (255, 0, 255)
    px = im.load()
    seeds = [(x, 0) for x in range(0, w, 6)] + [(x, h - 1) for x in range(0, w, 6)]
    seeds += [(0, y) for y in range(0, h, 6)] + [(w - 1, y) for y in range(0, h, 6)]
    for sx, sy in seeds:
        r, g, b = px[sx, sy]
        if r > seed_min and g > seed_min and b > seed_min:
            ImageDraw.floodfill(im, (sx, sy), magenta, thresh=thresh)
    alpha = Image.new("L", (w, h), 255)
    apx = alpha.load()
    for yy in range(h):
        for xx in range(w):
            if px[xx, yy] == magenta:
                apx[xx, yy] = 0
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def drop_white_areas(im, white_min=242):
    """把接近纯白的像素一并置透明。

    字母内腔（c / e / o 的封闭白块）与边缘泛洪不连通，光靠泛洪会留下一块块白斑 ——
    在首页紫色渐变背景上会像贴了一层白纸。阈值取 242 是为了不误伤玫粉（G 通道约 150）。
    """
    px = im.load()
    w, h = im.size
    for yy in range(h):
        for xx in range(w):
            r, g, b, a = px[xx, yy]
            if a > 0 and r >= white_min and g >= white_min and b >= white_min:
                px[xx, yy] = (r, g, b, 0)
    return im


def smooth_alpha(im, blur=0.6, cut=40):
    """羽化 alpha 边缘，抹掉泛洪/阈值留下的一像素锯齿。"""
    alpha = im.split()[3].filter(ImageFilter.GaussianBlur(blur))
    alpha = alpha.point(lambda v: 0 if v < cut else v)
    im.putalpha(alpha)
    return im


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    key, base, model = load_env()
    url = None
    last_err = None
    for _ in range(2):  # 失败重试 1 次
        try:
            print("[gen] brand ...", flush=True)
            url = gen_image_url(key, base, model, PROMPT)
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    if not url:
        raise last_err
    raw = requests.get(url, timeout=(10, 60)).content
    raw_path = os.path.join(OUT_DIR, "_raw_brand.png")
    with open(raw_path, "wb") as f:
        f.write(raw)
    im = Image.open(raw_path)
    im = remove_white_bg(im)
    im = drop_white_areas(im)
    im = smooth_alpha(im)
    bbox = im.split()[3].getbbox()
    if bbox:
        pad = 8
        l = max(0, bbox[0] - pad)
        t = max(0, bbox[1] - pad)
        r = min(im.width, bbox[2] + pad)
        b = min(im.height, bbox[3] + pad)
        im = im.crop((l, t, r, b))
    # 头部展示高度 68rpx（≈34px 逻辑像素），输出高度 ~200px 供 3 倍屏清晰使用；
    # 只限高不限宽，横向比例原样保留
    im.thumbnail((1200, 200), Image.LANCZOS)
    out_path = os.path.join(OUT_DIR, "brand.png")
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(
        out_path, optimize=True
    )
    os.remove(raw_path)
    print(f"[ok] brand -> {out_path} size={im.size}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
