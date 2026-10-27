# app/services/storage.py
"""本地文件存储服务：图片保存、缩略图生成、路径校验。"""
import os
import shutil
import uuid
from pathlib import Path

from flask import current_app

# `/uploads/` 相对路径前缀：**唯一常量**，作品 / 头像 / 对话图片的路径校验都引用它
UPLOAD_URL_PREFIX = "/uploads/"
# 路径型字段（image_path / thumb_path / avatar）的长度上限，对齐模型的 String(255)
MAX_PATH_LEN = 255


def allowed_ext_names() -> set[str]:
    """图片扩展名白名单（规范化：小写、不带点）。

    **唯一来源是配置项 ALLOWED_IMAGE_EXT** —— api 层校验上传文件（`app/api/ai.py`）
    与这里保存文件用的是同一份白名单，避免「配置加了 webp、storage 忘了加」这类静默漂移。
    """
    return {
        str(ext).strip().lower().lstrip(".")
        for ext in (current_app.config.get("ALLOWED_IMAGE_EXT") or ())
    }


def _allowed_ext(filename: str) -> bool:
    return Path(filename or "").suffix.lstrip(".").lower() in allowed_ext_names()


def is_upload_url(rel_url: str | None) -> bool:
    """「存在库里的路径型入参」的**唯一校验口径**：本站 `/uploads/` 相对路径 + 无目录穿越。

    长度校验（对齐 `String(255)`）留在各调用方，因为它们的错误码不同（作品 2003 / 头像 1014），
    但「前缀白名单 + 拒绝 `..`」这条规则只能有一份实现（见 README 11.3 第 47 条）。
    """
    if not rel_url or not rel_url.startswith(UPLOAD_URL_PREFIX):
        return False
    return ".." not in rel_url


def save_image(stream, original_filename: str, sub: str = "originals", make_thumb: bool = True) -> dict:
    """保存上传图片，返回 { path, url, thumb_url }。

    - 校验扩展名（白名单）
    - 大文件尺寸由 api 层通过 MAX_UPLOAD_SIZE 拦截
    - 原图落盘 → 生成缩略图（`THUMB_SIZE` 为**等比缩放的上界**，`Image.thumbnail()` 只缩不裁，
      EXIF 方向已校正、透明底合成白底后存 JPEG q80；显示端用 `mode="aspectFill"` 自行裁切）
    - `make_thumb=False`：不生成缩略图（返回的 `thumb_url` 为 None）。用于**不会成为作品封面**
      的图，如 AI 处理结果（它只作为编辑会话的底图，用户点「保存」才会另存为作品，见 M30）。
    """
    if not _allowed_ext(original_filename):
        raise ValueError("不支持的图片格式")

    upload_dir = current_app.config["UPLOAD_DIR"]
    # 扩展名必须取**原始文件名**的后缀：`secure_filename()` 会剥掉非 ASCII 字符，
    # `secure_filename("照片.webp")` → `"webp"`，取后缀得到空串 → 一律回落 ".jpg"，
    # 于是 .png/.webp 的内容被命名为 .jpg（静态服务按后缀发错 Content-Type）。
    # 白名单已由 `_allowed_ext()` 在入口校验，这里只做归一。
    ext = Path(original_filename or "").suffix.lower()
    if ext.lstrip(".") not in allowed_ext_names():
        ext = ".jpg"

    dir_path = os.path.join(upload_dir, sub)
    os.makedirs(dir_path, exist_ok=True)

    uuid_name = uuid.uuid4().hex
    rel_name = f"{uuid_name}{ext}"
    abs_path = os.path.join(dir_path, rel_name)
    # 分块落盘：调用方可能传入任意文件流（本函数自身不设大小上限，
    # 上限由 api 层的 MAX_UPLOAD_SIZE 负责），`stream.read()` 会把整个文件读进内存
    with open(abs_path, "wb") as f:
        shutil.copyfileobj(stream, f, 64 * 1024)

    thumb_url = None
    if make_thumb:
        # 生成缩略图。生成失败（扩展名合法但内容不是图片、图片损坏）时把刚落盘的原图删掉，
        # 否则每次非法上传都会在 uploads/ 里留下一个永不被引用的孤儿文件（可被反复利用占满磁盘）
        thumb_name = f"{uuid_name}_thumb.jpg"
        thumb_abs = os.path.join(dir_path, thumb_name)
        try:
            _make_thumb(abs_path, thumb_abs)
        except Exception:
            for path in (abs_path, thumb_abs):
                try:
                    os.remove(path)
                except OSError:
                    pass
            raise
        thumb_url = f"/uploads/{sub}/{thumb_name}"

    return {
        "path": abs_path,
        "url": f"/uploads/{sub}/{rel_name}",
        "thumb_url": thumb_url,
    }


