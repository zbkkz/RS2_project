# app/api/static_files.py
# 根路径静态服务，独立蓝图（无 /api 前缀）。
# 使 /uploads/<path> 可直接访问，与上传接口返回及数据库存储的相对路径保持一致。
from flask import Blueprint, current_app, send_from_directory

static_files_bp = Blueprint("static_files", __name__)


@static_files_bp.get("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(current_app.config["UPLOAD_DIR"], filename)