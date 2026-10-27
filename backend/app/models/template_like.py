# app/models/template_like.py
from datetime import datetime

from app.extensions import db


class TemplateLike(db.Model):
    """模板点赞去重表：同一用户对同一模板最多一条记录。

    为什么单独一张表而不是只给 `templates.likes` 自增：`likes` 是展示用的计数（含种子静态值），
    无法回答「当前用户是否已赞」，也无法阻止「刷新一次就 +1」的假数据。
    这里用 `(template_id, user_id)` 唯一约束保证一人一赞，取消点赞即删除本行。

    口径：`templates.likes` 与本站的条数**不要求相等** —— 前者是展示计数、后者只表达「是否已赞」，
    因此 `likes` 不回算（见 README 5.6 / 11.3）。
    """

    __tablename__ = "template_likes"
    __table_args__ = (
        db.UniqueConstraint("template_id", "user_id", name="uq_template_like"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    template_id = db.Column(
        db.Integer, db.ForeignKey("templates.id"), nullable=False, index=True, comment="模板ID"
    )
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True, comment="点赞用户ID"
    )
    # 服务器本地时间：与其余 6 张表同一口径（见 README 5 节 / M22 ⑦）
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间）")
