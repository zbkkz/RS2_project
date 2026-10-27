# generate_templates.py
"""生成模板 PNG 资源（uploads/templates/）并重灌 templates 表。

分类对齐模板页参考稿：生活分享 / AI玩法 / 拼图 / 美食 / 粉丝应援。
相框/海报类为 RGBA 透明镂空（照片从镂空处透出），背景类为整幅渐变图。
运行：python generate_templates.py（可重复执行：清空重灌，结果一致不产生重复数据）
"""
import math
import os

from PIL import Image, ImageDraw

from app import create_app
from app.extensions import db
from app.models import Template

OUT_DIR = os.path.join(os.path.dirname(__file__), "uploads", "templates")
os.makedirs(OUT_DIR, exist_ok=True)

PURPLE = (168, 107, 255, 255)
PINK = (248, 87, 166, 255)
NAVY = (36, 28, 74, 255)
WHITE = (255, 255, 255, 255)
YELLOW = (255, 214, 77, 255)
ORANGE = (255, 150, 90, 255)
CLEAR = (0, 0, 0, 0)


def _vgrad(size, c1, c2):
    """垂直渐变图（RGB 三元组 → RGB 三元组）"""
    w, h = size
    img = Image.new("RGBA", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        px = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
        d.line([(0, y), (w, y)], fill=px)
    return img


def _star(d, cx, cy, outer, inner, n=5, rot=-math.pi / 2, fill=YELLOW):
    pts = []
    for i in range(n * 2):
        r = outer if i % 2 == 0 else inner
        a = rot + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=fill)


def gen_life():
    # 1. 拍立得相框：白边，下边框加厚，中央镂空照片窗
    img = Image.new("RGBA", (600, 720), CLEAR)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 599, 719], fill=WHITE)
    d.rectangle([40, 40, 559, 579], fill=CLEAR)
    d.rectangle([40, 40, 559, 579], outline=(0, 0, 0, 40), width=2)
    img.save(os.path.join(OUT_DIR, "life_polaroid.png"))

    # 2. 胶片相框：黑框 + 上下齿孔 + 中央大窗
    img = Image.new("RGBA", (750, 500), CLEAR)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 749, 499], fill=(24, 22, 28, 255))
    d.rectangle([24, 84, 725, 415], fill=CLEAR)
    for x in range(40, 700, 70):
        d.rounded_rectangle([x, 22, x + 36, 58], radius=6, fill=CLEAR)
        d.rounded_rectangle([x, 442, x + 36, 478], radius=6, fill=CLEAR)
    img.save(os.path.join(OUT_DIR, "life_film.png"))


def gen_ai():
    # 3. 霓虹星环：紫粉双环 + 四角星装饰，中央圆形镂空
    img = Image.new("RGBA", (600, 760), CLEAR)
    d = ImageDraw.Draw(img)
    d.ellipse([60, 100, 540, 580], fill=PURPLE)
    d.ellipse([80, 120, 520, 560], fill=PINK)
    d.ellipse([100, 140, 500, 540], fill=CLEAR)
    _star(d, 88, 88, 56, 22)
    _star(d, 512, 620, 66, 26)
    _star(d, 530, 70, 34, 14, fill=WHITE)
    d.rounded_rectangle([180, 660, 420, 704], radius=22, fill=NAVY)
    img.save(os.path.join(OUT_DIR, "ai_neon.png"))

    # 4. 赛博边框：四角科技括号 + 上下渐变细条，中央镂空
    img = Image.new("RGBA", (600, 680), CLEAR)
    d = ImageDraw.Draw(img)
    bar = _vgrad((520, 16), (124, 90, 220), (248, 87, 166))
    img.paste(bar, (40, 20))
    img.paste(bar, (40, 644))
    for x, y, sx, sy in [(24, 24, 1, 1), (576, 24, -1, 1), (24, 656, 1, -1), (576, 656, -1, -1)]:
        d.line([(x, y), (x + 70 * sx, y)], fill=WHITE, width=8)
        d.line([(x, y), (x, y + 70 * sy)], fill=WHITE, width=8)
    img.save(os.path.join(OUT_DIR, "ai_cyber.png"))


def gen_collage():
    # 5. 双格拼图：白框 + 左右两窗镂空
    img = Image.new("RGBA", (600, 600), CLEAR)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 599, 599], fill=WHITE)
    d.rectangle([24, 24, 284, 575], fill=CLEAR)
    d.rectangle([316, 24, 575, 575], fill=CLEAR)
    img.save(os.path.join(OUT_DIR, "collage_two.png"))

    # 6. 三格拼图：紫框，左大窗 + 右上下两小窗镂空
    img = Image.new("RGBA", (600, 820), CLEAR)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 599, 819], fill=PURPLE)
    d.rectangle([24, 24, 344, 795], fill=CLEAR)
    d.rectangle([368, 24, 575, 387], fill=CLEAR)
    d.rectangle([368, 411, 575, 795], fill=CLEAR)
    img.save(os.path.join(OUT_DIR, "collage_three.png"))