def _make_thumb(src: str, dst: str, size=None):
    from PIL import Image, ImageOps

    size = size or current_app.config["THUMB_SIZE"]
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)  # 校正 EXIF 旋转
        im.thumbnail(size, Image.LANCZOS)
        # JPEG 编码不支持透明通道：RGBA/LA/P 必须先合成到白底，否则保存抛 OSError
        # （透明 PNG 上传、AI 抠图结果等都会触发）
        if im.mode == "P":
            im = im.convert("RGBA")
        if im.mode in ("RGBA", "LA"):
            alpha = im.split()[-1]
            background = Image.new("RGB", im.size, (255, 255, 255))
            background.paste(im, mask=alpha)
            im = background
        elif im.mode != "RGB":
            im = im.convert("RGB")
        im.save(dst, "JPEG", quality=80)


def make_thumb(src: str, dst: str, size=None):
    """生成缩略图的**对外入口**（上传链路与 `seed.py` 的 demo 资源共用同一份实现）。

    种子资源生成脚本必须走这里而不是自己写一遍 `img.thumbnail()`：缩略图的
    「JPEG quality、EXIF 校正、透明底合成白底」只有一处定义，改口径时不会遗漏
    （见 README 11.3 第 42 条）。
    """
    _make_thumb(src, dst, size)


def resolve_upload_path(rel_url: str | None) -> str | None:
    """把 `/uploads/...` 相对路径解析为**站内**绝对路径；非法或越界返回 None。

    这是所有「把客户端传来的图片路径落回磁盘」的唯一入口（删除文件、对话出图取原图都用它）：
    只认本站 `/uploads/` 前缀，并用 resolve() 后的父子关系挡住 `../` 目录穿越。
    """
    if not is_upload_url(rel_url):
        return None
    upload_dir = current_app.config["UPLOAD_DIR"]
    base = Path(upload_dir).resolve()
    target = (base / rel_url.removeprefix(UPLOAD_URL_PREFIX)).resolve()
    # `target` 必须是 base **之下**的文件：`rel_url == "/uploads/"` 时解析结果正是 base 自身
    # （removeprefix 后为空串），此前的 `target != base` 例外会把它放行，
    # 于是 delete_file("/uploads/") 会去 os.remove 整个上传目录
    if base not in target.parents:
        return None  # 越界或指到目录本身，拒绝
    return str(target)


def delete_file(rel_url: str | None):
    """删除 /uploads 下相对路径对应的文件（安全校验，防目录穿越）。

    删除失败不抛异常（接口语义是「作品删掉了」，不该被一个删不掉的临时文件卡住），
    但要区分「文件本来就不存在」与「删失败」：Windows 上文件正被其它句柄打开
    （例如同一时刻静态服务正在读它）时 `os.remove` 会失败 —— 这种情况会留下一个
    无引用的孤儿文件，必须留日志，否则「作品删了、文件还在」无从排查。
    """
    target = resolve_upload_path(rel_url)
    if not target:
        return
    try:
        os.remove(target)
    except FileNotFoundError:
        pass
    except OSError as e:
        current_app.logger.warning("文件删除失败（保留为孤儿文件）%s：%s", rel_url, e)