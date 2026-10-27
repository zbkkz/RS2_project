# app/models/base.py
"""模型层的公共部分：目前是「时间展示格式」的唯一实现。

7 张表都有 `created_at`（`chat_sessions` 另有 `updated_at`），且都要按同一格式返回给前端
（`YYYY-MM-DD HH:MM:SS`）。这段格式化原来在每张表的 `to_dict()` 里各写一遍 —— 漏改一处就会
让同一个列表里出现两种时间格式（例如「我的作品」里某几行少了秒），排查时很难联想到是格式化漂移。
"""

TIME_FMT = "%Y-%m-%d %H:%M:%S"


def fmt_time(value):
    """按统一格式输出时间；空值原样返回 None（与各接口原有行为逐字一致）。"""
    return value.strftime(TIME_FMT) if value else None