def gen_food():
    # 7. 美食杂志：暖橙顶带 + 中央圆盘镂空 + 底部文字条
    img = Image.new("RGBA", (600, 750), CLEAR)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 599, 749], fill=(255, 248, 240, 255))
    d.rectangle([0, 0, 599, 119], fill=ORANGE)
    d.ellipse([100, 170, 500, 570], fill=CLEAR)
    d.ellipse([100, 170, 500, 570], outline=ORANGE, width=6)
    d.rounded_rectangle([60, 630, 340, 668], radius=8, fill=(70, 50, 40, 255))
    d.rounded_rectangle([60, 686, 240, 712], radius=6, fill=(200, 160, 130, 255))
    img.save(os.path.join(OUT_DIR, "food_magazine.png"))

    # 8. 甜蜜下午：粉底圆角框 + 顶部波浪 + 镂空主窗
    img = Image.new("RGBA", (600, 640), CLEAR)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, 599, 639], radius=48, fill=(255, 205, 224, 255))
    d.rounded_rectangle([28, 96, 571, 611], radius=32, fill=CLEAR)
    for x in range(30, 570, 90):
        d.ellipse([x, 30, x + 60, 90], fill=WHITE)
    img.save(os.path.join(OUT_DIR, "food_sweet.png"))


def gen_support():
    # 9. 应援海报：紫粉渐变底 + 大星 + 底部白色横幅条（整幅背景式）
    img = _vgrad((600, 800), (122, 75, 196), (248, 87, 166))
    d = ImageDraw.Draw(img)
    _star(d, 300, 300, 150, 60, fill=(255, 255, 255, 60))
    _star(d, 300, 300, 100, 40, fill=(255, 255, 255, 90))
    d.rectangle([0, 640, 599, 799], fill=(255, 255, 255, 235))
    d.rounded_rectangle([60, 680, 400, 720], radius=10, fill=NAVY)
    d.rounded_rectangle([60, 736, 280, 762], radius=8, fill=(180, 170, 210, 255))
    img.save(os.path.join(OUT_DIR, "support_poster.png"))

    # 10. 应援横幅：深紫底 + 星串顶饰 + 中央镂空舞台窗
    img = Image.new("RGBA", (750, 480), CLEAR)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, 749, 479], radius=36, fill=NAVY)
    d.rounded_rectangle([40, 90, 709, 420], radius=24, fill=CLEAR)
    for x in range(90, 700, 105):
        _star(d, x, 48, 26, 10, fill=YELLOW)
    img.save(os.path.join(OUT_DIR, "support_banner.png"))


# (名称, 分类, 路径, 宽, 高, 作者, 点赞数, 排序)
TEMPLATES = [
    ("拍立得日常", "生活分享", "/uploads/templates/life_polaroid.png", 600, 720, "奶糖摄影", 1286, 1),
    ("胶片记忆", "生活分享", "/uploads/templates/life_film.png", 750, 500, "阿紫", 857, 2),
    ("霓虹星环", "AI玩法", "/uploads/templates/ai_neon.png", 600, 760, "小鹿AI", 2377, 3),
    ("赛博边界", "AI玩法", "/uploads/templates/ai_cyber.png", 600, 680, "小鹿AI", 1042, 4),
    ("双格瞬间", "拼图", "/uploads/templates/collage_two.png", 600, 600, "拼图匠", 695, 5),
    ("三联故事", "拼图", "/uploads/templates/collage_three.png", 600, 820, "拼图匠", 913, 6),
    ("美食杂志", "美食", "/uploads/templates/food_magazine.png", 600, 750, "美食菌", 1664, 7),
    ("甜蜜下午", "美食", "/uploads/templates/food_sweet.png", 600, 640, "美食菌", 458, 8),
    ("星光应援", "粉丝应援", "/uploads/templates/support_poster.png", 600, 800, "应援站", 3205, 9),
    ("打歌舞台", "粉丝应援", "/uploads/templates/support_banner.png", 750, 480, "应援站", 1189, 10),
]


def seed_db():
    """重灌入库：清空后插入（幂等，重复执行结果一致）"""
    app = create_app()
    with app.app_context():
        Template.query.delete()
        for name, category, path, w, h, author, likes, sort in TEMPLATES:
            db.session.add(Template(
                name=name, category=category, file_path=path,
                author=author, likes=likes, width=w, height=h, sort=sort,
            ))
        db.session.commit()
        print(f"模板入库：共 {Template.query.count()} 条")


if __name__ == "__main__":
    gen_life()
    gen_ai()
    gen_collage()
    gen_food()
    gen_support()
    print("已生成模板图：", sorted(os.listdir(OUT_DIR)))
    seed_db()
