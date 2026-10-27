# app/models/template.py
from datetime import datetime

from app.extensions import db
from app.models.base import fmt_time


class Template(db.Model):
    """模板资源表：后端下发的整幅模板图，编辑时叠加套用；瀑布流卡片含作者/点赞/尺寸"""
    __tablename__ = "templates"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(32), nullable=False, comment="模板名称")
    category = db.Column(db.String(32), nullable=True, index=True, comment="分类（生活分享/AI玩法/拼图/美食/粉丝应援）")
    file_path = db.Column(db.String(255), nullable=False, comment="模板文件路径/URL")
    author = db.Column(db.String(32), nullable=False, default="Hi.cut 官方", comment="作者名")
    likes = db.Column(db.Integer, nullable=False, default=0, comment="点赞数")
    width = db.Column(db.Integer, nullable=False, default=600, comment="模板图宽(px)，瀑布流定高用")
    height = db.Column(db.Integer, nullable=False, default=750, comment="模板图高(px)，瀑布流定高用")
    sort = db.Column(db.Integer, default=0, comment="排序值，升序")
    created_at = db.Column(db.DateTime, default=datetime.now, comment="创建时间（服务器本地时间，见 README M22）")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "file_path": self.file_path,
            "author": self.author,
            "likes": self.likes,
            "width": self.width,
            "height": self.height,
            "sort": self.sort,
            "created_at": fmt_time(self.created_at),
        }
