# app/api/templates.py
from flask import request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.api import api_bp
from app.extensions import db
from app.models import Template, TemplateLike
from app.utils.response import error, success


@api_bp.get("/templates")
@jwt_required()
def template_list():
    """模板资源列表（支持 category 过滤）。

    登录态下每个模板附带 `liked`（当前用户是否已赞）：该字段**在 api 层补**，
    `Template.to_dict()` 保持纯净；且先一次性取出当前用户的全部点赞再补字段，
    不做逐条查库（避免 N+1，口径同 README 11.3 第 48 条）。
    """
    user_id = int(get_jwt_identity())
    category = (request.args.get("category") or "").strip()
    query = Template.query
    if category:
        query = query.filter_by(category=category)
    items = query.order_by(Template.sort.asc()).all()

    liked_ids = {
        row.template_id for row in TemplateLike.query.filter_by(user_id=user_id).all()
    }
    return success(data={"items": [{**t.to_dict(), "liked": t.id in liked_ids} for t in items]})


@api_bp.post("/templates/<int:template_id>/like")
@jwt_required()
def template_like(template_id: int):
    """切换模板的点赞状态（已赞则取消），并同步维护 `templates.likes` 计数。

    两个要点：
    - **去重靠唯一约束**：`template_likes` 的 `(template_id, user_id)` 唯一，因此
      「刷新页面再点一次」不会重复计数；并发重复提交触发 `IntegrityError` 时按「已赞」返回，
      不把 500 抛给客户端。
    - **计数不回算**：`templates.likes` 是展示计数（含种子静态值），与去重表条数不要求相等。
    """
    user_id = int(get_jwt_identity())
    template = Template.query.filter_by(id=template_id).first()
    if not template:
        return error(code=2005, msg="模板不存在", http_status=404)

    existing = TemplateLike.query.filter_by(
        template_id=template_id, user_id=user_id
    ).first()

    # 整段「挂起 INSERT/DELETE → 原子 UPDATE → commit」必须包在同一个 try 里：
    # SQLAlchemy 会话默认 autoflush，`Query.update()` 执行前会先把挂起的 INSERT 刷出去，
    # 于是并发重复点赞触发的 IntegrityError 很可能**在这一行就抛出**而不是 commit 那行；
    # 只包 commit 会漏接异常，把 500 抛给客户端（注释承诺的「按已赞返回」失效）。
    try:
        if existing:
            db.session.delete(existing)
            delta, liked = -1, False
        else:
            db.session.add(TemplateLike(template_id=template_id, user_id=user_id))
            delta, liked = 1, True

        # 计数用一条**原子 UPDATE**（`likes = likes + delta`）而不是「读出来 +1 再写回」：
        # 后者在两个请求同时点赞时都会读到旧值、只写回 +1，计数少加（唯一约束只保证不重复点赞，
        # 保证不了计数正确）。`synchronize_session=False` 表示不回写内存对象 —— commit 后属性自动
        # 过期，下面的读取会重新查库，拿到的就是更新后的值。
        Template.query.filter_by(id=template_id).update(
            # `greatest(coalesce(likes,0) + delta, 0)`：与旧实现的 `max(0, likes ± 1)` 语义一致
            {Template.likes: func.greatest(func.coalesce(Template.likes, 0) + delta, 0)},
            synchronize_session=False,
        )
        db.session.commit()
    except IntegrityError:
        # 并发重复提交（同用户同模板）：唯一约束兜底，回滚后按「已赞」返回当前计数；
        # 同一瞬间模板被删除时 current 为空，按「模板不存在」返回而不是 500
        db.session.rollback()
        current = Template.query.filter_by(id=template_id).first()
        if not current:
            return error(code=2005, msg="模板不存在", http_status=404)
        return success(data={"likes": current.likes, "liked": True})

    return success(data={"likes": template.likes, "liked": liked})
