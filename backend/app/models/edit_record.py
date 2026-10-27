# app/models/edit_record.py
from datetime import datetime

from app.extensions import db
from app.models.base import fmt_time


class EditRecord(db.Model):
    """编辑记录表：一次编辑/AI 处理动作的历史记录"""
    __tablename__ = "edit_records"
    # 每日额度的统计口径固定为「user_id + action + 今天」三个条件（见 services/quota.py，
    # 每次 AI 调用都要查一次）。只有 user_id 单列索引时，记录变多后仍要回表逐行过滤 action
    # 与 created_at；这条复合索引让三个条件一次走完索引范围扫描。
    # 列顺序必须是 (user_id, action, created_at)：前两列等值匹配，第三列才是范围扫描。
    __table_args__ = (
        db.Index("ix_edit_records_user_action_created", "user_id", "action", "created_at"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True, comment="操作用户ID")
    work_id = db.Column(db.Integer, db.ForeignKey("works.id"), nullable=True, comment="关联作品ID")
    action = db.Column(db.String(32), nullable=False, comment="操作类型：crop/filter/beauty/sticker/ai_matting 等")
    params = db.Column(db.JSON, nullable=True, comment="操作参数快照（裁剪框、滤镜名、AI 能力名等）")
    # 服务器本地时间：AI 每日限流按「本地零点」统计当日记录，与这里保持同一口径（见 README M22）
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间）")

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "work_id": self.work_id,
            "action": self.action,
            "params": self.params,
            "created_at": fmt_time(self.created_at),
        }
