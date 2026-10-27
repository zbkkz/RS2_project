# app/models/chat_message.py
from datetime import datetime

from app.extensions import db
from app.models.base import fmt_time


class ChatMessage(db.Model):
    """对话消息表：一条用户消息或一条 AI 回复（见 README 7.4 / 11.2）

    两种形态：
    - `type=text`：`content` 为文本；
    - `type=image`：AI 出图结果，`image_path` 为落盘路径（`/uploads/ai/...`），`content` 为随图的一句说明。
    用户上传的原图**不入库**（它只是这一轮的输入，随消息的 `image_path` 记录在用户消息上）。
    """
    __tablename__ = "chat_messages"

    ROLE_USER = "user"
    ROLE_AI = "ai"

    TYPE_TEXT = "text"
    TYPE_IMAGE = "image"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    session_id = db.Column(
        db.Integer, db.ForeignKey("chat_sessions.id"), nullable=False, index=True, comment="所属会话ID"
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True, comment="所属用户ID")
    role = db.Column(db.String(8), nullable=False, comment="角色：user/ai")
    type = db.Column(db.String(8), nullable=False, default=TYPE_TEXT, comment="消息类型：text/image")
    content = db.Column(db.String(1000), nullable=True, comment="文本内容（出图消息为随图说明）")
    image_path = db.Column(db.String(255), nullable=True, comment="图片路径（出图结果 / 用户上传的原图）")
    # 识别出的意图（beauty/hair/matting/background/style/enhance/color/none），仅审计与排查用
    intent = db.Column(db.String(32), nullable=True, comment="识别出的修图意图")
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间）")

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "role": self.role,
            "type": self.type,
            "content": self.content,
            "image_path": self.image_path,
            "intent": self.intent,
            "created_at": fmt_time(self.created_at),
        }
