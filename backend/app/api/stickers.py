# app/api/stickers.py
from flask import request
from flask_jwt_extended import jwt_required

from app.api import api_bp
from app.models import Sticker
from app.utils.response import success


@api_bp.get("/stickers")
@jwt_required()
def sticker_list():
    """贴纸资源列表（支持 category 过滤）。"""
    category = (request.args.get("category") or "").strip()
    query = Sticker.query
    if category:
        query = query.filter_by(category=category)
    items = query.order_by(Sticker.sort.asc()).all()
    return success(data={"items": [s.to_dict() for s in items]})