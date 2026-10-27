# app/models/sticker.py
from datetime import datetime

from app.extensions import db
from app.models.base import fmt_time


class Sticker(db.Model):
    """贴纸资源表：后端下发的装饰性图片资源"""
    __tablename__ = "stickers"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(32), nullable=False, comment="贴纸名称")
    category = db.Column(db.String(32), nullable=True, index=True, comment="分类（如表情/装饰/文字）")
    file_path = db.Column(db.String(255), nullable=False, comment="贴纸文件路径/URL")
    sort = db.Column(db.Integer, default=0, comment="排序值，升序")
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间，见 README M22）")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "file_path": self.file_path,
            "sort": self.sort,
            "created_at": fmt_time(self.created_at),
        }
