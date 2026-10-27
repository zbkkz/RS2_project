# app/models/work.py
from datetime import datetime

from app.extensions import db
from app.models.base import fmt_time


class Work(db.Model):
    """作品表：用户编辑完成后保存的图像成果"""
    __tablename__ = "works"

    # 作品类型的**值域唯一来源**：api 层 `works.py::ALLOWED_TYPES` 由这四个常量拼出，
    # 不再各写一份字面量集合（新增类型时只改这里，见 README 11.3 第 48 条）
    TYPE_BASIC = "basic"      # 基础编辑
    TYPE_BEAUTY = "beauty"    # 美颜
    TYPE_STICKER = "sticker"  # 贴纸
    TYPE_AI = "ai"            # AI 处理

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True, comment="所属用户ID")
    title = db.Column(db.String(64), nullable=True, comment="作品标题")
    image_path = db.Column(db.String(255), nullable=False, comment="成品图存储路径/URL")
    thumb_path = db.Column(db.String(255), nullable=True, comment="缩略图路径/URL")
    type = db.Column(db.String(20), nullable=False, default=TYPE_BASIC, comment="来源类型：basic/beauty/sticker/ai")
    # 服务器本地时间（前端作品列表原样展示，utcnow 会早 8 小时，见 README M22）
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间）")

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "image_path": self.image_path,
            "thumb_path": self.thumb_path,
            "type": self.type,
            "created_at": fmt_time(self.created_at),
        }
