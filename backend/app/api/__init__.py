# app/api/__init__.py
from flask import Blueprint

api_bp = Blueprint("api", __name__, url_prefix="/api")

from . import ai, auth, chat, common, stickers, templates, upload, works  # noqa: E402,F401
