# 生成贴纸 PNG 资源（透明背景实心图形），到 uploads/stickers/
# 运行：python generate_stickers.py
import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), "uploads", "stickers")
os.makedirs(OUT_DIR, exist_ok=True)


def _new(size=256):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img, "RGBA")


def _poly(draw, points, fill):
    draw.polygon(list(points), fill=fill)


def _star(draw, cx, cy, outer, inner, n=5, rot=-math.pi / 2, fill=(255, 200, 0, 255)):
    pts = []
    for i in range(n * 2):
        r = outer if i % 2 == 0 else inner
        a = rot + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    _poly(draw, pts, fill)


# 笑脸
img, d = _new()
d.ellipse([16, 16, 240, 240], fill=(255, 205, 66, 255))
d.ellipse([84, 92, 116, 124], fill=(60, 50, 40, 255))
d.ellipse([140, 92, 172, 124], fill=(60, 50, 40, 255))
d.arc([72, 104, 184, 192], start=25, end=155, fill=(60, 50, 40, 255), width=14)
img.save(os.path.join(OUT_DIR, "smile.png"))

# 爱心
img, d = _new()
d.ellipse([28, 34, 140, 150], fill=(255, 87, 120, 255))
d.ellipse([116, 34, 228, 150], fill=(255, 87, 120, 255))
d.polygon([(36, 128), (220, 128), (128, 234)], fill=(255, 87, 120, 255))
img.save(os.path.join(OUT_DIR, "heart.png"))

# 墨镜
img, d = _new()
d.rounded_rectangle([16, 72, 110, 160], radius=18, fill=(40, 44, 52, 255))
d.rounded_rectangle([146, 72, 240, 160], radius=18, fill=(40, 44, 52, 255))
d.rounded_rectangle([108, 112, 148, 124], radius=6, fill=(40, 44, 52, 255))
img.save(os.path.join(OUT_DIR, "sunglasses.png"))

# 皇冠
img, d = _new()
d.polygon([(36, 190), (36, 84), (78, 132), (128, 48), (178, 132), (220, 84), (220, 190)],
          fill=(255, 200, 0, 255))
d.rectangle([36, 190, 220, 228], fill=(255, 200, 0, 255))
img.save(os.path.join(OUT_DIR, "crown.png"))

# 生日蛋糕（代替文字"生日快乐"）
img, d = _new()
d.rounded_rectangle([48, 138, 208, 208], radius=10, fill=(250, 183, 208, 255))
d.rounded_rectangle([32, 96, 224, 150], radius=10, fill=(200, 160, 255, 255))
d.rectangle([120, 34, 136, 96], fill=(255, 180, 80, 255))  # 蜡烛
d.ellipse([112, 14, 144, 46], fill=(255, 100, 90, 255))     # 火焰
img.save(os.path.join(OUT_DIR, "happy_birthday.png"))

# 加油（星爆/火花）
img, d = _new()
_star(d, 128, 128, 92, 44, n=4, fill=(255, 110, 90, 255))
_star(d, 128, 128, 60, 26, n=4, fill=(255, 205, 66, 255))
_poly(d, [(128, 68), (132, 108), (172, 108), (132, 124), (150, 160),
          (128, 134), (100, 160), (118, 124), (84, 108), (124, 108)],
     fill=(255, 255, 255, 255))
img.save(os.path.join(OUT_DIR, "fighting.png"))

# 猫耳朵
img, d = _new()
d.polygon([(24, 160), (88, 24), (128, 104)], fill=(250, 170, 200, 255))    # 左耳
d.polygon([(36, 132), (78, 52), (96, 96)], fill=(255, 130, 180, 255))      # 左内耳
d.polygon([(128, 104), (168, 24), (232, 160)], fill=(250, 170, 200, 255))  # 右耳
d.polygon([(160, 96), (178, 52), (220, 132)], fill=(255, 130, 180, 255))   # 右内耳
img.save(os.path.join(OUT_DIR, "cat_ears.png"))

# 星星
img, d = _new()
_star(d, 128, 128, 108, 52, fill=(255, 205, 66, 255))
img.save(os.path.join(OUT_DIR, "star.png"))

print("已生成贴纸：", sorted(os.listdir(OUT_DIR)))