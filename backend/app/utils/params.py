# app/utils/params.py
"""请求入参的**类型安全**读取（统一响应格式的第一道防线，见 README 6.1 / 11.1）。

为什么要这一层：接口契约要求「所有接口返回 JSON」，而 `request.get_json()` 拿到的
**不一定是 dict**（客户端可以发 `[1,2,3]`、`"abc"`），字段也**不一定是字符串**
（`{"password": 123456}`）。直接 `data.get(...)` 会抛 AttributeError、
直接 `len(数字)` 会抛 TypeError —— 两者都会变成 Flask 的 HTML 500 页，
破坏 6.1 的统一响应约定（与 11.1「入参长度先于入库校验」同一类问题）。

约定：
- 非 dict 的 JSON 体一律当作「空对象」（缺字段 → 走各自的必填校验，返回业务错误码）；
- 字段值统一取字符串：字符串原样去空白；数字转成字符串（`{"text": 5}` → `"5"`）；
  布尔 / 列表 / 对象 / null 视为「未提供」（返回空串），避免 `str(...)` 造出脏值。
"""
from flask import request

# 分页页码上限：page 不设上限时，`(page-1)*size` 会溢出成超出 MySQL 字面量范围的
# 天文数字，触发 SQL 语法错误（返回 HTML 500 而不是统一 JSON）。1000 页 × 50 条 = 5 万条，
# 远超本项目单用户数据量级，正常调用不可能触顶。
MAX_PAGE = 1000


def json_body() -> dict:
    """取 JSON 请求体；非对象（数组/字符串/数字）一律按空对象处理。"""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def str_field(data: dict, key: str) -> str:
    """读一个字符串字段（去首尾空白）；非字符串类型安全降级，绝不抛异常。"""
    value = data.get(key) if isinstance(data, dict) else None
    if isinstance(value, str):
        return value.strip()
    # 数字（含 JSON 里的 int/float）按字面量转字符串：{"password": 123456} 等价 "123456"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value).strip()
    return ""


def page_args(default_size: int, max_size: int) -> tuple[int, int]:
    """解析分页参数 `page` / `size`：非法值回落默认、页码与条数都做上下限钳制。

    `type=int` 已能挡住 `?page=abc`（回落默认值）；这里再钳制上限，
    避免超大页码在分页 offset 计算里溢出。
    """
    page = request.args.get("page", default=1, type=int) or 1
    size = request.args.get("size", default=default_size, type=int) or default_size
    return min(max(page, 1), MAX_PAGE), min(max(size, 1), max_size)
