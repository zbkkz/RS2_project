// utils/labels.js
// 展示文案的统一来源：后端库里存的是基本/美颜/贴纸/AI 这类**内部标识**，
// 不能直接显示给用户；同一份文案在多个页面各写一遍就会出现「改一处忘一处」
// （首页角标与作品页角标本来是两份拷贝，见 README 11.3 第 48 条）。

// works.type → 中文短文案
const TYPE_LABEL = {
  basic: '基础编辑',
  beauty: '美颜',
  sticker: '贴纸',
  ai: 'AI 创作',
}

/** 作品类型的中文文案（未知类型给一个中性兜底，绝不把内部标识暴露给用户） */
function workTypeLabel(type) {
  return TYPE_LABEL[type] || '创作'
}

// ---------------------------------------------------------------------------
// edit_records.action → 中文（作品详情「编辑历史」用）
//
// 真实值域（三处写入来源，取值并不统一，必须都覆盖）：
//   ① POST /api/works 保存作品时写的那条：action = works.type，
//      即 basic / beauty / sticker / ai（`works.py` 的 `action=wtype`）；
//   ② seed.py 演示数据：crop / filter / beauty / sticker / ai_matting / adjust / ai_style；
//   ③ AI 处理与对话链路：ai_<能力> / ai_chat / ai_chat_edit / ai_asr
//      （这些记录的 work_id 为空，不会出现在作品详情里，仍一并兜住以防口径变化）。
// ---------------------------------------------------------------------------
const ACTION_LABEL = {
  // ① 保存作品时的 action（= 作品类型）
  basic: '基础编辑',
  beauty: '美颜',
  sticker: '贴纸',
  ai: 'AI 创作',
  // ② 演示 / 历史数据里的编辑动作
  crop: '裁切旋转',
  filter: '滤镜',
  adjust: '增强调节',
  enhance: '增强',
  doodle: '涂鸦',
  text: '文字',
  mosaic: '马赛克',
  frame: '相框',
  // ③ AI 能力
  ai_matting: '智能抠图',
  ai_style: '风格迁移',
  ai_enhance: '画质修复',
  ai_beauty: 'AI 美颜',
  ai_background: '换背景',
  ai_hair: '发型发色',
  // ③ 对话链路
  ai_chat: 'AI 对话',
  ai_chat_edit: 'AI 对话出图',
  ai_asr: '语音识别',
}

/** 编辑记录操作名的中文文案（未知值给中性兜底，绝不把内部标识暴露给用户） */
function actionLabel(action) {
  const key = String(action || '')
  if (ACTION_LABEL[key]) return ACTION_LABEL[key]
  if (key.indexOf('ai_') === 0) return 'AI 处理'
  return '编辑'
}

// 调用方优先用下面两个函数拿**文案**，不要自己查表（口径同 README 11.3 第 48 条）。
// `ACTION_LABEL` 额外导出：README 16.4.4 ① 明确要求它可被外部引用（例如统计某个 action
// 是否有中文名），而 `TYPE_LABEL` 仍留在模块内 —— 作品类型只该通过 workTypeLabel() 取。
module.exports = {
  ACTION_LABEL,
  workTypeLabel,
  actionLabel,
}
