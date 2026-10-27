# app/api/works.py
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import or_

from app.api import api_bp
from app.extensions import db
from app.models import ChatMessage, EditRecord, Work
from app.services import storage
from app.utils.params import json_body, page_args, str_field
from app.utils.response import error, success

# 作品类型的**唯一来源**是模型上的常量（`models/work.py` 的 TYPE_*）——
# 这里不再另写一份字面量集合，避免「模型加了新类型、api 层白名单忘了加」的静默漂移
ALLOWED_TYPES = {Work.TYPE_BASIC, Work.TYPE_BEAUTY, Work.TYPE_STICKER, Work.TYPE_AI}
# image_path / thumb_path 对应 String(255)：超长值必须在入库前拦下，
# 否则 MySQL 抛 DataError，返回的是 HTML 500 而不是统一 JSON（见 11.1）
MAX_PATH_LEN = storage.MAX_PATH_LEN


def _get_own_work(work_id: int, user_id: int) -> Work | None:
    return Work.query.filter_by(id=work_id, user_id=user_id).first()


def _referenced_elsewhere(rel_url: str, *, exclude_work_id: int) -> bool:
    """除当前作品外，这个文件是否还被别处引用（**其它作品** / **对话消息**）。

    为什么删作品前要问这一句：保存作品**只登记路径、不复制文件**（见 README 5.3 / M44），
    所以「在聊天里点保存到作品」会让 works 与 chat_messages 指向**同一个** `uploads/ai/` 文件。
    若无条件删，删掉作品就会把对话里的图一起删掉（用户翻会话图裂）。
    判定口径与 `cleanup_temp.py` 的三分法一致：先确认没有别的引用，再动文件（见 11.3 第 40 条）。
    """
    if not rel_url:
        return False
    other_works = (
        Work.query.filter(Work.id != exclude_work_id)
        .filter(or_(Work.image_path == rel_url, Work.thumb_path == rel_url))
        .count()
    )
    if other_works:
        return True
    return ChatMessage.query.filter_by(image_path=rel_url).count() > 0


@api_bp.get("/works")
@jwt_required()
def work_list():
    """当前用户作品列表（分页：page/size）。"""
    user_id = int(get_jwt_identity())
    # page/size 统一走 page_args：?page=abc 回落默认值，超大页码也会被钳制
    # （不钳制时 (page-1)*size 会溢出成 MySQL 无法解析的字面量 → 500）
    page, size = page_args(default_size=10, max_size=50)

    pagination = (
        Work.query.filter_by(user_id=user_id)
        .order_by(Work.created_at.desc())
        .paginate(page=page, per_page=size, error_out=False)
    )
    return success(
        data={
            "items": [w.to_dict() for w in pagination.items],
            "total": pagination.total,
            "page": page,
            "size": size,
        }
    )


@api_bp.post("/works")
@jwt_required()
def work_create():
    """保存作品（title/type/image_path/thumb_path）。"""
    user_id = int(get_jwt_identity())
    data = json_body()
    title = str_field(data, "title") or "未命名作品"
    wtype = str_field(data, "type") or Work.TYPE_BASIC
    image_path = str_field(data, "image_path")
    thumb_path = str_field(data, "thumb_path") or None

    if wtype not in ALLOWED_TYPES:
        return error(code=2002, msg="非法的作品类型")
    # title 对应 String(64) 字段：先校验长度，避免直接入库时抛数据库异常、
    # 返回非统一 JSON 格式的 500（见 6.1 统一响应格式约定）
    if len(title) > 64:
        return error(code=2004, msg="作品标题长度不能超过64位")
    # 路径校验走 storage.is_upload_url()（全站唯一一份口径）：
    # 必须本站 `/uploads/` 前缀且不含 `..`，避免任意外链或目录穿越路径入库（见 11.3 第 47 条）
    if not storage.is_upload_url(image_path):
        return error(code=2003, msg="无效的作品图片路径")
    # 路径先比长度再入库：超长值同样只会撞上 String(255) 的数据库异常
    if len(image_path) > MAX_PATH_LEN:
        return error(code=2003, msg="作品图片路径过长（上限255位）")
    # 缩略图同一口径
    if thumb_path:
        if not storage.is_upload_url(thumb_path):
            return error(code=2003, msg="无效的作品缩略图路径")
        if len(thumb_path) > MAX_PATH_LEN:
            return error(code=2003, msg="作品缩略图路径过长（上限255位）")

    work = Work(
        user_id=user_id,
        title=title,
        image_path=image_path,
        thumb_path=thumb_path,
        type=wtype,
    )
    db.session.add(work)
    db.session.flush()
    # 保存作品时同步写一条编辑记录（作品详情页的记录列表依据）
    db.session.add(
        EditRecord(
            user_id=user_id,
            work_id=work.id,
            action=wtype,
            params={"source": "save"},
        )
    )
    db.session.commit()
    return success(data=work.to_dict(), msg="创建成功", http_status=201)


@api_bp.get("/works/<int:work_id>")
@jwt_required()
def work_detail(work_id: int):
    """作品详情。"""
    user_id = int(get_jwt_identity())
    work = _get_own_work(work_id, user_id)
    if not work:
        return error(code=2001, msg="作品不存在", http_status=404)
    return success(data=work.to_dict())


@api_bp.delete("/works/<int:work_id>")
@jwt_required()
def work_delete(work_id: int):
    """删除作品（连带删除编辑记录；文件在被别处引用时保留）。"""
    user_id = int(get_jwt_identity())
    work = _get_own_work(work_id, user_id)
    if not work:
        return error(code=2001, msg="作品不存在", http_status=404)

    # 删除编辑记录与作品文件。文件**要先确认没有别的引用**才删：
    # 保存作品只是登记路径引用（不复制文件），所以同一份 uploads/ai/ 文件可能被
    # 「本作品 + 对话消息」或「多个作品」同时引用 —— 无条件删会让另一处图裂（见 _referenced_elsewhere）。
    #
    # 顺序：**先提交数据库、再删文件**。反序（先删文件后 commit）一旦提交失败，
    # 库里就留下指向已删文件的记录与作品（页面裂图、且无从修复）；
    # 反序后最坏只是残留几个无引用的文件，由临时图回收兜掉（口径同 maintenance.py）。
    # 引用判定必须在提交前做完：提交后本作品与它的编辑记录已不在库里，判不出「被别处引用」。
    orphans = [
        rel_url
        for rel_url in (work.image_path, work.thumb_path)
        if not _referenced_elsewhere(rel_url, exclude_work_id=work.id)
    ]
    EditRecord.query.filter_by(work_id=work_id).delete()
    db.session.delete(work)
    db.session.commit()
    for rel_url in orphans:
        storage.delete_file(rel_url)
    return success(msg="删除成功")


@api_bp.get("/works/<int:work_id>/records")
@jwt_required()
def work_records(work_id: int):
    """作品的编辑记录列表。"""
    user_id = int(get_jwt_identity())
    if not _get_own_work(work_id, user_id):
        return error(code=2001, msg="作品不存在", http_status=404)

    records = (
        EditRecord.query.filter_by(work_id=work_id)
        .order_by(EditRecord.created_at.asc())
        .all()
    )
    return success(data={"items": [r.to_dict() for r in records]})