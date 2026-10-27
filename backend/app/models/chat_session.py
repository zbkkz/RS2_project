# app/models/chat_session.py
from datetime import datetime

from app.extensions import db
from app.models.base import fmt_time


class ChatSession(db.Model):
    """对话会话表：「AI 智能处理」聊天页的一段会话（见 README 7.4 / 11.2）"""
    __tablename__ = "chat_sessions"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True, comment="所属用户ID")
    title = db.Column(db.String(64), nullable=True, comment="会话标题（取首条用户消息前若干字）")
    # 服务器本地时间（与 edit_records / works 同一口径；对话的「每日额度」按本地零点统计，见 README M22）
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间）")
    updated_at = db.Column(
        db.DateTime, default=datetime.now, onupdate=datetime.now, comment="最后一条消息时间"
    )

    messages = db.relationship(
        "ChatMessage",
        backref="session",
        cascade="all, delete-orphan",
        order_by="ChatMessage.id",
        lazy="select",
    )

    def to_dict(self, message_count: int | None = None):
        data = {
            "id": self.id,
            "title": self.title,
            "created_at": fmt_time(self.created_at),
            "updated_at": fmt_time(self.updated_at),
        }
        if message_count is not None:
            data["message_count"] = message_count
        return data
