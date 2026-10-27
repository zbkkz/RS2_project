# seed.py
"""开发用模拟数据填充脚本：python seed.py

幂等：若种子手机号已存在则跳过，可重复执行不会产生重复数据。

**资源自包含**：demo 作品图（含缩略图）与种子头像由本脚本用 Pillow 现场生成
（见 `ensure_demo_assets`），不依赖任何随仓库分发的图片素材；文件已存在即跳过，
因此「删掉图再跑一次」就是修复。写死了路径的 `WORKS` / `USERS` 与此处生成的文件名
必须逐字一致，否则库里的引用依旧悬空（见 README 11.3 第 42 条）。
"""
import colorsys
import os

from datetime import datetime, timedelta

from PIL import Image, ImageDraw, ImageFont

from app import create_app
from app.extensions import db
from app.models import EditRecord, Sticker, User, Work
from app.services import storage

app = create_app()

SEED_PHONES = ["13900000001", "13900000002", "13900000003", "13900000004"]

# username 为登录唯一标识（见文档 5.2 / 6.2），缺少 username 的种子用户无法通过 /api/auth/login 登录
USERS = [
    {"username": "xiaoming", "phone": "13900000001", "nickname": "小明", "avatar": "/uploads/avatars/u1.png"},
    {"username": "xiaohong", "phone": "13900000002", "nickname": "小红", "avatar": "/uploads/avatars/u2.png"},
    {"username": "ajie", "phone": "13900000003", "nickname": "阿杰", "avatar": None},
    {"username": "lili", "phone": "13900000004", "nickname": "莉莉", "avatar": "/uploads/avatars/u4.png"},
]

WORKS = [
    # (用户序号, 标题, 类型, 天数前)
    (0, "海边日落-裁剪调色", "basic", 6),
    (0, "人像精修", "beauty", 5),
    (0, "猫咪贴纸照", "sticker", 4),
    (0, "产品图抠图", "ai", 3),
    (1, "风景滤镜-青橙", "basic", 5),
    (1, "动漫风头像", "ai", 2),
    (2, "自拍美颜", "beauty", 3),
    (2, "证件照换底", "ai", 1),
    (3, "美食随拍", "basic", 2),
    (3, "生日派对贴纸", "sticker", 0),
]

EDIT_RECORDS = [
    # (用户序号, 作品序号或None, 操作, 参数)
    (0, 0, "crop", {"x": 120, "y": 80, "width": 800, "height": 600}),
    (0, 0, "filter", {"name": "暖阳", "intensity": 0.8}),
    (0, 1, "beauty", {"smooth": 0.6, "whiten": 0.4}),
    (0, 2, "sticker", {"sticker_id": 1, "x": 200, "y": 150, "scale": 1.2}),
    (0, 3, "ai_matting", {"model": "matting-v1"}),
    (1, 4, "filter", {"name": "青橙", "intensity": 1.0}),
    (1, 4, "adjust", {"brightness": 1.1, "contrast": 0.95, "saturation": 1.2}),
    (1, 5, "ai_style", {"style": "anime"}),
    (2, 6, "beauty", {"smooth": 0.8, "whiten": 0.7}),
    (2, 7, "ai_matting", {"model": "matting-v1", "background": "#438EDB"}),
    (3, 8, "crop", {"x": 0, "y": 200, "width": 1080, "height": 1080}),
    (3, 9, "sticker", {"sticker_id": 5, "x": 320, "y": 240, "scale": 1.0}),
]

STICKERS = [
    ("笑脸", "表情", "/uploads/stickers/smile.png", 1),
    ("爱心", "表情", "/uploads/stickers/heart.png", 2),
    ("墨镜", "装饰", "/uploads/stickers/sunglasses.png", 3),
    ("皇冠", "装饰", "/uploads/stickers/crown.png", 4),
    ("生日快乐", "文字", "/uploads/stickers/happy_birthday.png", 5),
    ("加油", "文字", "/uploads/stickers/fighting.png", 6),
    ("猫耳朵", "装饰", "/uploads/stickers/cat_ears.png", 7),
    ("星星", "装饰", "/uploads/stickers/star.png", 8),
]


# ===== 种子资源生成（Pillow 现场合成，见 README 11.3 第 42 条）=====
UPLOAD_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
COVER_DIR = os.path.join(UPLOAD_ROOT, "works")
AVATAR_DIR = os.path.join(UPLOAD_ROOT, "avatars")
COVER_SIZE = (1080, 1440)  # 4:5，接近移动端作品封面比例

