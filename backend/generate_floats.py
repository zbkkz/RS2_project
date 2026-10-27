# generate_floats.py
"""一次性工具脚本：生成登录页 12 个漂浮物品素材。

流程：调用百炼 qwen-image 文生图（纯白背景物品图）→ 边缘泛洪填充去白底
→ 裁剪并居中到 480x480 透明画布 → 输出 frontend/assets/floats/*.png。
配置读取 backend/.env，可重复执行。
"""
import os
import re
import sys

import requests
from PIL import Image, ImageDraw, ImageFilter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "frontend", "assets", "floats"))

ITEMS = {
    "fox": "一只站立的红狐狸，全身侧面照",
    "dress": "木质衣架上挂着一条碎花夏季连衣裙",
    "robin": "一只可爱的知更鸟，橙色胸脯",
    "succulent": "白色陶瓷小花盆里的一株绿色多肉植物",
    "butterfly": "一只展开翅膀的蝴蝶，俯视角度",
    "mug": "一个米色陶瓷马克杯",
    "swan": "一只优雅的白天鹅，侧面",
    "jacket": "一件浅蓝色牛仔夹克，平铺展示",
    "monstera": "陶土花盆里的一盆龟背竹",
    "sneakers": "一双红色高帮帆布鞋",
    "cone": "一个橙白相间条纹的交通锥",
    "skateboard": "一块彩色滑板，侧面视角",
}

PROMPT_TMPL = (
    "{item}，单个物品，画面居中，贴纸风格，孤立在纯白色背景上，"
    "背景干净纯白均匀，无阴影，无倒影，无其他物体，产品摄影，高清，真实感"
)


def load_env():
    env = {}
    with open(os.path.join(BASE_DIR, ".env"), encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$", line)
            if m:
                env[m.group(1)] = m.group(2)
    # 注意：素材脚本是**文生图**（payload 里只有 text），而 app 的 AI_MODEL 指向的是
    # **指令编辑模型**（必须有图片输入）。两者不能共用一个变量，否则换个模型就会把脚本打挂
    # （实测用编辑模型发纯文本请求会直接 400：content parameter's length invalid）。
    # 因此脚本认 AI_T2I_MODEL，缺省回落到文生图模型。
    #
    # 全部用 `env.get(...) or 默认值`：`.env` 里写成 `AI_API_BASE=`（留空）时，本文件的解析
    # 正则根本不会匹配到该行（值不能为空），直接 `env["AI_API_BASE"]` 会抛 KeyError；
    # 而「留空 = 用默认」与 config.py 的口径一致（见 README 10 章）。
    return (
        env.get("AI_API_KEY") or "",
        (env.get("AI_API_BASE") or "https://dashscope.aliyuncs.com/api/v1").rstrip("/"),
        env.get("AI_T2I_MODEL") or "qwen-image-3.0-pro",
    )


def gen_image_url(key, base, model, prompt):
    """调用百炼多模态生成接口（文生图），返回结果图 URL。"""
    payload = {
        "model": model,
        "input": {"messages": [{"role": "user", "content": [{"text": prompt}]}]},
        "parameters": {
            "negative_prompt": "低质量、模糊、变形、噪点、阴影、倒影、多个物体、文字",
            "watermark": False,
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


def remove_white_bg(im, seed_min=235, thresh=40):
    """从边缘泛洪填充纯白背景为透明（保留物体内部的白色）。"""
    im = im.convert("RGB").resize((512, 512), Image.LANCZOS)
    w, h = im.size
    magenta = (255, 0, 255)
    px = im.load()
    seeds = [(x, 0) for x in range(0, w, 8)] + [(x, h - 1) for x in range(0, w, 8)]
    seeds += [(0, y) for y in range(0, h, 8)] + [(w - 1, y) for y in range(0, h, 8)]
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
    alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))
    alpha = alpha.point(lambda v: 0 if v < 40 else v)
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def to_square_canvas(im, canvas=480, content=400):
    """裁剪透明边界并居中缩放到方形透明画布。"""
    bbox = im.split()[3].getbbox()
    if bbox:
        pad = 10
        l = max(0, bbox[0] - pad)
        t = max(0, bbox[1] - pad)
        r = min(im.width, bbox[2] + pad)
        b = min(im.height, bbox[3] + pad)
        im = im.crop((l, t, r, b))
    im.thumbnail((content, content), Image.LANCZOS)
    bg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    bg.paste(im, ((canvas - im.width) // 2, (canvas - im.height) // 2), im)
    return bg


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    key, base, model = load_env()
    failed = []
    for name, item in ITEMS.items():
        out_path = os.path.join(OUT_DIR, f"{name}.png")
        try:
            print(f"[gen] {name} ...", flush=True)
            url = None
            last_err = None
            for _ in range(2):  # 失败重试 1 次
                try:
                    url = gen_image_url(key, base, model, PROMPT_TMPL.format(item=item))
                    break
                except Exception as e:  # noqa: BLE001
                    last_err = e
            if not url:
                raise last_err
            raw = requests.get(url, timeout=(10, 60)).content
            raw_path = os.path.join(OUT_DIR, f"_raw_{name}.png")
            with open(raw_path, "wb") as f:
                f.write(raw)
            im = Image.open(raw_path)
            im = remove_white_bg(im)
            im = to_square_canvas(im)
            im = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
            im.save(out_path, optimize=True)
            os.remove(raw_path)
            print(f"[ok] {name} -> {out_path}", flush=True)
        except Exception as e:  # noqa: BLE001
            failed.append(name)
            print(f"[fail] {name}: {e}", flush=True)
    print("DONE, failed:", failed or "none", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
