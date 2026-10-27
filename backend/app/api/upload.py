# app/api/upload.py
import os

from flask import current_app, request
from flask_jwt_extended import jwt_required

from app.api import api_bp
from app.services import storage
from app.utils.response import error, success


@api_bp.post("/upload")
@jwt_required()
def upload_image():
    """图片上传（multipart：file）。校验类型/大小，保存并生成缩略图。"""
    if "file" not in request.files:
        return error(code=3001, msg="未接收到文件")
    file = request.files["file"]
    if not file.filename:
        return error(code=3001, msg="未接收到文件")

    max_size = current_app.config["MAX_UPLOAD_SIZE"]
    # 只认「流里的真实字节数」：Werkzeug 的 FileStorage.content_length 在 multipart 解析下
    # 通常为 0/None，用它判大小等于没判（旧实现留了这条恒不命中的分支，容易让人误以为已拦截）
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > max_size:
        return error(code=3001, msg=f"文件大小不能超过 {max_size // 1024 // 1024}MB")

    try:
        result = storage.save_image(file.stream, file.filename)
    except ValueError as e:
        return error(code=3001, msg=str(e))
    except Exception:
        return error(code=3001, msg="图片保存失败")

    return success(data={"url": result["url"], "thumb_url": result["thumb_url"]})