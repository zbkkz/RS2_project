# app/models/user.py
from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

from app.extensions import db
from app.models.base import fmt_time


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(32), unique=True, nullable=True, index=True, comment="账号（登录唯一标识）")
    phone = db.Column(db.String(11), unique=True, nullable=True, index=True, comment="手机号")
    password_hash = db.Column(db.String(255), nullable=True, comment="密码哈希")
    nickname = db.Column(db.String(64), nullable=True, comment="昵称")
    avatar = db.Column(db.String(255), nullable=True, comment="头像URL")
    openid = db.Column(db.String(64), unique=True, nullable=True, comment="微信openid（预留微信登录）")
    # 统一用服务器本地时间：created_at 会被前端原样展示（注册时间/作品列表），
    # 用 utcnow 存会在 UTC+8 下比用户看到的时间早 8 小时（见 README 5.2 / M22）
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间）")

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "phone": self.phone,
            "nickname": self.nickname,
            "avatar": self.avatar,
            "created_at": fmt_time(self.created_at),
        }