# 中文字体候选（按平台探测）。**刻意不随仓库分发字体**：全部不可用时降级为纯图形封面 +
# 编号文字（内置位图字体只含 ASCII），生成照常成功，不会换台机器就中断。
FONT_CANDIDATES = (
    r"C:\Windows\Fonts\msyhbd.ttc",                        # Windows 微软雅黑 Bold
    r"C:\Windows\Fonts\msyh.ttc",                          # Windows 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",                        # Windows 黑体
    "/System/Library/Fonts/PingFang.ttc",                  # macOS 苹方
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",  # Linux Noto CJK
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
)


def _has_content(path: str) -> bool:
    """文件存在且非空。

    不能用 `os.path.isfile` 单独判存在：一次中断的写入会留下 **0 字节**的坏图，之后每次
    跑 seed 都会认为「封面已生成」直接跳过，坏图永远不被重建（页面上就是一张张空白封面）。
    """
    try:
        return os.path.isfile(path) and os.path.getsize(path) > 0
    except OSError:
        return False


def _font(size):
    """按候选列表取一个能渲染中文的字体；都不可用返回 None（调用方降级为纯图形）。"""
    for path in FONT_CANDIDATES:
        if os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return None


def _rgb(hue, sat, val):
    """HSV(0~1) → RGB(0~255)：配色由序号确定性派生，同一作品每次生成都一致。"""
    r, g, b = colorsys.hsv_to_rgb(hue % 1.0, sat, val)
    return round(r * 255), round(g * 255), round(b * 255)


def _hsv(index, shift=0.0, sat=0.6, val=0.95):
    return _rgb(0.06 + index * 0.137 + shift, sat, val)


def _vertical_gradient(size, top, bottom):
    """竖向线性渐变：逐行画线即可（1080×1440 也在毫秒级，不必引入 numpy）。"""
    w, h = size
    img = Image.new("RGB", size)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        k = y / max(1, h - 1)
        draw.line([(0, y), (w, y)],
                  fill=tuple(round(top[c] + (bottom[c] - top[c]) * k) for c in range(3)))
    return img


def _center_text(draw, cx, cy, text, font, fill):
    """按包围盒居中绘制（不用 `anchor=`：位图字体不支持，降级分支会抛异常）。"""
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text((cx - (right - left) / 2 - left, cy - (bottom - top) / 2 - top),
              text, font=font, fill=fill)


def _draw_cover(index, title):
    """demo 作品封面：渐变底 + 半透明装饰 + 作品名（无中文字体时退化为编号封面）。"""
    w, h = COVER_SIZE
    img = _vertical_gradient(COVER_SIZE, _hsv(index, sat=0.5, val=0.99),
                             _hsv(index, 0.10, sat=0.8, val=0.72))
    d = ImageDraw.Draw(img, "RGBA")

    # 两枚错位的半透明圆：避免整张图只有一条渐变
    r = int(w * 0.55)
    d.ellipse([w - r * 0.75, -r * 0.55, w + r * 0.75, r * 1.25], fill=(255, 255, 255, 22))
    d.ellipse([-r * 0.55, h - r * 0.75, r * 0.95, h + r * 0.55], fill=(255, 255, 255, 18))

    pad = int(w * 0.055)
    d.rounded_rectangle([pad, pad, w - pad, h - pad], radius=int(w * 0.07),
                        outline=(255, 255, 255, 72), width=max(2, int(w * 0.005)))

    cx = w / 2
    font, sub = _font(int(w * 0.082)), _font(int(w * 0.036))
    _center_text(d, cx, h * 0.46, title if font else f"DEMO {index + 1:02d}",
                 font or ImageFont.load_default(), (255, 255, 255, 245))
    d.line([(cx - w * 0.06, h * 0.545), (cx + w * 0.06, h * 0.545)],
           fill=(255, 255, 255, 130), width=max(2, int(w * 0.004)))
    _center_text(d, cx, h * 0.60, "示例作品" if font else "SAMPLE",
                 sub or ImageFont.load_default(), (255, 255, 255, 200))
    return img


def _draw_avatar(index):
    """头像占位图：纯色底 + 白色人形剪影（纯图形，不依赖字体）。"""
    size = 256
    img = Image.new("RGB", (size, size), _hsv(index, 0.03, sat=0.45, val=0.97))
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse([size * 0.31, size * 0.16, size * 0.69, size * 0.54], fill=(255, 255, 255, 240))
    d.ellipse([size * 0.16, size * 0.58, size * 0.84, size * 1.26], fill=(255, 255, 255, 240))
    return img


