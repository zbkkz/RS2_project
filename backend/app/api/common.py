# app/api/common.py
from app.api import api_bp
from app.utils.response import success


@api_bp.get("/ping")
def ping():
    """联调探活接口"""
    return success(data="pong")
