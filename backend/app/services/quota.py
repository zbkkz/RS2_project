# app/services/quota.py
"""每日用量统计（**唯一实现**）。

用途：图像能力配额（`action = ai_<能力>`）与对话链路的三种用途（`ai_chat` / `ai_chat_edit` /
`ai_asr`）都按 `edit_records` 的当日条数计算。窗口必须是**服务器本地零点** —— 与
`EditRecord.created_at` 的写入口径（`datetime.now`，本地时间）保持一致，否则东八区下
「每日」会从早上 8 点起算（见 README 7.3 / 7.4）。

这段统计只能有一份实现：`api/ai.py` 与 `api/chat.py` 各写一遍的话，改一处忘一处就会出现
「同一套配额两个口径」这类最难查的问题（见 README 11.3 第 48 条）。
"""
from datetime import datetime

from sqlalchemy import func

from app.extensions import db
from app.models import EditRecord


def today_start() -> datetime:
    """「今日」的起点（服务器本地零点）。**唯一实现**：所有按日统计都必须用它。

    抽成函数而不是在调用处各写一遍 `replace(hour=0, ...)`：零点口径一旦有一处写错
    （例如漏了 microsecond），就会出现「同一套配额两个口径」（见 README 11.3 第 48 条）。
    """
    return datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)


def used_today(user_id: int, action: str) -> int:
    """某用户「今日」某用途已用次数（本地零点口径）。"""
    return EditRecord.query.filter(
        EditRecord.user_id == user_id,
        EditRecord.action == action,
        EditRecord.created_at >= today_start(),
    ).count()


def used_today_map(user_id: int, actions) -> dict:
    """批量版 `used_today`：一次 `GROUP BY action` 返回多个用途的今日次数。

    口径与 `used_today` **完全一致**（同一个零点函数 + 同一个 action 精确匹配），
    区别只在于把「N 条 COUNT」压成「1 条聚合」：`/api/ai/quota` 一次要查 9 个用途，
    逐条 count 就是 9 次往返（见 README 11.3 第 48 条「同一口径只能有一份实现」）。

    返回的字典对传入的每个 action 都有键（查不到即 0），与逐条 count 的结果等价。
    """
    keys = list(actions)
    if not keys:
        return {}
    rows = (
        db.session.query(EditRecord.action, func.count(EditRecord.id))
        .filter(
            EditRecord.user_id == user_id,
            EditRecord.action.in_(keys),
            EditRecord.created_at >= today_start(),
        )
        .group_by(EditRecord.action)
        .all()
    )
    counts = dict.fromkeys(keys, 0)
    for action, count in rows:
        counts[action] = int(count)
    return counts
