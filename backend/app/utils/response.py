# app/utils/response.py
"""统一 API 响应格式：{ code, msg, data }"""
from flask import jsonify


def success(data=None, msg="success", http_status=200):
    return jsonify({"code": 0, "msg": msg, "data": data}), http_status


def error(code=1, msg="error", http_status=400, data=None):
    return jsonify({"code": code, "msg": msg, "data": data}), http_status