def ensure_demo_assets() -> int:
    """确保 demo 作品图（10 组：封面 + 缩略图）与 3 个种子头像存在，返回新生成的文件数。

    幂等：文件已存在即跳过 —— 因此**删掉图再跑一次 `python seed.py` 就是修复**。
    文件名与 `WORKS` / `USERS` 里写死的路径逐字对应（`w{i}.jpg` / `w{i}_thumb.jpg` /
    `u{n}.png`），改名会让库里的引用重新悬空。
    缩略图走 `storage.make_thumb()`，与上传链路共用同一份编码口径。
    """
    os.makedirs(COVER_DIR, exist_ok=True)
    os.makedirs(AVATAR_DIR, exist_ok=True)

    created = 0
    for i, (_ui, title, _type, _days) in enumerate(WORKS, start=1):
        cover = os.path.join(COVER_DIR, f"w{i}.jpg")
        thumb = os.path.join(COVER_DIR, f"w{i}_thumb.jpg")
        if _has_content(cover) and _has_content(thumb):
            continue
        if not _has_content(cover):
            with _draw_cover(i - 1, title) as img:
                img.save(cover, "JPEG", quality=88)
            created += 1
        storage.make_thumb(cover, thumb)
        created += 1

    for n, user in enumerate(USERS, start=1):
        if not user["avatar"]:
            continue
        target = os.path.join(AVATAR_DIR, os.path.basename(user["avatar"]))
        if _has_content(target):
            continue
        with _draw_avatar(n - 1) as img:
            img.save(target, "PNG")
        created += 1

    print(f"demo 资源已确保（本次新生成 {created} 个文件）："
          f"作品封面 {len(WORKS)} 组 → {COVER_DIR}，头像 → {AVATAR_DIR}")
    return created


def repair_seed_users() -> int:
    """回填老种子用户缺失的 `username`，返回修复条数。

    `username` 是**登录唯一标识**（见 5.2 / 6.2）：`M14` 之前建的库里种子用户只有手机号、
    username 为空，于是文档里那句「种子账号 xiaoming / 123456」根本登录不上（登录按 username 查）。
    本函数与 `ensure_demo_assets()` 同一口径 —— **幂等且能当修复用**：已有 username 的不动，
    目标账号被别的用户占用时跳过并提示（不抢别人的账号）。
    """
    fixed = []
    for u in USERS:
        user = User.query.filter_by(phone=u["phone"]).first()
        if not user or user.username:
            continue
        taken = User.query.filter(User.username == u["username"], User.id != user.id).first()
        if taken:
            print(f"  跳过「{u['nickname']}」：账号 {u['username']} 已被 id={taken.id} 占用")
            continue
        user.username = u["username"]
        fixed.append(u["username"])
    if fixed:
        db.session.commit()
    print(f"种子账号回填：修复 {len(fixed)} 个"
          + (f"（{', '.join(fixed)}）" if fixed else "（无需修复）"))
    return len(fixed)


def seed():
    with app.app_context():
        # 修复入口先行：即使库里已有种子数据（下面会提前 return），也把缺的 demo 图与
        # 老种子用户缺失的 username 补上 —— 「旧库里那 10 条图裂作品」「种子账号登不上」
        # 都靠这一步修（见 README 11.3 第 42 条 / M46 / M47）
        ensure_demo_assets()
        repair_seed_users()

        if User.query.filter(User.phone.in_(SEED_PHONES)).count() > 0:
            print("检测到种子数据已存在，跳过填充。")
            return

        # 用户（统一密码 123456）
        users = []
        for u in USERS:
            user = User(
                username=u["username"],
                phone=u["phone"],
                nickname=u["nickname"],
                avatar=u["avatar"],
            )
            user.set_password("123456")
            db.session.add(user)
            users.append(user)
        db.session.flush()  # 拿到 user.id

        # 作品
        base_time = datetime(2026, 9, 1, 10, 0, 0)
        works = []
        # 元组第四项是**相对基准日向后的偏移天数**（不是「N 天前」）：
        # `base_time + timedelta(days=offset)` 得到的是基准日之后的时刻。
        # 从前叫 days_ago 会让读者按「今天减 N 天」去理解，改基准日时极易造出未来时间的作品。
        for i, (ui, title, wtype, offset_days) in enumerate(WORKS, start=1):
            work = Work(
                user_id=users[ui].id,
                title=title,
                image_path=f"/uploads/works/w{i}.jpg",
                thumb_path=f"/uploads/works/w{i}_thumb.jpg",
                type=wtype,
                created_at=base_time + timedelta(days=offset_days),
            )
            db.session.add(work)
            works.append(work)
        db.session.flush()

        # 编辑记录
        for ui, wi, action, params in EDIT_RECORDS:
            db.session.add(EditRecord(
                user_id=users[ui].id,
                work_id=works[wi].id if wi is not None else None,
                action=action,
                params=params,
            ))

        # 贴纸
        for name, category, path, sort in STICKERS:
            db.session.add(Sticker(name=name, category=category, file_path=path, sort=sort))

        db.session.commit()
        print(f"填充完成：用户 {User.query.count()}，作品 {Work.query.count()}，"
              f"编辑记录 {EditRecord.query.count()}，贴纸 {Sticker.query.count()}")


if __name__ == "__main__":
    seed()
