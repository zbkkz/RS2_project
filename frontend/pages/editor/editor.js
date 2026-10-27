// pages/editor/editor.js — 图片查看/编辑页（三层：沉浸预览 / 查看操作 / 图片编辑）
// 第一层：相机拍摄或首页导入后落地的纯黑沉浸预览，无任何控件，轻触屏幕进入第二层。
// 第二层：查看操作层（顶部返回 + 拍摄日期/时间 + 相册入口，底部 下载/编辑/收藏/删除/更多）。
// 第三层：点「编辑」进入的图片编辑层（纯黑 UI：取消/保存 + 撤销/重做/翻转 +
//         一键美化/裁切旋转/滤镜/增强/涂鸦 + 基础/AI创作 两个 Tab）。
const { request, absoluteUrl, getToken } = require('../../utils/request')
const { getSafeTop } = require('../../utils/navbar')
const { normalizeFrame, hasFrame, drawFrame } = require('../../utils/frames')
// 图标统一 SVG base64 data URI（本页 renderer 为 webview，stroke 可正常使用）
// 查看层沿用深色实心图标；编辑层统一使用白色圆头描边的线性图标族，小尺寸下更清晰
// 转换实现与相机页共用 utils/icon.js 的唯一一份（原先两页各写一份，见该文件说明）
const { svgBase64 } = require('../../utils/icon')

const icon = (d, color) =>
  svgBase64(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='${color}' d='${d}'/></svg>`
  )

const DARK = '#1f1f1f'
const WHITE = '#ffffff'

/** 线性图标：统一圆头描边，小尺寸下比实心剪影更清晰 */
const lineIcon = (paths, w) =>
  svgBase64(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${WHITE}' ` +
      `stroke-width='${w || 2}' stroke-linecap='round' stroke-linejoin='round'>` +
      paths.map((p) => `<path d='${p}'/>`).join('') +
      `</svg>`
  )

/** 面性图标：星芒等需要填充的造型 */
const fillIcon = (paths) =>
  svgBase64(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${WHITE}'>` +
      paths.map((p) => `<path d='${p}'/>`).join('') +
      `</svg>`
  )

/** 圆环路径（圆心 cx/cy、半径 r），用于滑杆手柄、滤镜圆等 */
const ring = (cx, cy, r) => `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0-${2 * r}z`

/** 四角星芒路径（中心 cx/cy、半径 r，四边内凹，控制点取圆心） */
const star4 = (cx, cy, r) =>
  `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}z`

/** 可指定描边色的线性图标：比例预设需要「选中(深)/未选中(白)」两态 */
const tintIcon = (paths, color, w) =>
  svgBase64(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color}' ` +
      `stroke-width='${w || 1.7}' stroke-linecap='round' stroke-linejoin='round'>` +
      paths.map((p) => `<path d='${p}'/>`).join('') +
      `</svg>`
  )

/** 圆角矩形路径（比例预设图标外框） */
const rrect = (x, y, w, h, r) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}` +
  `a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}` +
  `v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`

/** 混合图标：描边 + 填充（魔杖等） */
const mixIcon = (strokes, fills, w) =>
  svgBase64(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
      `<g fill='none' stroke='${WHITE}' stroke-width='${w || 2}' stroke-linecap='round' stroke-linejoin='round'>` +
      strokes.map((s) => `<path d='${s}'/>`).join('') +
      `</g><g fill='${WHITE}'>` +
      fills.map((s) => `<path d='${s}'/>`).join('') +
      `</g></svg>`
  )
const ICON = {
  back: icon('M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z', DARK),
  album: icon(
    'M3 3h18v18H3V3zm2 2v14h14V5H5zm2 11.5h10.2l-2.6-5-3.2 3.9-2.2-2.6-2.2 3.7zM8.6 10a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
    DARK
  ),
  download: icon('M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z', DARK),
  edit: icon(
    'M3 17.46V21h3.54L17.88 9.66l-3.54-3.54L3 17.46zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    DARK
  ),
  heart: icon(
    'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C15.46 5.99 16.96 5 18.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
    DARK
  ),
  heartFill: icon(
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    '#ff3b30'
  ),
  trash: icon(
    'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z',
    DARK
  ),
  more: icon(
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-6.4-8.8h3.2v3.2H5.6zm5.6 0h3.2v3.2h-3.2zm5.6 0h3.2v3.2h-3.2z',
    DARK
  ),

  // ===== 编辑层图标（白色线性：圆头描边，小尺寸下更清爽）=====
  // 撤销 / 重做：回勾箭头
  undo: lineIcon(['M3.6 10h10.9a5 5 0 0 1 0 10H10', 'M8 5.6 3.6 10 8 14.4'], 2.2),
  redo: lineIcon(['M20.4 10H9.5a5 5 0 0 0 0 10H14', 'M16 5.6 20.4 10 16 14.4'], 2.2),
  // 镜像翻转：中轴 + 左右对称三角（实心 / 描边各半）
  flip: mixIcon(['M12 3.2v17.6', 'M14.4 6.4 20 12l-5.6 5.6z'], ['M9.6 6.4 4 12l5.6 5.6z'], 2),
  // 一键美化：大小双星芒
  sparkle: fillIcon([star4(9.8, 8.4, 5.6), star4(18.4, 17, 3.8)]),
  // 裁切旋转：两组相交的裁切标记
  crop: lineIcon(['M5.6 2.6v13.8a2 2 0 0 0 2 2h13.8', 'M18.4 21.4V7.6a2 2 0 0 0-2-2H2.6']),
  // 滤镜：三圆交叠
  filterCircle: lineIcon([ring(9.2, 9, 4.6), ring(14.8, 9, 4.6), ring(12, 14.6, 4.6)], 1.8),
  // 增强：三条滑杆 + 错落手柄
  tune: lineIcon(
    ['M3.4 5.6h17.2', 'M3.4 12h17.2', 'M3.4 18.4h17.2', ring(8.6, 5.6, 2.4), ring(15.2, 12, 2.4), ring(7.4, 18.4, 2.4)],
    1.8
  ),
  // 涂鸦：铅笔（笔尖三角 + 分隔线）
  brush: lineIcon(['M16.2 3.6l4.2 4.2-11 11-5.2 1 1-5.2z', 'M5.2 14.6 9.4 18.8']),
  // 文字：圆环 + 字母 T
  text: lineIcon([ring(12, 12, 8.6), 'M8.8 9.2h6.4', 'M12 9.2v6.2'], 1.7),
  // 马赛克：圆角方框 + 对角两块像素
  mosaic: mixIcon(
    ['M7 3.6h10A3.4 3.4 0 0 1 20.4 7v10a3.4 3.4 0 0 1-3.4 3.4H7A3.4 3.4 0 0 1 3.6 17V7A3.4 3.4 0 0 1 7 3.6z'],
    ['M6.4 6.4h5.2v5.2H6.4z', 'M12.4 12.4h5.2v5.2h-5.2z'],
    1.7
  ),
  // 贴纸：缺角方块（路径取自 Lucide 的 sticker，仅保留 24×24 路径数据）
  sticker: lineIcon(['M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z', 'M15 3v6h6'], 1.8),
  // ===== AI 能力图标（AI创作 Tab / AI 功能栏说明卡共用）=====
  // 路径取自开源图标库 **Lucide**（unpkg 上的 lucide-static，ISC 许可），仅保留其 24×24 路径数据，
  // 描边统一换成本页图标族的白色圆头描边（stroke-linecap/linejoin=round），
  // 因此与「基础」工具行那几个图标是同一套观感（简约线性、无填充色块）；
  // 圆/点用 ring() 展开为等价路径（本页图标构造器只接受 path 数据）。
  // 智能抠图：剪刀（与首页 AI 卡片的剪刀隐喻一致）
  aiMatting: lineIcon(
    [ring(6, 6, 3), ring(6, 18, 3), 'M8.12 8.12 12 12', 'M20 4 8.12 15.88', 'M14.8 14.8 20 20'],
    1.8
  ),
  // 风格迁移：调色板（Lucide 轮廓 + 4 个颜料点；原图标点半径 0.5 在 44~52rpx 下几乎不可见，放大到 0.9）
  aiStyle: lineIcon(
    [
      'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
      ring(13.5, 6.5, 0.9),
      ring(17.5, 10.5, 0.9),
      ring(6.5, 12.5, 0.9),
      ring(8.5, 7.5, 0.9),
    ],
    1.6
  ),
  // 画质修复：魔杖 + 星芒
  aiEnhance: lineIcon(
    [
      'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72',
      'm14 7 3 3',
      'M5 6v4',
      'M19 14v4',
      'M10 2v2',
      'M7 8H3',
      'M21 16h-4',
      'M11 3H9',
    ],
    1.7
  ),
  // AI 美颜：笑脸
  aiBeauty: lineIcon([ring(12, 12, 10), 'M9 10V9', 'M15 10V9', 'M16.472 15a6 6 0 0 1-8.943 0'], 1.7),
  // 换背景：圆角画面框 + 圆点 + 山形（图片语义，与首页同款造型）
  aiBackground: lineIcon(
    [
      'M7 3.6h10A3.4 3.4 0 0 1 20.4 7v10a3.4 3.4 0 0 1-3.4 3.4H7A3.4 3.4 0 0 1 3.6 17V7A3.4 3.4 0 0 1 7 3.6z',
      ring(8.8, 8.8, 1.7),
      'M20.4 15.2 17.1 11.9a2 2 0 0 0-2.8 0L5 20.4',
    ],
    1.7
  ),
  // 发型发色：头部 + 发际线 + 两撮翘起的发丝
  aiHair: lineIcon(
    [
      ring(12, 14.2, 5.2),
      'M6.8 11.6c0-2.9 2.3-5.2 5.2-5.2s5.2 2.3 5.2 5.2',
      'M9.4 8.4 10.6 6',
      'M13.4 7.6 14.6 5.4',
    ],
    1.7
  ),
  // 功能栏（裁切旋转 / 滤镜）：顺时针旋转 90°、取消 ×、确认 ✓
  rotate: fillIcon([
    'M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45z',
    'M19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02z',
    'M13 17.91v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03z',
    'M16.89 15.49l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z',
  ]),
  close: fillIcon([
    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  ]),
  check: fillIcon(['M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z']),
}

// ===== 滤镜：canvas 2D 的 ctx.filter 字符串 =====
// 分类存放（流行/经典/人像/美食/电影/旅行/复古/色调）；
// 「色调」用 sepia(1)+hue-rotate 做整幅单色着色，与常规调色类滤镜视觉差异最大
// 同一份函数串同时驱动 ctx.filter 与缩略图 CSS filter
const FILTER_GROUPS = [
  {
    key: 'pop',
    name: '流行',
    items: [
      { key: 'none', name: '原图', value: 'none' },
      { key: 'bright', name: '明亮', value: 'brightness(1.15) saturate(1.1)' },
      { key: 'vivid', name: '鲜艳', value: 'saturate(1.55) contrast(1.12)' },
      { key: 'fade', name: '淡雅', value: 'brightness(1.12) saturate(.72) contrast(.92)' },
      { key: 'candy', name: '糖果', value: 'saturate(1.35) brightness(1.08) hue-rotate(-8deg)' },
    ],
  },
  {
    key: 'classic',
    name: '经典',
    items: [
      { key: 'warm', name: '暖阳', value: 'sepia(.35) saturate(1.3) brightness(1.05)' },
      { key: 'cool', name: '清凉', value: 'hue-rotate(-18deg) saturate(1.15) brightness(1.03)' },
      { key: 'mono', name: '黑白', value: 'grayscale(1) contrast(1.08)' },
      { key: 'film', name: '胶片', value: 'sepia(.55) contrast(1.15) saturate(.85)' },
      { key: 'ink', name: '水墨', value: 'grayscale(1) contrast(1.35) brightness(1.05)' },
    ],
  },
  {
    key: 'portrait',
    name: '人像',
    items: [
      { key: 'soft', name: '柔光', value: 'brightness(1.1) saturate(1.05) contrast(.95)' },
      { key: 'fair', name: '白皙', value: 'brightness(1.16) saturate(.95) contrast(.94)' },
      { key: 'peach', name: '蜜桃', value: 'sepia(.2) saturate(1.2) brightness(1.06) hue-rotate(-6deg)' },
      { key: 'coolSkin', name: '冷白', value: 'brightness(1.1) hue-rotate(6deg) saturate(.9)' },
      { key: 'cream', name: '奶油', value: 'brightness(1.14) saturate(.9) contrast(.9) sepia(.15) hue-rotate(-5deg)' },
    ],
  },
  {
    key: 'food',
    name: '美食',
    items: [
      { key: 'tasty', name: '鲜香', value: 'saturate(1.4) contrast(1.1) brightness(1.04)' },
      { key: 'warmFood', name: '暖食', value: 'sepia(.25) saturate(1.35) brightness(1.06)' },
      { key: 'fresh', name: '清新', value: 'saturate(1.2) brightness(1.08) hue-rotate(-6deg)' },
      { key: 'caramel', name: '焦糖', value: 'sepia(.35) saturate(1.5) contrast(1.12) brightness(1.03)' },
      { key: 'rich', name: '醇香', value: 'saturate(1.32) contrast(1.2) brightness(.98) sepia(.2)' },
    ],
  },
  {
    key: 'movie',
    name: '电影',
    items: [
      { key: 'teal', name: '青橙', value: 'contrast(1.16) saturate(1.2) hue-rotate(-12deg)' },
      { key: 'night', name: '暗夜', value: 'brightness(.9) contrast(1.24) saturate(.9)' },
      { key: 'hk', name: '港风', value: 'sepia(.3) contrast(1.2) saturate(1.1) brightness(.98)' },
      { key: 'noir', name: '黑白电影', value: 'grayscale(1) contrast(1.26) brightness(.95)' },
      { key: 'slate', name: '青灰', value: 'grayscale(.35) contrast(1.24) saturate(1.05) hue-rotate(-18deg)' },
    ],
  },
  {
    key: 'travel',
    name: '旅行',
    items: [
      { key: 'sky', name: '晴空', value: 'saturate(1.3) brightness(1.06) hue-rotate(6deg)' },
      { key: 'sea', name: '海风', value: 'saturate(1.15) hue-rotate(-10deg) brightness(1.04)' },
      { key: 'green', name: '原野', value: 'saturate(1.25) hue-rotate(-4deg) contrast(1.06)' },
      { key: 'dawn', name: '晨曦', value: 'sepia(.28) saturate(1.2) brightness(1.08)' },
      { key: 'sunset', name: '落日', value: 'sepia(.42) saturate(1.5) brightness(1.03) hue-rotate(-14deg)' },
    ],
  },
  {
    key: 'retro',
    name: '复古',
    items: [
      { key: 'vintage', name: '老照片', value: 'sepia(.78) contrast(1.12) brightness(.97) saturate(.85)' },
      { key: 'polaroid', name: '宝丽来', value: 'sepia(.35) contrast(1.2) saturate(1.18) brightness(1.08)' },
      { key: 'washed', name: '褪色', value: 'sepia(.5) saturate(.62) brightness(1.12) contrast(.86)' },
      { key: 'amber', name: '琥珀', value: 'sepia(.6) saturate(1.55) hue-rotate(-12deg) brightness(1.04) contrast(1.06)' },
      { key: 'nostalgia', name: '怀旧', value: 'sepia(.45) contrast(.94) saturate(.78) brightness(1.06) hue-rotate(-6deg)' },
    ],
  },
  {
    key: 'tint',
    name: '色调',
    items: [
      { key: 'tintBlue', name: '静谧蓝', value: 'sepia(1) saturate(2.1) hue-rotate(178deg) brightness(1.02) contrast(1.06)' },
      { key: 'tintMint', name: '薄荷绿', value: 'sepia(1) saturate(1.6) hue-rotate(92deg) brightness(1.05)' },
      { key: 'tintRose', name: '玫瑰粉', value: 'sepia(1) saturate(1.9) hue-rotate(302deg) brightness(1.06)' },
      { key: 'tintViolet', name: '紫罗兰', value: 'sepia(1) saturate(1.75) hue-rotate(238deg) contrast(1.08)' },
      { key: 'tintCyan', name: '青柠', value: 'sepia(1) saturate(1.5) hue-rotate(132deg) contrast(1.1) brightness(1.02)' },
    ],
  },
]

/** 滤镜查表：key → { name, value }（画布渲染与缩略图共用同一份） */
const FILTER_MAP = {}
FILTER_GROUPS.forEach((g) =>
  g.items.forEach((f) => {
    FILTER_MAP[f.key] = f
  })
)

// ===== 裁切旋转 =====

// 角度微调（拉直）范围：±45°
const CROP_ANGLE_RANGE = 45

// 比例预设（顺序与设计稿一致）：自由 / 原始 / 全屏 / 横向全屏 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16
// 每项自带「选中(深色)/未选中(白色)」两套图标
const ratioIcon = (paths) => ({ on: tintIcon(paths, '#111111'), off: tintIcon(paths, WHITE) })
const CORNER_FREE = [
  'M3.4 8.4V5.6a2.2 2.2 0 0 1 2.2-2.2h2.8',
  'M15.6 3.4h2.8a2.2 2.2 0 0 1 2.2 2.2v2.8',
  'M20.6 15.6v2.8a2.2 2.2 0 0 1-2.2 2.2h-2.8',
  'M8.4 20.6H5.6a2.2 2.2 0 0 1-2.2-2.2v-2.8',
]
const CROP_RATIOS = [
  { key: 'free', name: '自由', icon: ratioIcon(CORNER_FREE) },
  { key: 'orig', name: '原始', icon: ratioIcon([rrect(2.8, 2.8, 18.4, 18.4, 2.4), rrect(9.6, 9.6, 9.6, 9.6, 1.4)]) },
  { key: 'screen', name: '全屏', icon: ratioIcon([rrect(7.4, 2.2, 9.2, 19.6, 2.2)]) },
  { key: 'screenL', name: '横向全屏', icon: ratioIcon([rrect(2.2, 7.4, 19.6, 9.2, 2.2)]) },
  { key: '1:1', name: '1:1', icon: ratioIcon([rrect(4.2, 4.2, 15.6, 15.6, 2.2)]) },
  { key: '4:3', name: '4:3', icon: ratioIcon([rrect(2.6, 5.7, 18.8, 12.6, 2)]) },
  { key: '3:4', name: '3:4', icon: ratioIcon([rrect(5.7, 2.6, 12.6, 18.8, 2)]) },
  { key: '16:9', name: '16:9', icon: ratioIcon([rrect(2.2, 7.4, 19.6, 9.2, 1.8)]) },
  { key: '9:16', name: '9:16', icon: ratioIcon([rrect(7.4, 2.2, 9.2, 19.6, 1.8)]) },
]

// 风格迁移可选风格（**必须与后端 app/services/ai.py 的 STYLE_WHITELIST 一致**：
// 后端只认这五个，传别的直接 3004；前端此表只作 UI）
const AI_STYLES = ['油画', '素描', '动漫', '水彩', '赛博朋克']

// AI 出图是同步长耗时，且上游耗时波动很大：同一模型同一参数实测 66s / 81s，也出现过 ~300s。
// 等待上限必须**大于服务端总预算**（后端 AI_TOTAL_TIMEOUT=240s）+ 结果图下载（≤30s）：
// 小程序默认 60s 完全不够，而「前端比后端先放弃」更糟 —— 客户端断开后服务端仍会出图并落库，
// 用户看到「处理失败」却在「我的作品」里多出一张图，这次调用也照样计费（实测复现过一次）。
// 取 360s：留 30s 余量，且 app.json 的 networkTimeout.uploadFile（300s）即使生效也仍在预算之上。
const AI_UPLOAD_TIMEOUT = 360000
// 等待上限之外再兜 30s：个别基础库 / 开发者工具在连接被对端断开时不回调 fail，
// 没有这层看门狗，loading 会一直挂着、整页被 mask 遮死（见 11.3 第 18 条）
const AI_WATCHDOG_EXTRA = 30000

// AI 创作能力（对应后端 POST /api/ai/<ability>，顺序与首页 AI 卡片一致）。
// 每项除名称外还带「图标 + 一句话说明 + 三条处理要点」，供 AI 功能栏的说明卡渲染（见 8.8 节）。
// icon 直接放已生成的 data URI（而不是在 WXML 里写 ICON[item.ic] 这类取键表达式）：
// 与基础工具行「图标写死」的用法保持一致，少一层动态取值、也不受 WXML 表达式能力影响
const AI_ABILITIES = [
  {
    key: 'matting',
    name: '智能抠图',
    desc: '自动识别画面主体并去除背景，输出干净的前景主体。',
    icon: ICON.aiMatting,
    tips: ['主体自动识别', '边缘干净处理', '背景纯净输出'],
  },
  {
    key: 'style',
    name: '风格迁移',
    desc: '保留主体结构与内容，把整幅画面转换为指定艺术风格。',
    icon: ICON.aiStyle,
    tips: ['保留主体结构', '仅替换画风', '五种风格可选'],
  },
  {
    key: 'enhance',
    name: '画质修复',
    desc: '提升清晰度与细节质感，去除噪点、模糊与压缩痕迹。',
    icon: ICON.aiEnhance,
    tips: ['提升清晰度', '去除噪点压缩痕', '内容保持真实'],
  },
  {
    key: 'beauty',
    name: 'AI美颜',
    desc: '对人像做自然美颜：磨皮、提亮肤色并优化五官轮廓。',
    icon: ICON.aiBeauty,
    tips: ['自然磨皮', '提亮肤色', '优化五官轮廓'],
  },
  // ⚠️ 新能力必须 append 到末尾：顺序与首页 AI_LIST 保持一致（见 README 11.3 第 31 条；
  // 首页前两项被核心入口区占用，故两处都以 append 维护）
  {
    key: 'background',
    name: '换背景',
    desc: '替换画面背景，主体完整保留、边缘自然贴合、光照方向一致。',
    icon: ICON.aiBackground,
    tips: ['主体完整保留', '边缘自然贴合', '背景干净简洁'],
  },
  {
    key: 'hair',
    name: '发型发色',
    desc: '只修改人物的发型与发色，五官、肤色与画面其余部分保持不变。',
    icon: ICON.aiHair,
    tips: ['只改发型发色', '发丝自然', '其余部分不变'],
  },
]

// ===== 入口参数：直达某个底部工具面板（M54）=====
// 首页工具入口（文字 / 涂鸦 / 贴纸库 / 贴纸叠加）在选图后带上 `panel=<key>`，编辑页首图
// 加载完成后**直达**对应面板。口径与 `pendingAi` 完全一致：白名单校验 + 一次性消费 +
// 不替用户触发任何动作（不新增叠加层、不烘焙、不产生计费调用）。
// 取值即 `togglePanel` 的 `data-panel`：只开放四个**内联面板**；裁切/滤镜/增强是独立
// 功能栏（工具行入口），首页没有对应图标，故不列入白名单（手改 URL 也会被忽略）。
const ENTRY_PANELS = ['doodle', 'text', 'mosaic', 'sticker']

// 涂鸦调色板与笔刷粗细
const PEN_COLORS = ['#ffffff', '#ff3b30', '#ff9500', '#ffcd3c', '#34c759', '#00c7be', '#0a84ff', '#ff2d55']
const PEN_SIZES = [4, 8, 14, 22]

// 文字：字号档位（占图片显示高度的百分比，随图片尺寸等比缩放）+ 可选颜色沿用涂鸦调色板
const TEXT_SIZES = [5, 8, 12, 18]

// 马赛克：块级（每块覆盖的底图原始像素数，越大越糊）+ 笔刷粗细沿用涂鸦档位
const MOSAIC_LEVELS = [
  { key: 'coarse', name: '粗', block: 12 },
  { key: 'mid', name: '中', block: 20 },
  { key: 'fine', name: '细', block: 30 },
]

// ===== 贴纸（底部内联面板）=====
// 贴纸资源由后端 GET /api/stickers 下发（stickers 表，见 README 5.5 / 6.2）：
// 分类 Tab + 横向缩略图列表，点一下即加到图片中心，之后可直接在图片上拖动定位。
// 叠加层状态沿用 `layerStickers`（与模板叠加同一管管线：归一化坐标 + drawStickers 绘制），
// 因此模板/贴纸共用同一套「入撤销栈 / 底图替换时清空 / 计入保存高亮与作品类型」的行为。
const STICKER_ALL = '全部'
// 新增贴纸的默认宽度（占图片显示宽度的比例）
const STICKER_WIDTH = 0.3

// ===== 增强（独立功能栏）=====
// 参数项：曝光 / 亮度 / 对比度 / 饱和度 / 自然饱和度，顺序与设计稿一致。
// 每项的值统一为「相对默认值的偏移量」（0 = 默认，滑杆居中），范围 ±ADJ_RANGE，
// 这样同一套滑杆就能复用于所有参数（拖动即调，无需各自维护 min/max）。
const ADJ_RANGE = 50

// 参数图标（两态：选中深色 / 未选中白色，与比例预设同一套两态图标约定）
const adjPaths = {
  // 曝光：圆角方框 + 左下三角填充（明暗各半）
  exposure: { strokes: [rrect(3.4, 3.4, 17.2, 17.2, 3.2)], fills: ['M5.4 5.4 5.4 18.6 18.6 18.6z'] },
  // 亮度：太阳（圆 + 八向光芒）
  brightness: {
    strokes: [
      ring(12, 12, 4.4),
      'M12 2.6v2.8',
      'M12 18.6v2.8',
      'M2.6 12h2.8',
      'M18.6 12h2.8',
      'M5.35 5.35 7.33 7.33',
      'M16.67 16.67 18.65 18.65',
      'M18.65 5.35 16.67 7.33',
      'M7.33 16.67 5.35 18.65',
    ],
    fills: [],
  },
  // 对比度：圆环 + 右半圆填充
  contrast: { strokes: [ring(12, 12, 8.4)], fills: ['M12 3.6a8.4 8.4 0 0 1 0 16.8z'] },
  // 饱和度：圆角方框描边
  saturate: { strokes: [rrect(3.6, 3.6, 16.8, 16.8, 3.2)], fills: [] },
  // 自然饱和度：三角形描边
  vibrance: { strokes: ['M12 3.8 20.6 20.2 3.4 20.2z'], fills: [] },
}
const adjIcon = ({ strokes, fills }, color) =>
  svgBase64(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
      `<g fill='none' stroke='${color}' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'>` +
      strokes.map((s) => `<path d='${s}'/>`).join('') +
      `</g><g fill='${color}'>` +
      fills.map((s) => `<path d='${s}'/>`).join('') +
      `</g></svg>`
  )
const adjItemIcon = (key) => ({
  on: adjIcon(adjPaths[key], '#111111'),
  off: adjIcon(adjPaths[key], WHITE),
})

const ADJ_ITEMS = [
  { key: 'exposure', name: '曝光', icon: adjItemIcon('exposure') },
  { key: 'brightness', name: '亮度', icon: adjItemIcon('brightness') },
  { key: 'contrast', name: '对比度', icon: adjItemIcon('contrast') },
  { key: 'saturate', name: '饱和度', icon: adjItemIcon('saturate') },
  { key: 'vibrance', name: '自然饱和度', icon: adjItemIcon('vibrance') },
]
const ADJ_KEYS = ADJ_ITEMS.map((x) => x.key)
const ADJ_DEFAULT = ADJ_KEYS.reduce((o, k) => {
  o[k] = 0
  return o
}, {})
/** 参数项 + 当前值（供 WXML 渲染滑杆与选中态） */
const adjItemsWithValues = (adj) => {
  const a = adj || ADJ_DEFAULT
  return ADJ_ITEMS.map((it) => ({ ...it, value: a[it.key] || 0 }))
}
/** 数值文案：正数带 + 号 */
const adjValLabel = (v) => (v > 0 ? '+' + v : '' + v)

// 一键美化预设（同为偏移量口径）
const BEAUTIFY = {
  filter: 'bright',
  adj: { exposure: 0, brightness: 6, contrast: 8, saturate: 12, vibrance: 4 },
}

// 曝光强度：偏移 ±50 对应 ±1 挡（即 0.5× ~ 2× 进光量）
const ADJ_EXPOSURE_STOPS = 1
// 曝光与色彩浓度的联动系数：提高进光量时颜色更实、降低时更灰（真实拍摄下曝光会连带改变色彩）
const ADJ_EXPOSURE_TINT = 0.25
// 逐像素处理（曝光 / 自然饱和度）的分辨率上限：
// 拖动中用快速档保证跟手，松手与导出用完整档（导出分辨率受画布限制，无需按原图全分辨率处理）
const ADJ_EDGE_FAST = 600
const ADJ_EDGE_FULL = 1600

// sRGB ↔ 线性光的传输曲线（与显示端一致的含暗部线性趾版本）。
// 注意不能用 x^2.2 / x^(1/2.2) 这种互为逆运算的纯幂函数 —— 那样会退化成正反抵消，
// 曝光就等价于纯等比增益（= 亮度），两者无法区分；真曲线在暗部与高光的处理不同。
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/**
 * 逐像素调整（原地修改 RGBA，alpha 不变）：
 *
 * - 曝光 exposure：线性光 × 增益 → 回编码（±50 = ±1 挡进光量，256 项 LUT）。
 *   暗部抬升比亮部明显、高光溢出裁剪，并同步联动色彩浓度（提曝光更实、降曝光更灰），
 *   因此会**连带改变色彩**。与「亮度」的等比增益不同：亮度只缩放、不改变色相与饱和度关系。
 * - 自然饱和度 vibrance：按 HSV 饱和度加权改饱和度。低饱和像素权重≈1（施力大），
 *   已鲜艳像素权重→0（基本不动），故不会溢色、不易出现色彩断层，人像/实拍更自然。
 *
 * 「亮度 / 对比度 / 饱和度」与滤镜预设不属于本函数：它们与曝光/自然饱和度一起，
 * 由 `ensureAdjustedSource()` 在同一次像素遍历里完成（见 applyLinearStage / compileFilter）。
 */
function applyPixelAdjust(data, exposure, vibrance, count) {
  let lut = null
  if (exposure) {
    const gain = Math.pow(2, (exposure / 50) * ADJ_EXPOSURE_STOPS)
    lut = new Float32Array(256)
    for (let i = 0; i < 256; i++) {
      const y = linearToSrgb(srgbToLinear(i / 255) * gain)
      lut[i] = y <= 0 ? 0 : y >= 1 ? 255 : y * 255
    }
  }
  // 饱和度加权总量 = 自然饱和度 + 曝光色彩浓度联动（同属「低饱和多施力」的加权模型）
  const amt = vibrance / 50 + (exposure / 50) * ADJ_EXPOSURE_TINT
  for (let i = 0; i < count; i++) {
    const p = i * 4
    let r = data[p]
    let g = data[p + 1]
    let b = data[p + 2]
    if (lut) {
      r = lut[r]
      g = lut[g]
      b = lut[b]
    }
    if (amt) {
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b
      if (mx > 0) {
        const mn = r < g ? (r < b ? r : b) : g < b ? g : b
        const sat = (mx - mn) / mx // HSV 饱和度 0~1
        // 已鲜艳(sat→1)时 f→1，几乎不动，故不溢色/不断层。
        // f 下限取 0：amt 最小可到 -1.25（自然饱和度 -50 再叠加曝光 -50 的浓度联动），
        // 低饱和像素上 f 可能被算成负数，会让颜色越过灰点反而「反相」（近灰的天空变黄），
        // 钳制后最暗也就是完全去色，这才是「降到最低」应有的表现。
        const f = Math.max(0, 1 + amt * (1 - sat))
        if (f !== 1) {
          r = mx + (r - mx) * f
          g = mx + (g - mx) * f
          b = mx + (b - mx) * f
        }
      }
    }
    data[p] = r
    data[p + 1] = g
    data[p + 2] = b
  }
}

// ===== 颜色算子：CSS filter 函数串 → 逐像素「3×3 矩阵 + 偏移」 =====
//
// 为什么不直接用 ctx.filter 画：
// **iOS 真机的 canvas 2d 不支持 `filter` 属性**（WKWebView 长期未实现该 API；微信官方文档也只说
// canvas 2d「实现了 HTML Canvas 2D Context 的大部分属性、方法」）。给 ctx.filter 赋值会被静默忽略，
// 于是「只写在 ctx.filter 里的」亮度/对比度/饱和度与**全部滤镜预设**在 iOS 真机上一律不生效，
// 而走逐像素的曝光/自然饱和度正常 —— 典型表现就是「增强里只有曝光有用」；
// 滤镜更迷惑：缩略图是 DOM 上的 CSS filter（iOS 支持，预览有变化），点 ✓ 后画布却没反应。
//
// 因此画布不再使用 ctx.filter：把滤镜预设的函数串编译成仿射变换（这些算子都是「矩阵 + 偏移」，
// 可以合并成一次运算），与增强的像素步骤在同一次遍历里完成，各端结果一致。
// 未参与编译的算子只有 blur / opacity / drop-shadow：滤镜表本身不使用它们（见 8.5 节）。
const FILTER_FN_RE = '([a-z-]+)\\(([^()]*)\\)'
const SATURATE_COEF = [0.213, 0.715, 0.072] // 与 CSS saturate / grayscale 同一组亮度系数
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** 3×3 矩阵相乘（行主序 9 元数组） */
const mat3Mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
]
/** 矩阵 × 向量 */
const mat3MulVec = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]
/** 等比缩放算子：c' = c·k（contrast 另需偏移，见 compileFilter） */
const scaleMatrix = (k) => [k, 0, 0, 0, k, 0, 0, 0, k]
/** saturate(s) 的规范矩阵（s=1 为原样） */
const saturateMatrix = (s) => {
  const lr = SATURATE_COEF[0]
  const lg = SATURATE_COEF[1]
  const lb = SATURATE_COEF[2]
  return [
    lr + (1 - lr) * s, lg - lg * s, lb - lb * s,
    lr - lr * s, lg + (1 - lg) * s, lb - lb * s,
    lr - lr * s, lg - lg * s, lb + (1 - lb) * s,
  ]
}
/** sepia(a)：在「原样」与规范 sepia 矩阵之间按 a 插值 */
const sepiaMatrix = (a) => {
  const k = 1 - a
  return [
    0.393 * a + k, 0.769 * a, 0.189 * a,
    0.349 * a, 0.686 * a + k, 0.168 * a,
    0.272 * a, 0.534 * a, 0.131 * a + k,
  ]
}
/** hue-rotate(deg) 的规范矩阵 */
const hueRotateMatrix = (deg) => {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}

/**
 * 把 CSS filter 函数串编译成「矩阵 + 偏移」（sRGB 空间，取值 0~1，与浏览器对 CSS filter 的处理口径一致）。
 * 逐像素的应用顺序与书写顺序相同（先算算子 1，再把它当作算子 2 的输入）。
 * 参数缺失的非标准写法（`brightness()` 之类）直接跳过，不影响其它算子。
 */
function compileFilter(str) {
  let m = IDENTITY3.slice()
  let o = [0, 0, 0]
  const push = (m2, t) => {
    m = mat3Mul(m2, m)
    const mo = mat3MulVec(m2, o)
    o = [mo[0] + t, mo[1] + t, mo[2] + t]
  }
  if (str && str !== 'none') {
    const re = new RegExp(FILTER_FN_RE, 'g')
    let hit = re.exec(str)
    while (hit) {
      const name = hit[1]
      const arg = parseFloat(hit[2])
      if (!isNaN(arg)) {
        if (name === 'brightness') push(scaleMatrix(arg), 0)
        else if (name === 'contrast') push(scaleMatrix(arg), 0.5 - 0.5 * arg) // (c-0.5)·a+0.5
        else if (name === 'saturate') push(saturateMatrix(arg), 0)
        else if (name === 'grayscale') push(saturateMatrix(1 - arg), 0)
        else if (name === 'sepia') push(sepiaMatrix(arg), 0)
        else if (name === 'hue-rotate') push(hueRotateMatrix(arg), 0)
        else if (name === 'invert') push(scaleMatrix(1 - 2 * arg), arg)
      }
      hit = re.exec(str)
    }
  }
  return { m, o }
}

/**
 * 逐像素应用「滤镜预设 + 增强的亮度/对比度/饱和度」（原地修改 RGB，alpha 不变）。
 * 三者先合并成一个矩阵 + 偏移再一次性遍历：1600px 档约 190 万像素，
 * 若每个算子各扫一遍，光遍历开销就是几十毫秒。
 *
 * 矩阵按 0~1 归一化空间定义（与 CSS filter 口径一致），而这里的像素值是 0~255，
 * 因此**只把偏移量乘 255、矩阵系数保持原样**：c'(0~255) = M·c(0~255) + o·255。
 * （若把矩阵也乘 255，等于把输入当成 0~1，任何像素都会被放大 255 倍钳成白色。）
 */
function applyLinearStage(data, count, m, o) {
  const m0 = m[0]
  const m1 = m[1]
  const m2 = m[2]
  const m3 = m[3]
  const m4 = m[4]
  const m5 = m[5]
  const m6 = m[6]
  const m7 = m[7]
  const m8 = m[8]
  const o0 = o[0] * 255
  const o1 = o[1] * 255
  const o2 = o[2] * 255
  for (let i = 0; i < count; i++) {
    const p = i * 4
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    // Uint8ClampedArray 赋值时自动取整并钳到 0~255，负值与溢出无需手工处理
    data[p] = m0 * r + m1 * g + m2 * b + o0
    data[p + 1] = m3 * r + m4 * g + m5 * b + o1
    data[p + 2] = m6 * r + m7 * g + m8 * b + o2
  }
}

/**
 * 合成「滤镜预设 + 亮度/对比度/饱和度」的线性算子；全部为默认时返回 null（零开销，不建离屏画布）。
 * 复用同一套函数串语义（brightness(1+k) 等），与 8.5 节滤镜表的 value 完全一致。
 */
function buildLinearStage(filterKey, adj) {
  const a = adj || ADJ_DEFAULT
  const d = (k) => (a[k] || 0) / 100
  const preset = (FILTER_MAP[filterKey] || FILTER_MAP.none).value
  const parts = []
  if (preset && preset !== 'none') parts.push(preset)
  if (d('brightness')) parts.push(`brightness(${1 + d('brightness')})`)
  if (d('contrast')) parts.push(`contrast(${1 + d('contrast')})`)
  if (d('saturate')) parts.push(`saturate(${1 + d('saturate')})`)
  if (!parts.length) return null
  return compileFilter(parts.join(' '))
}

Page({
  data: {
    layer: 'preview', // preview 沉浸预览 / viewer 查看操作 / edit 图片编辑
    ICON,
    topPadding: 20,
    // 入口直传图片时为 true：进入页面的转场滑入期间不显示选图占位符，保持纯黑沉浸
    hasPendingPath: false,
    shootDate: '',
    shootTime: '',
    favorited: false,
    imagePath: '',
    saving: false,

    // ===== 编辑层 =====
    editTab: 'basic', // basic 基础 / ai AI创作
    panel: '', // 当前展开的工具面板：doodle / text / mosaic / sticker（裁切旋转、滤镜、增强为独立功能栏，不走本字段）
    filter: 'none',
    // ===== 滤镜功能栏 =====
    filterMode: false, // 滤镜模式：功能栏上滑显现、底部导航栏下移隐退
    filterOut: false, // 滤镜功能栏下滑退场中
    filterGroups: FILTER_GROUPS, // 滤镜分类
    filterCat: FILTER_GROUPS[0].key, // 当前分类
    filterItems: FILTER_GROUPS[0].items, // 当前分类下的滤镜项
    filterSrc: '', // 缩略图所用底图（当前底图路径）
    filterTransform: 'none', // 缩略图旋转/镜像（与编辑状态保持一致）
    // ===== 裁切旋转功能栏 =====
    cropMode: false, // 裁切旋转模式：功能栏上滑显现、底部导航栏下移隐退
    bottomOut: false, // 普通底部工具区下滑退场中
    cropOut: false, // 裁切功能栏下滑退场中
    cropRatios: CROP_RATIOS, // 比例预设（自由/原始/全屏/横向全屏/1:1...）
    cropRatio: 'free', // 当前比例 preset
    cropAngleRange: CROP_ANGLE_RANGE, // 角度微调范围（±，供刻度盘 min/max 使用）
    fineAngle: 0, // 当前角度微调值（度），同时作为刻度盘组件的 value
    cropDragging: false, // 裁切框拖动中（显示九宫格辅助线）
    cropping: false, // 裁切导出中（防重复触发）
    // ===== 增强功能栏 =====
    adjustMode: false, // 增强模式：功能栏上滑显现、底部导航栏下移隐退
    adjustOut: false, // 增强功能栏下滑退场中
    adjItems: adjItemsWithValues(ADJ_DEFAULT), // 参数项（含当前值）
    adjKey: ADJ_KEYS[0], // 当前调节的参数项
    adjValue: 0, // 滑杆绑定的值：只在非拖动状态写入，拖动中回写会与手指位置打架
    adjValText: '0', // 数值文案：拖动中只更新它，保证跟手且不触发滑块重定位
    adjMin: -ADJ_RANGE,
    adjMax: ADJ_RANGE,
    penColors: PEN_COLORS,
    penSizes: PEN_SIZES,
    penColor: PEN_COLORS[0],
    penSize: PEN_SIZES[1],
    // 文字面板：输入内容 + 颜色 + 字号档位
    textInput: '',
    textColors: PEN_COLORS,
    textColor: PEN_COLORS[0],
    textSizes: TEXT_SIZES,
    textSize: TEXT_SIZES[1],
    // 马赛克面板：块级 + 笔刷粗细
    mosaicLevels: MOSAIC_LEVELS,
    mosaicLevel: 'mid',
    mosaicSizes: PEN_SIZES,
    mosaicSize: PEN_SIZES[2],
    // 贴纸面板：分类 + 资源列表（由 GET /api/stickers 下发，见 README 8.10）
    stickerCats: [STICKER_ALL],
    stickerCat: STICKER_ALL,
    stickerList: [],
    stickerLoaded: false,
    // ===== AI 创作（Tab 2）：工具行 + AI 功能栏（交互与裁切旋转/滤镜/增强一致）=====
    // 工具行的四项在 WXML 里手写（与「基础」行一致），这里只需当前能力的完整信息供功能栏渲染
    aiStyles: AI_STYLES,
    aiStyle: AI_STYLES[0],
    aiLoading: false,
    aiMode: false, // AI 功能栏上滑显现、底部导航栏下移隐退
    aiOut: false, // AI 功能栏下滑退场中
    aiAbility: AI_ABILITIES[0].key, // 当前功能栏对应的能力
    aiInfo: AI_ABILITIES[0], // 当前能力信息（标题 / 说明 / 处理要点，供说明卡渲染）
    aiBlockReason: '', // 非空 = 该能力当前不可提交（今日额度用完 / 未配置密钥），✓ 置灰并显示原因
    aiQuotaText: '', // 该能力的今日额度文案（GET /api/ai/quota；查询失败则保持为空、不显示）
    canUndo: false,
    canRedo: false,
    hasEdits: false,
    // 直达入口（首页 AI 卡片 / 工具面板带 ai / panel 参数）：首帧就已经在目标布局里，
    // 功能栏不再播放「从下往上滑入」的进场动画（否则一进页就有一整块深色面板盖上来）
    directEntry: false,
    // 首帧占位图：DOM `<image>` 先按与 canvas 相同的 aspectFit 显示本地图，
    // canvas 画出第一帧后立刻清空。canvas 是独立合成层、可能晚于 DOM 上屏，
    // 有了它就不会出现「黑底空画布」的空窗（见 11.3 第 67 条 / M63）
    pendingPreview: '',
    // canvas 节点是否已挂载：直达入口要等页面自身渲染完（占位图 bindload）再挂载，
    // 避免「空 canvas 图层」在转场期间先于页面参与合成（见 11.3 第 67 条）
    canvasMounted: false,
  },

  onLoad(options) {
    this.setData({ topPadding: getSafeTop(8) })
    // 屏幕尺寸：供「全屏 / 横向全屏」比例预设使用
    const win = wx.getWindowInfo()
    this.winW = win.windowWidth || 375
    this.winH = win.windowHeight || 667
    // 裁切角度微调（0 表示未矫正）
    this.fineAngle = 0
    // 增强参数（偏移量口径，0 表示默认）
    this.adj = { ...ADJ_DEFAULT }
    // imagePath 直传（相机拍摄/首页导入/模板页等入口均已编码）；微信可能在部分平台
    // 对 query 自动解码一次，这里做安全解码：失败则按已解码值使用
    let rawPath = (options && options.imagePath) || ''
    if (rawPath) {
      try {
        rawPath = decodeURIComponent(rawPath)
      } catch (e) {
        // 已是解码态（含非法 % 序列），直接用原值
      }
    }
    this.pendingPath = rawPath
    // hasPendingPath：转场期间不显示「点击选择图片」占位；
    // pendingPreview：首帧的 DOM 占位图（本地临时路径，渲染几乎无延迟）
    this.setData({ hasPendingPath: !!rawPath, pendingPreview: rawPath })
    // 模板页带入的模板（后端 file_path 相对路径）。模板页同样用 encodeURIComponent 编码，
    // 这里做与 imagePath 一致的安全解码：失败则按已解码值使用
    let rawTemplate = (options && options.template) || ''
    if (rawTemplate) {
      try {
        rawTemplate = decodeURIComponent(rawTemplate)
      } catch (e) {
        // 已是解码态（含非法 % 序列），直接用原值
      }
    }
    this.pendingTemplate = rawTemplate
    // 相机页选中的相框（none = 不套相框）。取值只在 utils/frames.js 的 FRAMES 里，
    // 非法值由 normalizeFrame 回落 none；它不是「底图的一部分」，而是会话级装饰层（见 render）
    this.frameKey = normalizeFrame(options && options.frame)
    this._exportWithFrame = true // 导出是否含相框：仅最终导出（保存/下载）为 true，见 exportRegion
    // 首页 AI 卡片带入的能力标识（matting / style / enhance / beauty / background / hair）：
    // **直达**对应 AI 功能栏，省掉「进编辑页 → 切 AI创作 → 点该能力」三步（见 consumeAiEntry）。
    // 白名单校验：取值只能是 AI_ABILITIES 里的 key，非法值按未带入处理（入口参数可能被手改）
    const rawAi = (options && options.ai) || ''
    this.pendingAi = AI_ABILITIES.some((x) => x.key === rawAi) ? rawAi : ''
    // 首页工具入口带入的底部面板名（doodle / text / mosaic / sticker）：同样白名单校验 +
    // 一次性消费，直达该面板（见 consumePanelEntry）
    const rawPanel = (options && options.panel) || ''
    this.pendingPanel = ENTRY_PANELS.indexOf(rawPanel) >= 0 ? rawPanel : ''

    // ===== 直达入口：**首帧就落在最终布局**（见 11.3 第 67 条 / M62）=====
    // 旧实现让这两类入口先停在「沉浸预览」层，等首图加载完成后再 setLayer('edit') 并播放
    // 「底部工具区下移 → 功能栏上滑」序列 —— 用户看到的是「整屏图片闪一下 → 一片深色工具栏 /
    // 功能栏盖上来」，即「先显示图片、再出现黑幕」。而「导入 / 拍照」不带 ai / panel 参数、
    // 停在预览层或走另一个页面，没有这次层级切换，所以观感正常。
    // 现在把 layer / editTab / aiMode / panel 直接写进首帧：页面一出现就是目标形态，
    // 图片就绪后只是在**既定布局**里画出来，不再有层级切换与二次进场动画。
    if (this.pendingAi || this.pendingPanel) {
      const patch = { layer: 'edit', directEntry: true }
      if (this.pendingAi) {
        const info = AI_ABILITIES.find((x) => x.key === this.pendingAi) || AI_ABILITIES[0]
        this._aiDirect = true
        patch.editTab = 'ai'
        patch.aiMode = true
        patch.aiAbility = info.key
        patch.aiInfo = info
        patch.aiBlockReason = (this._aiBlocked || {})[info.key] || ''
      } else {
        patch.editTab = 'basic'
        patch.panel = this.pendingPanel
        // 贴纸资源提前拉：首帧就能显示列表或「加载中」，避免面板先撑开一次再变高
        if (this.pendingPanel === 'sticker') this.loadStickers()
      }
      this.setData(patch)
    }

    this.workId = 0
    this.applyCaptureTime(Number(options && options.captureTime) || Date.now())
  },

  /**
   * 本次渲染是否需要绘制相框（`hasFrame` 来自 utils/frames.js）。
   * 显示与**最终导出**（保存 / 下载到相册）都要画；但「内部拍平导出」不画 ——
   * 裁切、涂鸦拍平、AI 入参都会把结果重新作为底图载入，若把相框一起拍进去，
   * 之后又会在新底图上再画一遍，出现「双重边框」。
   */
  shouldDrawFrame() {
    if (!hasFrame(this.frameKey)) return false
    if (this._exportOffset && !this._exportWithFrame) return false
    return true
  },

  /**
   * 叠加层 id：`前缀_时间戳_自增序号`。
   *
   * 只有 `Date.now()` 时，同一毫秒内连续添加两项（快速连点「添加文字 / 贴纸」）会撞 id，
   * 而拖动与选中都按 id 查找（`find(x => x.id === sel)`）→ 命中错误的那一项，
   * 表现为「拖这个动那个」、选中框乱跳。序号保证唯一，时间戳保留可读性。
   */
  nextOverlayId(prefix) {
    this._overlaySeq = (this._overlaySeq || 0) + 1
    return `${prefix}_${Date.now()}_${this._overlaySeq}`
  },

  /**
   * 登记一个延时回调：页面 `onUnload` 之后不再执行，并在卸载时统一清掉。
   *
   * 本页有 10 处延时（功能栏进/出场动画各 240ms、入口参数等待 80ms、画布量取重试等）。
   * 页面在延时窗口内被销毁时（用户点返回、或被 `wx.reLaunch` 换掉），回调仍会跑一次
   * `setData` —— 轻则控制台刷「setData called after page unload」，重则对已离开的页面
   * 再执行一次 `syncViewport()`。统一走这里就没有这个问题。
   */
  later(fn, delay) {
    if (!this._timers) this._timers = []
    const id = setTimeout(() => {
      this._timers = this._timers.filter((x) => x !== id)
      if (this._destroyed) return
      fn()
    }, delay)
    this._timers.push(id)
    return id
  },

  /**
   * 功能栏（裁切 / 滤镜 / 增强 / AI）进入动画的互斥锁。
   *
   * 四个功能栏的互斥守卫看的是 `data.xxxMode`，而该字段要等 240ms 动画走完才置位 ——
   * 动画窗口内再点另一个入口会**两个功能栏同时上滑**（它们占同一个底部区域、彼此叠住）。
   * 这里在整个动画窗口内持锁，第二次进入直接忽略。
   */
  beginBarAnim() {
    if (this._barBusy) return false
    this._barBusy = true
    this.later(() => {
      this._barBusy = false
    }, 240)
    return true
  },

  /**
   * 合并同一帧内的多次重绘请求（拖动/涂抹等高频路径专用）。
   *
   * touchmove 一帧内可能触发多次，每次都整幅重绘纯属浪费（真机上是明显的掉帧与发热）。
   * 这里把重绘推迟到下一帧动画回调，同一帧里调用多少次都只画一次；状态本身仍是同步改的
   * （裁切框、笔迹点都立刻写入），只是「画」被合并了。
   *
   * 导出期间直接不画：那时画布缓冲区被临时裁成目标区域（`_exportOffset`），
   * 只能由 `_doExport()` 按导出尺寸绘制，复原时再画回显示尺寸（见 exportRegion）。
   */
  scheduleRender() {
    if (this._exportOffset) return
    if (this._renderQueued) return
    this._renderQueued = true
    const canvas = this.canvas
    const run = () => {
      this._renderQueued = false
      if (this._destroyed || !this.canvas || this._exportOffset) return
      this.render()
    }
    if (canvas && canvas.requestAnimationFrame) canvas.requestAnimationFrame(run)
    else this.later(run, 16)
  },

  /**
   * 释放逐像素处理用的离屏画布。
   *
   * 它按「长边 ≤ ADJ_EDGE_FULL」常驻（1600×1600 的 RGBA 约 10MB），留在身边是为了拖动时复用，
   * 但换底图 / 清空编辑 / 离开页面之后没有任何复用价值 —— 白占内存，真机上更容易触发内存回收。
   */
  dropAdjustOffscreen() {
    this._adjOff = null
    this._adjOffW = 0
    this._adjOffH = 0
  },

  /** 第二层头部日期/时间：优先取拍摄时刻，回落到进入页面的时刻 */
  applyCaptureTime(ts) {
    const d = new Date(ts)
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    this.setData({
      shootDate: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
      shootTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    })
  },

  onReady() {
    // 页面就绪后 canvas 才可查询；随后加载首个图像
    this.layerStickers = []
    this.doodles = []
    this.undoStack = []
    this.redoStack = []
    // ⚠️ **页面转场结束前不要挂载 / 绘制 canvas**（M64）：canvas 是**独立合成层**，
    // 它**不参与页面转场动画** —— 页面还在从右侧滑入时，canvas 已经把图按最终位置画在
    // 屏幕上，于是出现「图片先出现在上一页 → 黑幕（新页背景）随后从右侧滑进来」。
    // 微信没有「转场结束」事件，按默认 300ms 的转场时长留出余量（400ms）；这段时间里
    // 用户看到的是 DOM 占位图（`.anchor-photo`），它跟着页面一起滑入，所以不会有空窗。
    this._readyFired = true
    if (!this.pendingPath) this._placeholderReady = true
    this.later(() => {
      this._transitionDone = true
      this.maybeStartCanvas()
    }, 400)
    // 兜底：占位图迟迟不 load（网络图 / 加载失败）时也不能一直不初始化画布
    this._canvasFallback = this.later(() => this.maybeStartCanvas(true), 900)
  },

  /**
   * DOM 占位图渲染完成（本地图通常一两帧内）：它跟着页面一起滑入，
   * 是「页面已有可见内容」的信号；真正启动 canvas 还要等转场结束。
   */
  onPreviewPhotoLoad() {
    this._placeholderReady = true
    if (this._readyFired) this.maybeStartCanvas()
  },

  /** 两个条件（转场结束 + 占位图已渲染）都满足才启动；force 用于兜底定时器 */
  maybeStartCanvas(force) {
    if (this._canvasStarted || this._destroyed) return
    if (!force && (!this._transitionDone || !this._placeholderReady)) return
    this.startCanvasAfterFirstPaint()
  },

  /** 页面首帧上屏后：初始化画布 → 量视口 → 载入首图（与 M60 的「并行」口径不冲突） */
  startCanvasAfterFirstPaint() {
    if (this._canvasStarted || this._destroyed) return
    this._canvasStarted = true
    if (this._canvasFallback) {
      clearTimeout(this._canvasFallback)
      this._canvasFallback = null
    }
    // 先只挂载 canvas 节点（此时仍不绘制），再查询节点初始化。
    // 走到这里时页面转场已经结束、占位图也已在屏上，因此不会再出现
    // 「图片先出现在上一页、黑幕随后滑入」的中间帧。
    this.setData({ canvasMounted: true }, () => {
      if (this._destroyed) return
      this.initCanvasAndFirstImage()
    })
  },

  /** 挂载 canvas 之后的初始化：拿节点 → 量视口 → 载入首图 */
  initCanvasAndFirstImage() {
    // 画布的屏幕矩形（触摸坐标 → 画布 px 的换算基准）：canvas 是 wx:if 挂载的，
    // 必须在挂载后再量（onReady 里会拿到 null，涂鸦/裁切的落点会全错）
    this.measureCanvasRect()
    this.ensureCanvas().then((ok) => {
      if (!ok) {
        wx.showToast({ title: '画布初始化失败', icon: 'none' })
        return
      }
      // 视口量取（1~2 帧）与图片解码（相册大图 100~400ms）互不依赖，必须**并行**：
      // 串行会把唯一的长耗时项排在两段等待之后。首帧允许先按「整块画布」绘制
      // （沉浸层的 .anchor 恰好就是整块），syncViewport 落位后会自己 render() 一次校正，
      // 两种先后顺序都不会把画面停在错误几何上。
      this.syncViewport()
      // 图片由入口（相机拍摄/首页导入/模板页）直接传入 —— 有参时直接加载进沉浸预览；
      // 无参直达（如开发者工具直接编译本页）则停留在占位符，点击占位符选图，不再自动弹相册
      if (this.pendingPath) this.loadImage(this.pendingPath)
    })
  },

  onUnload() {
    // 离开页面时停掉 AI 等待的定时器并收起 loading：loading 是**全局浮层**，
    // 页面卸载不会把它带走（失败返回/连点两次返回时会把上一个页面也盖住）
    this.stopAiTimers()
    // 动画/延时回调全部作废：先挂销毁标记（晚到的 setTimeout 会据此直接返回），再清计时器
    this._destroyed = true
    ;(this._timers || []).forEach((id) => clearTimeout(id))
    this._timers = []
    this.dropAdjustOffscreen() // 离屏画布（最长边 1600，RGBA 约 10MB）随页面一起放掉
    wx.hideLoading()
    this.canvas = null
  },

  /** 量取画布在屏幕中的矩形（触摸换算基准）；挂载后首帧可能还查不到，重试几次 */
  measureCanvasRect(retry = 0) {
    this.createSelectorQuery()
      .select('#editorCanvas')
      .boundingClientRect((rect) => {
        if (rect && rect.width > 0 && rect.height > 0) {
          this.canvasRect = rect
          return
        }
        if (retry < 10) setTimeout(() => this.measureCanvasRect(retry + 1), 50)
      })
      .exec()
  },

  /** 初始化 canvas 2D（缓存 node/dpr/尺寸）；Skyline 首帧布局未稳时 query 可能为空，重试 */
  ensureCanvas(retry = 0) {
    return new Promise((resolve) => {
      if (this.canvas && this.ctx) {
        resolve(true)
        return
      }
      this.createSelectorQuery()
        .select('#editorCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const info = res && res[0]
          if (!info || !info.node) {
            if (retry < 10) {
              setTimeout(() => this.ensureCanvas(retry + 1).then(resolve), 50)
            } else {
              resolve(false)
            }
            return
          }
          this.canvas = info.node
          this.ctx = info.node.getContext('2d')
          this.dpr = wx.getWindowInfo().pixelRatio
          this.pxW = (info.width || 320) * this.dpr
          this.pxH = (info.height || 320) * this.dpr
          this.canvas.width = this.pxW
          this.canvas.height = this.pxH
          // 默认绘制视口 = 整块画布（沉浸层）
          this.viewport = { x: 0, y: 0, w: info.width || 320, h: info.height || 320 }
          // ⚠️ 这里**不要**铺黑（M64）：canvas 在页面 DOM 之上，此刻图还没解码，
          // 先铺黑会把下面的 DOM 占位图盖掉 —— 表现就是「黑幕先出现、然后才出图片」
          // （导入 入口的闪动正是它）。黑幕与图片改为在同一次 render() 里一起画。
          resolve(true)
        })
    })
  },

  /**
   * 把沉浸预览层的黑幕**画进画布本身**（见 README 11.3 第 64 条）。
   *
   * 页面 CSS 背景（`.layer-preview` 的 #000）与 canvas 是两层，谁先合成上屏不受业务代码
   * 控制 —— 只靠 CSS 时会出现「图片先上屏、黑幕晚一帧」的闪白/闪灰。让黑幕与图片同层同帧：
   * ① 缓冲区一分配（`ensureCanvas` 设完 canvas.width/height，该动作本身会清空内容）就铺一次；
   * ② 显示态每次 `render()` 在 `clearRect` 后**立刻**再铺一次。
   *
   * ⚠️ 边界：只在 `layer === 'preview'` 且**不在导出中**时铺。编辑层 / 查看层 / 导出缓冲区
   * 一律不铺 —— 画布视觉上压在普通 DOM 之上，铺黑会把编辑层的头部与底部工具栏一起盖住，
   * 查看层也会失去浅灰底。
   */
  paintBackdrop() {
    const { ctx } = this
    if (!ctx) return
    if (this.data.layer !== 'preview' || this._exportOffset) return
    ctx.save()
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, this.pxW, this.pxH)
    ctx.restore()
  },

  /**
   * 撤掉首帧的 DOM 占位图（`pendingPreview`）。
   *
   * 只在「图片已解码 + 视口已量到」时撤：画布这时已经有正确的一帧，
   * 否则会露出空画布（黑底），又变成一次闪断。
   */
  dropPreviewPhoto() {
    if (!this.data.pendingPreview) return
    if (!this.imgReady || !this._vpReady) return
    this.setData({ pendingPreview: '' })
  },

  /** 切换层，并在布局稳定后重新量取绘制视口 */
  setLayer(next) {
    if (this.data.layer === next) return
    this.setData({ layer: next }, () => {
      this.syncViewport()
    })
  },

  /** 量取 .anchor 在页面中的矩形作为绘制视口（CSS px） */
  syncViewport(retry = 0) {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('.anchor')
        .boundingClientRect((rect) => {
          if (rect && rect.width > 0 && rect.height > 0) {
            this.viewport = { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
            // 视口已确定：允许 render() 真正落笔（此前首帧按整块画布画会「先大后小」）
            this._vpReady = true
            // 导出期间（_exportOffset 非空）**不能重绘**：导出把画布缓冲区裁剪成目标区域、
            // 并按当时的视口几何把画面平移到左上角，此时若被一次「按新视口」的重绘插进来，
            // 截到的就是错位/缩放不对的画面。离开涂鸦面板的拍平（bakeDoodles）正好会
            // 在导出进行中触发本方法（setPanel → syncViewport），是最容易踩中的路径。
            // 视口本身照常更新：导出结束后的 restore() 会用它重绘，不会停留在旧几何。
            if (!this._exportOffset) {
              this.render()
              // 裁切模式下视口变化（进出功能栏）后同步重算裁切框
              if (this.data.cropMode) this.computeCropUI()
            }
            resolve(true)
          } else if (retry < 10) {
            setTimeout(() => this.syncViewport(retry + 1).then(resolve), 50)
          } else {
            // 量不到视口（极端布局异常）：按「整块画布」兜底并允许绘制，
            // 否则 render() 会一直等 _vpReady，页面停在空白/只有黑底
            this._vpReady = true
            if (!this._exportOffset) this.render()
            resolve(false)
          }
        })
        .exec()
    })
  },

  /** 轻触屏幕：沉浸预览 ⇄ 查看操作（图片1 ↔ 图片2） */
  onStageTap() {
    if (this.data.layer === 'preview') this.setLayer('viewer')
    else if (this.data.layer === 'viewer') this.setLayer('preview')
  },

  /** 选择图片 */
  onPickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        this.applyCaptureTime(Date.now())
        this.setLayer('preview')
        this.loadImage(path)
      },
    })
  },

  /** 加载图片到 canvas（作为新的原图，重置全部编辑状态） */
  loadImage(path) {
    this.basePath = path
    // 记录「进入页面/重新选图时的原图」：既是 hasChanges() 的比对基准（决定「保存」按钮是否高亮），
    // 也是「更多 → 重置为原图」的还原目标，缺此赋值会导致保存恒高亮且无法重置
    this.originalPath = path
    this.workId = 0
    this.resetState()
    // 页内换图同样先挂 DOM 占位图：新底图解码期间不会留一块空黑
    this.setData({ imagePath: path, favorited: false, pendingPreview: path })
    this.ensureCanvas().then(() => {
      if (!this.canvas) {
        wx.showToast({ title: '画布初始化失败', icon: 'none' })
        return
      }
      // 首图加载完成后依次消费一次性入口参数：模板叠加（pendingTemplate）→ 直达 AI 功能栏
      // （pendingAi）→ 直达底部工具面板（pendingPanel）。
      // 三者都是一次性消费，后续换图不再重复套用；AI 功能栏与工具面板互斥（同一个底部区域），
      // consumeAiEntry 消费掉能力标识时会一并丢弃面板参数（见该函数）。
      //
      // ⚠️ 链首必须用 `Promise.resolve()` 起链，**不能**直接 `this.consumeTemplate().then(...)`：
      // 三个 consume* 都是**同步**方法、返回 `undefined`（模板叠加本身就是异步的，
      // 由 applyTemplateOverlay 自己的 img.onload 继续），而 `undefined.then` 会抛 TypeError。
      // 该异常发生在 `.then` 回调里 → 只留一条「未处理的 Promise 拒绝」，页面照常显示图片，
      // 但 consumeAiEntry / consumePanelEntry 永远不会执行 —— 现象就是「首页点功能图标能进
      // 编辑页，却不再直达对应 AI 功能栏 / 工具面板」，且没有任何报错提示（M60）。
      return this.reloadImage(path)
        .then((ok) => {
          // 底图没载入成功就不要消费一次性入口参数：它们「用掉就没了」，
          // 消费掉之后用户看到的是「模板没套上 / AI 面板没打开」，重进一次也无济于事
          if (!ok) return
          return Promise.resolve()
            .then(() => this.consumeTemplate())
            .then(() => this.consumeAiEntry())
            .then(() => this.consumePanelEntry())
        })
    })
  },

  /**
   * 重置编辑状态（进入新原图时调用）。
   * 注意**不动 `this.frameKey`**：相框由相机页入口参数带入、属于会话级装饰，
   * 「换图」「取消编辑（放弃修改）」「重置为原图」都应保留用户选好的相框 ——
   * 它本来就不是底图的一部分（渲染期绘制，见 shouldDrawFrame）。
   */
  resetState() {
    this.rotation = 0
    this.flipX = false
    this.flipY = false
    this.filter = 'none'
    this.adj = { ...ADJ_DEFAULT }
    this.cropRatio = 'free'
    this.cropBox = null
    this.fineAngle = 0
    this._noOverlay = false // 导出期间隐藏裁切框等叠加绘制
    this._exportOffset = null // 导出期缓冲区偏移（见 exportRegion）
    this._cropPrev = null // 进入裁切前的 rotation/fineAngle（取消时还原）
    this.doodles = []
    this.texts = []
    this.mosaics = []
    this._textSel = null
    this._stroke = null
    this._text = null
    this._mosaic = null
    this._stk = null
    this._stkSel = null
    this._pixelSrcs = {}
    this.layerStickers = []
    // 本次会话是否用过 AI（只影响保存时的作品类型标记，换图/放弃后清零）
    this._aiAbility = ''
    this.undoStack = []
    this.redoStack = []
    this._adjustPrev = null
    this._adjustSnap = null
    // 逐像素底图（曝光/自然饱和度）缓存：换底图即失效
    this.adjSrc = null
    this._adjSrcKey = ''
    this._adjFast = false
    this.setData({
      filter: 'none',
      adjKey: ADJ_KEYS[0],
      adjItems: adjItemsWithValues(ADJ_DEFAULT),
      adjValue: 0,
      adjValText: '0',
      cropRatio: 'free',
      cropMode: false,
      filterMode: false,
      adjustMode: false,
      aiMode: false,
      bottomOut: false,
      cropOut: false,
      filterOut: false,
      adjustOut: false,
      aiOut: false,
      cropDragging: false,
      fineAngle: 0,
      canUndo: false,
      canRedo: false,
      hasEdits: false,
    })
    this.dropAdjustOffscreen() // 换底图/清空编辑后，逐像素离屏画布没有复用价值了
  },

  /** 把 this.adj 同步进 data：参数项列表（含各自当前值）+ 当前参数项的滑杆值与数值文案 */
  pushAdjData() {
    const items = adjItemsWithValues(this.adj)
    const cur = items.find((x) => x.key === this.data.adjKey) || items[0]
    const val = cur ? cur.value : 0
    this.setData({ adjItems: items, adjValue: val, adjValText: adjValLabel(val) })
  },

  /**
   * 丢弃逐像素底图（曝光 / 自然饱和度）缓存，把「像素源」还原为原图。
   *
   * 两个缓存必须同时失效：
   * ① adjSrc / _adjSrcKey：buildFilter() 依据 adjSrc 判断「曝光/自然饱和度是否已由逐像素处理」，
   *    残留旧值会让 ctx.filter 近似兜底被跳过，参数静默失效；
   * ② _pixelSrcs（马赛克像素化底图，按「底图 + 块级」缓存）：它可能正是由旧 adjSrc 绘制的，
   *    若只在 adjSrc ≠ null 时清空 ②，把曝光/自然饱和度调回 0 后，打码区域会仍残留上一次的
   *    亮度与色彩（马赛克块与周围底图不一致）。
   * 注意仅在 adjSrc 确实非空时才清 ②：否则每次 render 都会重建马赛克离屏图，涂抹时明显掉帧。
   */
  dropAdjustedSource() {
    if (this.adjSrc) this._pixelSrcs = {}
    this.adjSrc = null
    this._adjSrcKey = ''
  },

  /**
   * 逐像素处理底图（**滤镜预设 + 增强五项**），返回离屏 canvas；全部为默认值时返回 null（直接用原图，零开销）。
   * 结果按「底图 + 滤镜 + 增强参数 + 分辨率档」缓存，只在其中任一项或底图变化时重算：
   * 拖动中传 fast=true 用低分辨率档保证跟手，松手/导出用完整档。
   *
   * 为什么滤镜也走这里：**iOS 真机的 canvas 2d 不支持 ctx.filter**（见 compileFilter 的说明），
   * 只把参数写进 ctx.filter 的话，iOS 上亮度/对比度/饱和度与全部滤镜预设都会静默失效。
   * 离屏 canvas 不可用或取像素失败（如画布被跨域图片污染）时返回 null，
   * 此时 buildFilter() 会退化为 ctx.filter 近似，保证参数在支持该属性的平台上不会完全失效。
   * 所有返回 null 的分支统一走 dropAdjustedSource()（见 11.3 第 12 条）。
   */
  ensureAdjustedSource(fast) {
    const adj = this.adj || ADJ_DEFAULT
    const exposure = adj.exposure || 0
    const vibrance = adj.vibrance || 0
    // 滤镜预设 + 亮度/对比度/饱和度 合并成一个 3×3 矩阵 + 偏移（一次遍历完成）
    const linear = buildLinearStage(this.filter || 'none', adj)
    if (!exposure && !vibrance && !linear) {
      this.dropAdjustedSource()
      return null
    }
    // 底图不可用时同样要清掉 adjSrc：buildFilter() 依据它判断「是否已走逐像素」，
    // 残留的旧值会让 ctx.filter 近似兜底被跳过、参数静默失效
    if (!this.img || !this.imgW || !this.imgH) {
      this.dropAdjustedSource()
      return null
    }
    const edge = fast ? ADJ_EDGE_FAST : ADJ_EDGE_FULL
    const key = [
      this.basePath || '', this.filter || 'none', exposure, vibrance,
      adj.brightness || 0, adj.contrast || 0, adj.saturate || 0, edge,
    ].join('|')
    if (this._adjSrcKey === key && this.adjSrc) return this.adjSrc

    const scale = Math.min(1, edge / Math.max(this.imgW, this.imgH))
    const w = Math.max(2, Math.round(this.imgW * scale))
    const h = Math.max(2, Math.round(this.imgH * scale))
    // 复用离屏画布：拖动时每帧都新建会带来明显的分配/GC 抖动（尺寸变化时才重建）
    let off = this._adjOff
    if (!off || this._adjOffW !== w || this._adjOffH !== h) {
      off = null
      try {
        off = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
      } catch (e) {
        off = null
      }
      if (!(off && off.getContext && off.getContext('2d'))) {
        this.dropAdjustedSource()
        return null
      }
      this._adjOff = off
      this._adjOffW = w
      this._adjOffH = h
    }
    const c = off.getContext('2d')
    if (!c) {
      this.dropAdjustedSource()
      return null
    }
    try {
      c.clearRect(0, 0, w, h)
      c.drawImage(this.img, 0, 0, w, h)
      const imgData = c.getImageData(0, 0, w, h)
      // 顺序：滤镜预设 + 亮度/对比度/饱和度（线性）→ 曝光（线性光增益 LUT）→ 自然饱和度（加权）
      if (linear) applyLinearStage(imgData.data, w * h, linear.m, linear.o)
      if (exposure || vibrance) applyPixelAdjust(imgData.data, exposure, vibrance, w * h)
      c.putImageData(imgData, 0, 0)
    } catch (e) {
      this.dropAdjustedSource()
      return null
    }
    this.adjSrc = off
    this._adjSrcKey = key
    // 马赛克像素化底图基于旧底图，需按新底图重建
    this._pixelSrcs = {}
    return off
  },

  // ================= 第三层：图片编辑 =================

  /** 第二层「编辑」→ 编辑层 */
  onEnterEdit() {
    if (!this.data.imagePath) {
      this.onPickImage()
      return
    }
    this.setLayer('edit')
  },

  /**
   * 编辑层「取消」：**放弃本次修改**并回到查看层。
   *
   * 与「保存」对称：保存 = 写入「我的作品」，取消 = 丢弃（见 M30）。有改动时先弹确认框 ——
   * AI 结果、滤镜、涂鸦等都会随「放弃」一起丢弃，误触代价是重做一遍（AI 还要再花额度），
   * 所以不能点一下就退。无改动时直接返回，不打扰。
   */
  onEditCancel() {
    if (!this.hasChanges()) {
      this.backToViewer()
      return
    }
    wx.showModal({
      title: '放弃本次编辑？',
      content: '未保存的修改不会写入「我的作品」，放弃后将回到进入编辑前的图片。',
      confirmText: '放弃',
      cancelText: '继续编辑',
      success: (res) => {
        if (!res.confirm) return
        this.discardEdits()
        this.backToViewer()
      },
    })
  },

  /** 退出编辑层回查看层（三层共用同一块画布，切层不重建、不动画） */
  backToViewer() {
    this.setPanel('')
    this.setLayer('viewer')
  },

  /** 放弃全部编辑：还原为进入编辑前的原图（resetState 会连撤销栈一起清空，避免撤回到已放弃的状态） */
  discardEdits() {
    if (!this.originalPath) return
    const prevBasePath = this.basePath
    this.basePath = this.originalPath
    this.resetState()
    // 载入失败要回滚 basePath：否则「保存按钮高亮 / 重置为原图」都基于一张并未载入的图
    // —— 画面还是旧的，状态却认为已经是原图（口径同 reloadImage 的失败语义）
    this.reloadImage(this.originalPath).then((ok) => {
      if (ok) return
      this.basePath = prevBasePath
      this.refreshFlags()
    })
  },

  /** 编辑层「保存」：导出 → 上传 → 创建作品，回到查看层 */
  onEditSave() {
    if (!this.imgReady || this.data.saving) return
    if (!this.hasChanges()) {
      wx.showToast({ title: '还没有任何修改', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    this.saveAsWork()
      .then(() => {
        this.setData({ favorited: true })
        this.setPanel('')
        this.setLayer('viewer')
        wx.showToast({ title: '已保存到我的作品', icon: 'success' })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
      })
      .finally(() => this.setData({ saving: false }))
  },

  /** 底部 Tab：基础 / AI创作 */
  onEditTab(e) {
    const tab = e.currentTarget.dataset.tab
    // 同一点击兼作「关闭当前工具面板」，因此先走 setPanel（其中已包含视口重算）
    this.setPanel('')
    if (tab === this.data.editTab) return
    // 两个 Tab 的底部工具区高度不同（AI 创作多一行风格胶囊），绘制视口（.anchor）随之变化：
    // 必须重新量取，否则图片仍按旧视口缩放、与新的可见区域错位，要等下一次重绘才恢复。
    // setData 回调在视图层更新完成后执行，此时量取到的才是新布局
    this.setData({ editTab: tab }, () => this.syncViewport())
  },

  /** 工具入口分发：裁切旋转 / 滤镜 / 增强为独立功能栏，其余为底部内联面板 */
  togglePanel(e) {
    const key = e.currentTarget.dataset.panel
    if (!this.imgReady) return
    if (key === 'crop') {
      this.enterCrop()
      return
    }
    if (key === 'filter') {
      this.enterFilter()
      return
    }
    if (key === 'adjust') {
      this.enterAdjust()
      return
    }
    // 任一独立功能栏（含 AI 功能栏）展开时，工具行已被下移隐退，这里仅作兜底拦截
    if (this.data.cropMode || this.data.filterMode || this.data.adjustMode || this.data.aiMode) return
    // 贴纸面板用后端下发的资源列表，首次展开时拉取（失败也有终态，不会一直显示「加载中」）
    if (key === 'sticker' && !this._stickerAll) this.loadStickers()
    this.setPanel(this.data.panel === key ? '' : key)
  },

  setPanel(next) {
    const prev = this.data.panel
    if (prev === next) return
    // 离开涂鸦面板时把笔迹烘焙进当前底图，避免叠加层与变换互相影响
    // （烘焙是整幅画面拍平，同屏的文字/马赛克会一并进入底图并清空状态）
    if (prev === 'doodle' && this.doodles.length) {
      this.bakeDoodles()
    }
    // 离开贴纸 / 文字面板时收掉选中框（它只用于拖动定位的即时反馈；文字此前漏清，
    // 表现为「关闭面板后白色虚线框仍留在画面上」）
    if (prev === 'sticker') this._stkSel = null
    if (prev === 'text') this._textSel = null
    this.setData({ panel: next })
    this.syncViewport()
  },

  /**
   * 收起底部工具面板（含离开时的收尾）：进入功能栏（裁切 / 滤镜 / 增强 / AI）时用。
   *
   * 与 `setPanel('')` 的唯一区别是**不重算视口** —— 那四个功能栏是「工具区下移 → 功能栏上滑」
   * 的两段动画，视口由各自动画结束后再 `syncViewport()` 量取，这里量只会量到动画中间态。
   * 但收尾逻辑必须与 `setPanel` 保持一致：离开涂鸦面板要先把笔迹烘焙进底图（否则笔迹会跟着
   * 后面的裁切/旋转一起被变换，还会在下一次「拍平为新底图」时被再画一遍），
   * 离开贴纸面板要收掉选中框。
   */
  closePanel() {
    const prev = this.data.panel
    if (prev === 'doodle' && this.doodles.length) this.bakeDoodles()
    if (prev === 'sticker') this._stkSel = null
    if (prev === 'text') this._textSel = null
    if (prev) this.setData({ panel: '' })
  },

  /** 撤销 */
  onUndo() {
    if (!this.undoStack.length) return
    const cur = this.snapshot()
    const prev = this.undoStack.pop()
    this.redoStack.push(cur)
    this.applySnapshot(prev)
  },

  /** 重做 */
  onRedo() {
    if (!this.redoStack.length) return
    const cur = this.snapshot()
    const next = this.redoStack.pop()
    this.undoStack.push(cur)
    this.applySnapshot(next)
  },

  /** 翻转（编辑层撤销行的右侧按钮：左右镜像） */
  onFlip() {
    if (!this.imgReady) return
    this.pushHistory()
    this.flipX = !this.flipX
    this.render()
    this.refreshFlags()
  },

  /** 一键美化：套用美化预设，再点一次还原 */
  onBeautify() {
    if (!this.imgReady) return
    const on =
      this.filter === BEAUTIFY.filter &&
      ADJ_KEYS.every((k) => (this.adj[k] || 0) === (BEAUTIFY.adj[k] || 0))
    this.pushHistory()
    if (on) {
      this.filter = 'none'
      this.adj = { ...ADJ_DEFAULT }
    } else {
      this.filter = BEAUTIFY.filter
      this.adj = { ...BEAUTIFY.adj }
    }
    this.setData({ filter: this.filter })
    this.pushAdjData()
    this.render()
    this.refreshFlags()
    wx.showToast({ title: on ? '已还原' : '已一键美化', icon: 'none' })
  },

  // ---------- 裁切旋转（独立功能栏） ----------

  /** 当前总旋转角（度，含角度微调） */
  totalAngle() {
    return ((((this.rotation || 0) + (this.fineAngle || 0)) % 360) + 360) % 360
  },

  /** 当前裁切比例（宽/高）；「自由」返回 null 表示不锁比例 */
  cropAspect() {
    const key = this.data.cropRatio || 'free'
    if (key === 'free') return null
    if (key === 'orig') return (this.imgW || 1) / (this.imgH || 1)
    if (key === 'screen') return (this.winW || 375) / (this.winH || 667)
    if (key === 'screenL') return (this.winH || 667) / (this.winW || 375)
    const parts = key.split(':').map(Number)
    return parts[1] ? parts[0] / parts[1] : null
  },

  /** 进入裁切旋转：底部工具区下移隐退 → 功能栏上滑显现 → 重置裁切框 */
  enterCrop() {
    // 四个功能栏互斥：任一已展开时都不再进入另一个（与 enterAi 的守卫保持同一口径）
    if (this.data.cropMode || this.data.filterMode || this.data.adjustMode || this.data.aiMode) return
    // 动画窗口内也要互斥：xxxMode 要等 240ms 动画结束才置位，其间再点别的入口会两个栏一起上滑
    if (!this.beginBarAnim()) return
    // 进入前的状态：取消时原样还原，确认时作为撤销点（整段裁切会话算一步）
    // 除旋转/微调外，镜像也是裁切功能栏内可改的状态，需一并记录以便取消时还原
    this._cropPrev = {
      rotation: this.rotation || 0,
      fineAngle: this.fineAngle || 0,
      flipX: !!this.flipX,
    }
    this._cropPrevSnap = this.snapshot()
    this.closePanel()
    this.setData({ bottomOut: true })
    this.later(() => {
      // 刻度盘 value 直接反映当前微调角（保留进入前的角度，取消时能正确还原）
      this.setData({
        cropMode: true,
        bottomOut: false,
        cropRatio: 'free',
        fineAngle: this.fineAngle || 0,
      })
      // 功能栏用 transform 动画（不影响布局），挂载后布局即最终态，可直接量取视口
      this.syncViewport().then(() => this.computeCropUI())
    }, 240)
  },

  /** 退出裁切旋转：功能栏下移退场 → 底部工具区回位 */
  exitCrop() {
    if (!this.data.cropMode) return
    this.setData({ cropOut: true, cropDragging: false })
    this.later(() => {
      this.setData({ cropMode: false, cropOut: false, bottomOut: false })
      this.cropBox = null
      this.render()
      this.syncViewport()
      this.refreshFlags()
    }, 260)
  },

  /** 功能栏：左右镜像 */
  onCropFlip() {
    if (!this.imgReady) return
    this.flipX = !this.flipX
    // 这里不再单独 render()：computeCropUI() 末尾就会按新状态重绘一次。
    // 原先一次操作画两遍整幅画面，刻度盘拖动（changing 高频触发）时代价直接翻倍
    this.computeCropUI()
  },

  /** 功能栏：顺时针旋转 90° */
  onCropRotate() {
    if (!this.imgReady) return
    this.rotation = ((((this.rotation || 0) + 90) % 360) + 360) % 360
    // 同上：computeCropUI() 已包含重绘
    this.computeCropUI()
  },

  /** 比例预设切换：裁切框重置为该比例的最大内接矩形 */
  onRatio(e) {
    this.setData({ cropRatio: e.currentTarget.dataset.ratio })
    this.computeCropUI()
  },

  /**
   * 刻度盘拖动中（angle-ruler 组件的 changing 事件）：实时更新微调角并重绘。
   * 只写一个数值、且与组件内部角度一致（组件会忽略同值回写），不会与手指打架。
   */
  onAngleChanging(e) {
    if (!this.imgReady) return
    const angle = Number(e.detail && e.detail.angle) || 0
    if (angle === this.fineAngle) return
    this.fineAngle = angle
    this.setData({ fineAngle: angle })
    // 拖动中的每一次事件都只重绘一帧（computeCropUI 内含 render）
    this.computeCropUI()
  },

  /** 刻度盘松手（angle-ruler 组件的 change 事件）：收尾重算法切框 */
  onAngleChange(e) {
    if (!this.imgReady) return
    const angle = Number(e.detail && e.detail.angle) || 0
    this.fineAngle = angle
    this.setData({ fineAngle: angle })
    // 同上：computeCropUI() 已包含重绘
    this.computeCropUI()
  },

  /** 触摸点（clientX/Y）→ 画布 px */
  touchToCanvas(touch) {
    if (!this.canvasRect) return null
    return {
      x: (touch.clientX - this.canvasRect.left) * this.dpr,
      y: (touch.clientY - this.canvasRect.top) * this.dpr,
    }
  },

  /** 裁切框触摸开始：判断命中角手柄（缩放）还是框内（移动） */
  onCropTouchStart(e) {
    const b = this.cropBox
    if (!b || !this.imgReady) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToCanvas(t)
    if (!p) return
    const tol = (44 * this.dpr) / 2 // 手指容差
    const nl = Math.abs(p.x - b.x) <= tol
    const nr = Math.abs(p.x - (b.x + b.width)) <= tol
    const nt = Math.abs(p.y - b.y) <= tol
    const nb = Math.abs(p.y - (b.y + b.height)) <= tol
    let corner = ''
    if (nl && nt) corner = 'lt'
    else if (nr && nt) corner = 'rt'
    else if (nl && nb) corner = 'lb'
    else if (nr && nb) corner = 'rb'
    else if (nl) corner = 'l'
    else if (nr) corner = 'r'
    else if (nt) corner = 't'
    else if (nb) corner = 'b'
    const inside = p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height
    if (!corner && !inside) return
    this._crop = {
      corner,
      mode: corner ? 'resize' : 'move',
      start: p,
      box: { x: b.x, y: b.y, width: b.width, height: b.height },
    }
    this.setData({ cropDragging: true })
  },

  /** 裁切框拖动：角手柄缩放（锁比例）+ 框内移动，始终钳制在图片内 */
  onCropTouchMove(e) {
    const st = this._crop
    if (!st) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToCanvas(t)
    if (!p) return
    const o = st.box
    const dx = p.x - st.start.x
    const dy = p.y - st.start.y
    const r = this.imgRect
    const min = Math.max(24 * this.dpr, (r ? Math.min(r.dw, r.dh) : 300) * 0.12)
    let box
    if (st.mode === 'move') {
      box = this.clampCrop({ x: o.x + dx, y: o.y + dy, width: o.width, height: o.height })
    } else {
      const corner = st.corner
      let x = o.x
      let y = o.y
      let w = o.width
      let h = o.height
      if (corner.indexOf('l') >= 0) {
        x = o.x + dx
        w = o.width - dx
      }
      if (corner.indexOf('r') >= 0) w = o.width + dx
      if (corner.indexOf('t') >= 0) {
        y = o.y + dy
        h = o.height - dy
      }
      if (corner.indexOf('b') >= 0) h = o.height + dy
      if (w < 0) {
        x += w
        w = -w
      }
      if (h < 0) {
        y += h
        h = -h
      }
      // 锁比例（角手柄以宽度为准、边手柄沿垂直方向居中扩展）
      const ratio = this.cropAspect()
      if (ratio) {
        if (corner.length === 2) {
          const nh = w / ratio
          if (corner.indexOf('t') >= 0) y = o.y + o.height - nh
          h = nh
        } else if (corner === 'l' || corner === 'r') {
          const nh = w / ratio
          y = o.y + (o.height - nh) / 2
          h = nh
        } else {
          const nw = h * ratio
          x = o.x + (o.width - nw) / 2
          w = nw
        }
      }
      if (w < min || h < min) {
        // 触底保护：低于最小尺寸时围绕框中心按比例放大回来。
        // w/h 上面已取过绝对值，但仍可能恰好为 0（手指正好拖到与对角重合）：`min / 0`
        // 得到 Infinity，乘回去会变成 NaN 或天文数字（裁切框整个消失 / 铺满全图）。
        // 这种退化位移直接沿用上一次的框，比画出坏框更符合预期。
        if (w > 0 && h > 0) {
          const k = Math.max(min / w, min / h)
          const ccx = x + w / 2
          const ccy = y + h / 2
          w *= k
          h *= k
          x = ccx - w / 2
          y = ccy - h / 2
        } else {
          x = o.x
          y = o.y
          w = o.width
          h = o.height
        }
      }
      box = this.clampCrop({ x, y, width: w, height: h })
    }
    this.cropBox = box
    // 合并同帧重绘：拖动过程中 touchmove 一帧可能来多次，每次都整幅重绘是纯浪费
    this.scheduleRender()
  },

  onCropTouchEnd() {
    if (!this._crop) return
    this._crop = null
    this.setData({ cropDragging: false })
  },

  /**
   * 把裁切框钳制在旋转后的图片内（保证裁切结果不出现黑角）。
   * 画布上的正矩形反变换回图片局部坐标后仍是正矩形，半宽/半高为
   *  (W·|cos| + H·|sin|)/2、(W·|sin| + H·|cos|)/2 —— 只要该矩形中心与半尺寸
   * 不越出图片矩形即可；尺寸超限时先按同一比例缩回。
   */
  clampCrop(box) {
    const r = this.imgRect
    if (!r || !box) return box
    const rad = (this.totalAngle() * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const ac = Math.abs(c)
    const as = Math.abs(s)
    let w = box.width
    let h = box.height
    let hw = (w * ac + h * as) / 2
    let hh = (w * as + h * ac) / 2
    const k = Math.min(1, r.dw / 2 / (hw || 1), r.dh / 2 / (hh || 1))
    if (k < 1) {
      w *= k
      h *= k
      hw *= k
      hh *= k
    }
    // 框中心反变换到图片局部坐标并限制在可移动范围内
    const cvx = box.x + box.width / 2 - r.cx
    const cvy = box.y + box.height / 2 - r.cy
    const lx = cvx * c + cvy * s
    const ly = -cvx * s + cvy * c
    const maxX = Math.max(0, r.dw / 2 - hw)
    const maxY = Math.max(0, r.dh / 2 - hh)
    const nx = Math.min(maxX, Math.max(-maxX, lx))
    const ny = Math.min(maxY, Math.max(-maxY, ly))
    if (k === 1 && nx === lx && ny === ly) return box
    // 局部中心 → 画布坐标（正向变换：u·c - v·s）
    const px = nx * c - ny * s + r.cx
    const py = nx * s + ny * c + r.cy
    return { x: px - w / 2, y: py - h / 2, width: w, height: h }
  },

  /** 按当前旋转角与比例预设，把裁切框重置为该比例的最大内接矩形（居中） */
  computeCropUI() {
    const r = this.imgRect
    // 仅在裁切模式下有效；_noOverlay 期间（导出中/导出后的重载）不重建，避免闪框
    if (!r || !this.data.cropMode || this._noOverlay) return
    const ratio = this.cropAspect() || r.dw / r.dh
    const rad = (this.totalAngle() * Math.PI) / 180
    const ac = Math.abs(Math.cos(rad))
    const as = Math.abs(Math.sin(rad))
    // W·ac + H·as ≤ dw 且 W·as + H·ac ≤ dh（H = W / ratio）
    const w = Math.max(24 * this.dpr, Math.min(r.dw / (ac + as / ratio), r.dh / (as + ac / ratio)))
    const h = w / ratio
    this.cropBox = { x: r.cx - w / 2, y: r.cy - h / 2, width: w, height: h }
    this.render()
  },

  /** 确认裁切：导出裁切框区域为新底图（角度/滤镜/叠加层一并拍平） */
  onCropApply() {
    if (!this.imgReady || this.data.cropping) return
    if (!this.cropBox) this.computeCropUI()
    const box = this.cropBox
    if (!box) {
      wx.showToast({ title: '暂无可裁切区域', icon: 'none' })
      return
    }
    this.setData({ cropping: true })
    // 导出前隐藏裁切框叠加绘制，避免被烘焙进结果图
    this._noOverlay = true
    this.render()
    this.exportRegion(box)
      .then((tempPath) => {
        // 撤销点取「进入裁切前」的状态：裁切会话内的旋转/微调整体算一步
        this.pushHistory(this._cropPrevSnap)
        this.basePath = tempPath
        this.rotation = 0
        this.fineAngle = 0
        this.flipX = false
        this.flipY = false
        this.filter = 'none'
        this.adj = { ...ADJ_DEFAULT }
        // 裁切结果已把画面上的叠加层**全部**（模板/贴纸/笔迹/文字/马赛克）一并拍平，
        // 逐层清空避免在新底图上再画一遍（叠加层漏清 = 二次叠加，见 11.3 第 22 条的口径）
        this.doodles = []
        this.texts = []
        this.mosaics = []
        this.layerStickers = []
        this._textSel = null
        this._stkSel = null
        this._pixelSrcs = {}
        this.cropBox = null
        this.setData({ filter: 'none', fineAngle: 0 })
        this.pushAdjData()
        return this.reloadImage(tempPath)
      })
      .then(() => {
        this._noOverlay = false
        this._cropPrev = null
        this._cropPrevSnap = null
        this.exitCrop()
        wx.showToast({ title: '已裁切', icon: 'none' })
      })
      .catch(() => {
        this._noOverlay = false
        this.render()
        wx.showToast({ title: '裁切失败', icon: 'none' })
      })
      .finally(() => this.setData({ cropping: false }))
  },

  /** 取消裁切：还原进入前的角度并退出 */
  onCropCancel() {
    if (this._cropPrev) {
      this.rotation = this._cropPrev.rotation
      this.fineAngle = this._cropPrev.fineAngle
      this.flipX = this._cropPrev.flipX
      this._cropPrev = null
      this._cropPrevSnap = null
    }
    // 把刻度盘拨回还原后的角度
    this.setData({ fineAngle: this.fineAngle || 0 })
    this.render()
    this.exitCrop()
  },

  // ---------- 滤镜（独立功能栏） ----------

  /** 进入滤镜：底部工具区下移隐退 → 功能栏上滑显现（缩略图用当前底图实时预览） */
  enterFilter() {
    // 四个功能栏互斥（含 AI 功能栏），守卫口径与 enterCrop / enterAdjust / enterAi 一致
    if (this.data.filterMode || this.data.cropMode || this.data.adjustMode || this.data.aiMode) return
    if (!this.beginBarAnim()) return
    // 进入前的滤镜：取消时还原，确认时作为撤销点（整段滤镜会话算一步）
    this._filterPrev = this.filter || 'none'
    this._filterSnap = this.snapshot()
    const group = FILTER_GROUPS.find((x) => x.key === this.data.filterCat) || FILTER_GROUPS[0]
    this.closePanel()
    this.setData({
      bottomOut: true,
      filterCat: group.key,
      filterItems: group.items,
      filterSrc: this.basePath || this.data.imagePath,
      filterTransform: this.previewTransform(),
    })
    this.later(() => {
      this.setData({ filterMode: true, bottomOut: false })
      // 功能栏用 transform 动画（不影响布局），挂载后即可量取收缩后的绘制视口
      this.syncViewport()
    }, 240)
  },

  /** 退出滤镜：功能栏下移退场 → 底部工具区回位 */
  exitFilter() {
    if (!this.data.filterMode) return
    this.setData({ filterOut: true })
    this.later(() => {
      this.setData({ filterMode: false, filterOut: false, bottomOut: false })
      this.render()
      this.syncViewport()
      this.refreshFlags()
    }, 260)
  },

  /** 滤镜分类切换 */
  onFilterCat(e) {
    const key = e.currentTarget.dataset.cat
    const group = FILTER_GROUPS.find((x) => x.key === key) || FILTER_GROUPS[0]
    this.setData({ filterCat: group.key, filterItems: group.items })
  },

  /** 点选滤镜：即时预览（不退出、不压栈，确认时才计一步撤销） */
  onFilterPick(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.filter) return
    this.filter = key
    this.setData({ filter: key })
    this.render()
  },

  /** 取消：还原进入前的滤镜并退出 */
  onFilterCancel() {
    this.filter = this._filterPrev || 'none'
    this._filterPrev = null
    this._filterSnap = null
    this.setData({ filter: this.filter })
    this.render()
    this.exitFilter()
  },

  /** 确认：保留当前滤镜并退出；有变化则按「进入前状态」记一步撤销 */
  onFilterApply() {
    if ((this._filterPrev || 'none') !== this.filter) this.pushHistory(this._filterSnap)
    this._filterPrev = null
    this._filterSnap = null
    this.exitFilter()
  },

  /**
   * 滤镜缩略图的旋转/镜像变换（与编辑状态保持一致）。
   *
   * 变换顺序必须与画布严格一致：画布变换链是 translate → scale → rotate
   * （M = S·R，即先旋转、再按翻转缩放），而 CSS `transform` 列表是「靠右的函数先作用」，
   * 因此必须把 scaleX/scaleY 写在 rotate **之前**（等价 S·R）。
   * 若按直觉写成 rotate → scale，得到的是 R·S（先镜像再旋转）；S 与 R 不可交换，
   * 「旋转 90°/270° + 镜像」同时生效时缩略图会比实际画面整体差 180°
   * （与 11.3 第 11 条 `touchToImage()` 是同一类问题）。
   */
  previewTransform() {
    const rot = this.totalAngle()
    const parts = []
    if (this.flipX) parts.push('scaleX(-1)')
    if (this.flipY) parts.push('scaleY(-1)')
    if (rot) parts.push(`rotate(${rot}deg)`)
    return parts.length ? parts.join(' ') : 'none'
  },

  // ---------- 增强（独立功能栏） ----------

  /** 进入增强：底部工具区下移隐退 → 功能栏上滑显现（与裁切旋转/滤镜同一套交互） */
  enterAdjust() {
    // 四个功能栏互斥（含 AI 功能栏），守卫口径与 enterCrop / enterFilter / enterAi 一致
    if (this.data.adjustMode || this.data.cropMode || this.data.filterMode || this.data.aiMode) return
    if (!this.beginBarAnim()) return
    // 进入前的参数：取消时还原，确认且有变化时作为撤销点（整段增强会话算一步）
    this._adjustPrev = { ...this.adj }
    this._adjustSnap = this.snapshot()
    this.closePanel()
    this.setData({ bottomOut: true })
    this.later(() => {
      this._adjFast = false // 非拖动状态，按完整档重建逐像素底图
      // 滑杆与参数项跟随当前参数值（上次退出后可能已改变）
      this.pushAdjData()
      this.setData({ adjustMode: true, bottomOut: false })
      // 功能栏用 transform 动画（不影响布局），挂载后即可量取收缩后的绘制视口
      this.syncViewport()
    }, 240)
  },

  /** 退出增强：功能栏下移退场 → 底部工具区回位 */
  exitAdjust() {
    if (!this.data.adjustMode) return
    this._adjFast = false
    this.setData({ adjustOut: true })
    this.later(() => {
      this.setData({ adjustMode: false, adjustOut: false, bottomOut: false })
      this.render()
      this.syncViewport()
      this.refreshFlags()
    }, 260)
  },

  /** 切换当前调节的参数项：滑杆跟随该参数当前值 */
  onAdjustPick(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.adjKey) return
    const cur = adjItemsWithValues(this.adj).find((x) => x.key === key)
    const val = cur ? cur.value : 0
    this.setData({ adjKey: key, adjValue: val, adjValText: adjValLabel(val) })
  },

  /** 滑杆拖动中：写入参数并用「快速档」重建逐像素底图，保证跟手 */
  onAdjust(e) {
    this._adjFast = true
    this.applyAdjustValue(e)
  },

  /** 滑杆松手：用「完整档」重建逐像素底图（同时供后续导出使用） */
  onAdjustCommit(e) {
    this._adjFast = false
    this.applyAdjustValue(e)
  },

  /**
   * 写入某个参数的值并重绘。
   * 拖动中（_adjFast）**只**更新数值文案：既不回写滑杆的 value、也不重推 adjItems ——
   * 回写 value 会让组件按旧值重定位滑块，与手指位置互相打架（表现为左右抽搐）；
   * adjItems 每项都带两个 base64 图标，每次拖动都整表 setData 会带来明显卡顿。
   * 松手（bindchange）后才同步滑杆值，并把「快速档」逐像素底图升级为「完整档」。
   */
  applyAdjustValue(e) {
    const key = e.currentTarget.dataset.key || this.data.adjKey
    const val = Number(e.detail.value) || 0
    const changed = (this.adj[key] || 0) !== val
    if (changed) this.adj = { ...this.adj, [key]: val }
    if (this._adjFast) {
      this.setData({ adjValText: adjValLabel(val) })
      if (changed) this.render()
      return
    }
    this.setData({ adjValue: val, adjValText: adjValLabel(val) })
    this.render()
  },

  /** 取消：还原进入前的全部参数并退出 */
  onAdjustCancel() {
    if (this._adjustPrev) {
      this.adj = { ...this._adjustPrev }
      this._adjustPrev = null
      this._adjustSnap = null
    }
    this.pushAdjData()
    this.render()
    this.exitAdjust()
  },

  /** 确认：保留当前参数并退出；有变化则按「进入前状态」记一步撤销 */
  onAdjustApply() {
    const prev = this._adjustPrev
    const changed = !!prev && ADJ_KEYS.some((k) => (prev[k] || 0) !== (this.adj[k] || 0))
    if (changed) this.pushHistory(this._adjustSnap)
    this._adjustPrev = null
    this._adjustSnap = null
    this.exitAdjust()
  },

  // ---------- 涂鸦 ----------

  onPenColor(e) {
    this.setData({ penColor: e.currentTarget.dataset.color })
  },

  onPenSize(e) {
    this.setData({ penSize: Number(e.currentTarget.dataset.size) })
  },

  onDoodleClear() {
    // 正在绘制中的笔迹（`_stroke`）也要一并收掉：它不在 this.doodles 里，
    // 只清数组会让「未画完的那一笔」继续被 drawDoodles 绘制，且怎么点清空都去不掉
    // （收尾时机与 onDoodleEnd 同一口径）
    if (!this.doodles.length && !this._stroke) return
    if (this.doodles.length) this.pushHistory()
    this.doodles = []
    this._stroke = null
    this.render()
    this.refreshFlags()
  },

  /**
   * 触摸点（clientX/Y）→ 图片归一化坐标（0~1，跟随旋转/翻转）。
   * 渲染时画布的变换链是 translate(中心) → scale(翻转) → rotate(旋转)，即
   * canvas = 中心 + S·R·(u,v)；反变换必须**严格逆序**：先按翻转取反（S⁻¹），再反向旋转（R⁻¹）。
   * 注意 S 与 R 不可交换：若先反向旋转再按翻转取反（= S·R⁻¹），
   * 「旋转 90°/270° + 镜像」的组合下 x 会左右颠倒，涂鸦/文字/马赛克的落点与手指位置对不上。
   */
  touchToImage(touch) {
    if (!this.canvasRect || !this.imgRect) return null
    // 屏幕坐标 → 画布 px 与裁切框拖动共用同一份换算（touchToCanvas），避免两处各写一遍漂移
    const canvasPt = this.touchToCanvas(touch)
    if (!canvasPt) return null
    const px = canvasPt.x
    const py = canvasPt.y
    const r = this.imgRect
    const vx = (this.flipX ? -1 : 1) * (px - r.cx)
    const vy = (this.flipY ? -1 : 1) * (py - r.cy)
    const rad = (-this.totalAngle() * Math.PI) / 180
    const ux = vx * Math.cos(rad) - vy * Math.sin(rad)
    const uy = vx * Math.sin(rad) + vy * Math.cos(rad)
    return { x: ux / r.dw + 0.5, y: uy / r.dh + 0.5 }
  },

  onDoodleStart(e) {
    if (this.data.panel !== 'doodle' || !this.imgReady) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    this._stroke = {
      color: this.data.penColor,
      size: this.data.penSize,
      points: [p, { x: p.x + 0.0001, y: p.y + 0.0001 }],
    }
  },

  onDoodleMove(e) {
    if (!this._stroke) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    this._stroke.points.push(p)
    this.scheduleRender() // 笔迹点照旧同步累积，只是「画」合并到下一帧
  },

  onDoodleEnd() {
    if (!this._stroke) return
    this.pushHistory()
    this.doodles.push(this._stroke)
    this._stroke = null
    this.render()
    this.refreshFlags()
  },

  /** 把画面上的绘制拍平进底图（离开涂鸦面板时）：笔迹 + 同屏的文字/马赛克 */
  bakeDoodles() {
    const strokes = this.doodles.filter((s) => s && s.points && s.points.length)
    if (!strokes.length) return
    const d = this.displayRegion
    if (!d) return
    // 先记历史：拍平会替换底图，撤销可回到拍平前（含笔迹/文字/马赛克）
    this.pushHistory()
    // 拍平是异步的（导出 + 重载底图，最坏几百毫秒），期间用户完全可以继续画。
    // 这里记下「本次真正画进底图」的那一批叠加层（快照一份数组），结束后只按引用移除它们 ——
    // 否则新的笔迹/贴纸会被当作旧图层一起清空（用户视角：自己刚画的笔迹莫名消失）。
    const baked = {
      doodles: this.doodles.slice(),
      texts: this.texts.slice(),
      mosaics: this.mosaics.slice(),
      stickers: this.layerStickers.slice(),
    }
    const keepNew = (list, old) => (list || []).filter((x) => !old.includes(x))
    return this.exportRegion(d)
      .then((tempPath) => {
        this.basePath = tempPath
        // ⚠️ 导出的是**当前画面**（已含旋转 / 角度微调 / 镜像 / 滤镜 / 增强），因此这几项必须
        // 与底图一起归零，否则新底图会被再变换、再调色一次（「镜像一次再画一笔，切工具后画面
        // 翻回去」「滤镜叠两遍」）。重置清单与 onCropApply / runAi 保持同一口径（见 8.8 第 4 条）
        this.rotation = 0
        this.fineAngle = 0
        this.flipX = false
        this.flipY = false
        this.filter = 'none'
        this.adj = { ...ADJ_DEFAULT }
        this.setData({ filter: 'none', fineAngle: 0 })
        this.pushAdjData()
        // 拍平已把全部叠加层（模板/贴纸/笔迹/文字/马赛克）画进新底图，逐层清空避免二次叠加
        this.doodles = keepNew(this.doodles, baked.doodles)
        this.texts = keepNew(this.texts, baked.texts)
        this.mosaics = keepNew(this.mosaics, baked.mosaics)
        this.layerStickers = keepNew(this.layerStickers, baked.stickers)
        this._textSel = null
        this._stkSel = null
        this._pixelSrcs = {}
        // 进入裁切（closePanel → bakeDoodles）时，「进入前状态」记录的还是拍平前的角度/镜像；
        // 底图已拍平，那份还原基准不再成立 —— 归一化它，避免点「×」把旧角度又加回来
        if (this._cropPrev) {
          this._cropPrev = { rotation: 0, fineAngle: 0, flipX: false }
          this._cropPrevSnap = this.snapshot()
        }
        return this.reloadImage(tempPath)
      })
      .then(() => this.refreshFlags())
      .catch(() => wx.showToast({ title: '涂鸦应用失败', icon: 'none' }))
  },

  // ---------- 文字 ----------

  onTextInput(e) {
    this.setData({ textInput: e.detail.value })
  },

  onTextColor(e) {
    this.setData({ textColor: e.currentTarget.dataset.color })
  },

  onTextSize(e) {
    this.setData({ textSize: Number(e.currentTarget.dataset.size) })
  },

  /** 添加一条文字到图片中心（之后可拖动调整位置） */
  onTextAdd() {
    if (!this.imgReady) return
    const text = (this.data.textInput || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入文字', icon: 'none' })
      return
    }
    this.pushHistory()
    this.texts = this.texts.concat([
      {
        id: this.nextOverlayId('txt'),
        text,
        color: this.data.textColor,
        size: this.data.textSize,
        nx: 0.5,
        ny: 0.5,
        rot: 0,
      },
    ])
    this.setData({ textInput: '' })
    this.render()
    this.refreshFlags()
    wx.showToast({ title: '已添加，拖动可调整位置', icon: 'none' })
  },

  onTextClear() {
    if (!this.texts.length) return
    this.pushHistory()
    this.texts = []
    this._textSel = null
    this.render()
    this.refreshFlags()
  },

  /** 命中测试：返回触摸点下最上层的文字（框尺寸由 drawTexts 每次绘制后写入） */
  hitText(p) {
    const list = this.texts || []
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i]
      const hw = (t._nw || 0) / 2 + 0.015
      const hh = (t._nh || 0) / 2 + 0.015
      if (Math.abs(p.x - t.nx) <= hw && Math.abs(p.y - t.ny) <= hh) return t
    }
    return null
  },

  onTextTouchStart(e) {
    if (this.data.panel !== 'text' || !this.imgReady) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    const hit = this.hitText(p)
    this._textSel = hit ? hit.id : null
    this._text = hit ? { id: hit.id, dx: hit.nx - p.x, dy: hit.ny - p.y, moved: false } : null
    this.render()
  },

  onTextTouchMove(e) {
    if (!this._text) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    const item = (this.texts || []).find((x) => x.id === this._text.id)
    if (!item) return
    // 首次移动前记历史，保证一次拖动只产生一步撤销
    if (!this._text.moved) {
      this.pushHistory()
      this._text.moved = true
    }
    item.nx = Math.min(1.15, Math.max(-0.15, p.x + this._text.dx))
    item.ny = Math.min(1.15, Math.max(-0.15, p.y + this._text.dy))
    this.scheduleRender() // 拖动高频路径：位置同步写入，重绘合并到下一帧
  },

  onTextTouchEnd() {
    if (!this._text) return
    this._text = null
    this.refreshFlags()
  },

  // ---------- 马赛克 ----------

  onMosaicLevel(e) {
    // 块级只作用于之后新涂抹的笔画；已有笔画按各自块级绘制（缓存按块级分开）
    this.setData({ mosaicLevel: e.currentTarget.dataset.level })
  },

  onMosaicSize(e) {
    this.setData({ mosaicSize: Number(e.currentTarget.dataset.size) })
  },

  onMosaicClear() {
    // 正在涂抹中的笔画（`_mosaic`）不在 this.mosaics 里，同样要收掉：
    // 它会被 drawMosaics 末尾的 paint(this._mosaic) 继续绘制，且怎么点清空都去不掉
    // （口径与 onDoodleClear 对 `_stroke` 的处理一致）
    if (!this.mosaics.length && !this._mosaic) return
    if (this.mosaics.length) this.pushHistory()
    this.mosaics = []
    this._mosaic = null
    this.render()
    this.refreshFlags()
  },

  onMosaicStart(e) {
    if (this.data.panel !== 'mosaic' || !this.imgReady) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    // 点一下也要有效果：补一个极小偏移点，让圆头笔画形成圆点
    this._mosaic = {
      size: this.data.mosaicSize,
      level: this.data.mosaicLevel,
      points: [p, { x: p.x + 0.0001, y: p.y + 0.0001 }],
    }
  },

  onMosaicMove(e) {
    if (!this._mosaic) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    this._mosaic.points.push(p)
    this.scheduleRender() // 同上：涂抹高频路径合并同帧重绘
  },

  onMosaicEnd() {
    if (!this._mosaic) return
    this.pushHistory()
    this.mosaics.push(this._mosaic)
    this._mosaic = null
    this.render()
    this.refreshFlags()
  },

  /** 像素化底图：按块级把底图降采样到离屏小画布；按「底图 + 块级」缓存，不可用返回 null */
  ensurePixelImage(levelKey) {
    const key = levelKey || this.data.mosaicLevel
    const block = (MOSAIC_LEVELS.find((x) => x.key === key) || MOSAIC_LEVELS[1]).block
    const cacheKey = (this.basePath || '') + '|' + block
    this._pixelSrcs = this._pixelSrcs || {}
    if (this._pixelSrcs[cacheKey]) return this._pixelSrcs[cacheKey]
    if (!this.img || !this.imgW || !this.imgH) return null
    const w = Math.max(2, Math.round(this.imgW / block))
    const h = Math.max(2, Math.round(this.imgH / block))
    let off = null
    try {
      off = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
    } catch (e) {
      off = null
    }
    if (!off) return null
    const c = off.getContext && off.getContext('2d')
    if (!c) return null
    // 与主画面取同一份底图（含曝光/自然饱和度的逐像素结果），避免打码区域颜色不一致
    c.drawImage(this.adjSrc || this.img, 0, 0, w, h)
    this._pixelSrcs[cacheKey] = off
    return off
  },

  // ---------- 贴纸（底部内联面板，见 README 8.10） ----------

  /** 拉取贴纸资源（首次展开面板时加载一次，之后复用缓存） */
  loadStickers() {
    if (this._stickerAll || this._stickerReq) return
    // 在途去重：直达入口在 onLoad 就预拉一次，consumePanelEntry 里可能再调一次，
    // 没有这道守卫会重复打两次 GET /api/stickers
    this._stickerReq = true
    request({ url: '/api/stickers' })
      .then((res) => {
        // 直达入口会在 onLoad 就预拉，响应可能在页面已卸载后才回来
        if (this._destroyed) return
        const items = ((res.data && res.data.items) || []).map((s) => ({
          id: s.id,
          name: s.name || '贴纸',
          category: s.category || '',
          // file_path 是 /uploads/... 相对路径，交给 absoluteUrl 补成绝对地址（统一拼接规则）
          src: absoluteUrl(s.file_path),
        }))
        this._stickerAll = items
        const cats = [STICKER_ALL]
        items.forEach((s) => {
          if (s.category && cats.indexOf(s.category) < 0) cats.push(s.category)
        })
        this.setData({ stickerCats: cats, stickerLoaded: true }, () => this.applyStickerFilter())
      })
      .catch((err) => {
        if (this._destroyed) return
        // 失败也要落下终态：否则面板一直停在「贴纸加载中…」，用户不知道发生了什么
        this.setData({ stickerLoaded: true, stickerList: [] })
        wx.showToast({ title: (err && err.message) || '贴纸加载失败', icon: 'none' })
      })
      .finally(() => {
        this._stickerReq = false
      })
  },

  /** 按当前分类过滤贴纸列表 */
  applyStickerFilter() {
    const all = this._stickerAll || []
    const cat = this.data.stickerCat
    this.setData({ stickerList: cat === STICKER_ALL ? all : all.filter((s) => s.category === cat) })
  },

  /** 贴纸分类切换 */
  onStickerCat(e) {
    this.setData({ stickerCat: e.currentTarget.dataset.cat || STICKER_ALL }, () => this.applyStickerFilter())
  },

  /**
   * 点选贴纸 → 加到图片中心（之后可直接在图片上拖动定位）。
   *
   * 尺寸：`drawStickers` 按 `nw·dw × nh·dh` 绘制，要保持贴纸不变形必须满足
   * `(nw·dw) / (nh·dh) = 贴纸宽高比 A`；又因底图按自身比例绘制（`dw/dh = 底图宽高比 B`），
   * 于是 `nh = nw · B / A`。贴纸自然尺寸要等图片加载完成才知道，故在 onload 里入栈。
   */
  onStickerAdd(e) {
    if (!this.imgReady) return
    const id = Number(e.currentTarget.dataset.id)
    const item = (this.data.stickerList || []).find((s) => s.id === id)
    if (!item) return
    const img = this.canvas.createImage()
    img.onload = () => {
      // 贴纸图片是异步加载的，页面可能在加载期间被卸载（onUnload 置空 canvas）
      if (!this.canvas) return
      this.pushHistory()
      const a = (img.width || 1) / (img.height || 1)
      const b = (this.imgW || 1) / (this.imgH || 1)
      // push 到末尾 = 画在最上层（模板走 unshift，属于最底层装饰）
      this.layerStickers.push({
        id: this.nextOverlayId('stk'),
        src: item.src,
        img,
        nx: 0.5,
        ny: 0.5,
        nw: STICKER_WIDTH,
        nh: (STICKER_WIDTH * b) / a,
        rot: 0,
      })
      this.render()
      this.refreshFlags()
      wx.showToast({ title: '已添加，拖动可调整位置', icon: 'none' })
    }
    img.onerror = () => wx.showToast({ title: '贴纸加载失败', icon: 'none' })
    img.src = item.src
  },

  /**
   * 命中测试：触摸点下最上层的**可拖动贴纸**（列表末尾 = 最上层，因此倒序找）。
   * 模板叠加层（`tpl = true`，铺满整幅且由模板页带入）不参与拖动 —— 它本来就是全画布装饰，
   * 拖走只会让画面错位，也不是用户在这里能理解的操作。
   */
  hitSticker(p) {
    const list = this.layerStickers || []
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]
      if (s.tpl) continue
      if (Math.abs(p.x - s.nx) <= (s.nw || 0) / 2 && Math.abs(p.y - s.ny) <= (s.nh || 0) / 2) return s
    }
    return null
  },

  onStickerTouchStart(e) {
    if (this.data.panel !== 'sticker' || !this.imgReady) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    const hit = this.hitSticker(p)
    this._stkSel = hit ? hit.id : null
    this._stk = hit ? { id: hit.id, dx: hit.nx - p.x, dy: hit.ny - p.y, moved: false } : null
    this.render()
  },

  onStickerTouchMove(e) {
    if (!this._stk) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const p = this.touchToImage(t)
    if (!p) return
    const item = (this.layerStickers || []).find((s) => s.id === this._stk.id)
    if (!item) return
    // 首次移动前记历史，保证一次拖动只产生一步撤销（同文字拖动）
    if (!this._stk.moved) {
      this.pushHistory()
      this._stk.moved = true
    }
    item.nx = Math.min(1.15, Math.max(-0.15, p.x + this._stk.dx))
    item.ny = Math.min(1.15, Math.max(-0.15, p.y + this._stk.dy))
    this.scheduleRender() // 拖动高频路径：位置同步写入，重绘合并到下一帧
  },

  onStickerTouchEnd() {
    if (!this._stk) return
    this._stk = null
    this.refreshFlags()
  },

  // ---------- AI 创作（独立功能栏，与裁切旋转 / 滤镜 / 增强同一套交互） ----------

  /** 风格迁移：选择艺术风格（功能栏内胶囊） */
  onAiStyle(e) {
    this.setData({ aiStyle: e.currentTarget.dataset.style })
  },

  /** 工具行：点某个 AI 能力 → 打开对应的 AI 功能栏 */
  onAiToolTap(e) {
    this.enterAi(e.currentTarget.dataset.ability)
  },

  /**
   * 进入 AI 功能栏：底部工具区下移隐退 → 功能栏上滑显现 → 顶部切换为该能力名的居中标题。
   * AI 处理是「一次性替换底图」的动作、没有中间参数，因此**不入撤销栈**，
   * 「×」只退出功能栏（真正产出结果的唯一入口是「✓」）。
   */
  enterAi(ability) {
    if (this.data.aiMode || this.data.cropMode || this.data.filterMode || this.data.adjustMode) return
    if (this.data.aiLoading || this.data.saving || !this.imgReady) return
    if (!this.beginBarAnim()) return
    const info = AI_ABILITIES.find((x) => x.key === ability) || AI_ABILITIES[0]
    // 该能力若已「不可提交」（今日额度用完 / 未配置密钥），进入功能栏时直接把原因显示出来
    const blocked = (this._aiBlocked || {})[info.key] || ''
    this.closePanel()
    this.setData({
      bottomOut: true,
      aiAbility: info.key,
      aiInfo: info,
      aiBlockReason: blocked,
      aiQuotaText: '',
      // 手动进入一律播放正常的进场动画（含「直达入口」退出后再从工具行进入的场景）
      directEntry: false,
    })
    // 今日额度：进入功能栏时查一次（只读接口），失败静默 —— 额度是辅助信息，不得阻塞主流程
    this.loadQuota(info.key)
    this.later(() => {
      this.setData({ aiMode: true, bottomOut: false })
      // 功能栏用 transform 动画（不影响布局），挂载后即可量取收缩后的绘制视口
      this.syncViewport()
    }, 240)
  },

  /**
   * 查询今日额度并回填到功能栏（GET /api/ai/quota，**只读**、不计配额）。
   *
   * 三条口径：
   * ① **失败静默** —— 额度只是辅助信息，请求失败既不 toast 也不阻塞动画，保持不显示即可；
   * ② **只在仍停留于该能力的功能栏时回填** —— 用户可能已退出或已切到别的能力（异步返回）；
   * ③ **与 `_aiBlocked` 的优先级** —— `_aiBlocked` 来自上一次真实执行的确定性反馈
   *    （3003 额度用完 / 3005 未配置密钥），比查询结果更权威；只有它为空时，
   *    才用「剩余 0 次」把 ✓ 提前置灰（让用户不必先失败一次）。
   */
  loadQuota(ability) {
    const token = (this._quotaSeq = (this._quotaSeq || 0) + 1)
    request({ url: '/api/ai/quota' })
      .then((res) => {
        if (token !== this._quotaSeq) return // 已发起新的查询，丢弃过期响应
        if (!this.data.aiMode || this.data.aiAbility !== ability) return // 已退出/已切能力
        const item = ((res.data && res.data.abilities) || []).find((x) => x.ability === ability)
        if (!item) return
        const patch = { aiQuotaText: `今日剩余 ${item.remaining} 次（上限 ${item.limit} 次）` }
        if (item.remaining <= 0 && !(this._aiBlocked || {})[ability]) {
          patch.aiBlockReason = '今日次数已用完，明天再来'
        }
        this.setData(patch)
      })
      .catch(() => {}) // 静默：额度查询失败不影响进入功能栏与执行处理
  },

  /** 退出 AI 功能栏：功能栏下移退场 → 底部工具区回位 */
  exitAi() {
    if (!this.data.aiMode) return
    this.setData({ aiOut: true })
    this.later(() => {
      // directEntry 只用于「首帧就在功能栏里」这一种情况：退出后清掉，
      // 之后再从工具行手动进入时恢复正常的「上滑」进场动画
      this.setData({ aiMode: false, aiOut: false, bottomOut: false, aiQuotaText: '', directEntry: false })
      this.render()
      this.syncViewport()
      this.refreshFlags()
    }, 260)
  },

  /** AI 功能栏「取消」：只退出（AI 无中间参数可还原） */
  onAiCancel() {
    this.exitAi()
  },

  /** AI 功能栏「确认」：按当前能力执行一次 AI 处理 */
  onAiApply() {
    this.runAi(this.data.aiAbility)
  },

  /**
   * 执行一次 AI 处理：导出当前画面 → 上传 → 结果作为新底图。
   * 成功后才收起功能栏；失败保留功能栏，便于直接再点一次「✓」重试。
   * 「今日额度用完（3003）」「该能力未配置密钥（3005）」属于重试也无用的状态，
   * 记到本能力上（本页会话内有效，服务端仍会兜底拦截），功能栏内提示原因并置灰 ✓。
   */
  runAi(ability) {
    const info = AI_ABILITIES.find((x) => x.key === ability)
    if (!info) return
    if (this.data.aiLoading || this.data.saving || !this.imgReady) return
    if (this.data.aiBlockReason) return // 已处于「不可提交」状态（额度用完 / 未配置）
    this.startAiLoading(info)
    const d = this.displayRegion
    this.exportRegion(d)
      .then((tempPath) => this.uploadForAI(tempPath, info.key))
      .then((fullUrl) => {
        // 页面已卸载（AI 最长等 360s，中途返回是常态）：结果不该再落到已销毁的页面上
        if (this._destroyed) return
        this.pushHistory()
        this.basePath = fullUrl
        // 记下本次会话用过 AI：保存时据此把作品标为「AI 创作」
        // （AI 不再「处理即入库」，类型要在保存那一刻按会话状态判定，见 M30）
        this._aiAbility = info.key
        // 与 onCropApply / bakeDoodles 同一口径：入参图已把角度（含微调）/ 镜像 / 滤镜 / 增强
        // 全部烘进去，这里必须逐项归零，否则结果图会被二次变换（8.8 第 4 条：角度…全部重置）
        this.rotation = 0
        this.fineAngle = 0
        this.flipX = false
        this.flipY = false
        this.filter = 'none'
        this.adj = { ...ADJ_DEFAULT }
        this.doodles = []
        // AI 结果整图替换底图：**全部叠加层**都已在导出的输入图里，必须逐层清空，
        // 否则模板/贴纸会在结果图上再画一遍（把 AI 的效果整个盖回去，见 8.8 第 4 条）
        this.texts = []
        this.mosaics = []
        this.layerStickers = []
        this._textSel = null
        this._stkSel = null
        this._pixelSrcs = {}
        // 本次成功即解除该能力的「不可提交」状态（如服务端刚补上配置）
        if (this._aiBlocked && this._aiBlocked[info.key]) {
          delete this._aiBlocked[info.key]
          this.setData({ aiBlockReason: '' })
        }
        this.setData({ filter: 'none', fineAngle: 0 })
        this.pushAdjData()
        return this.reloadImage(fullUrl)
      })
      .then(() => {
        if (this._destroyed) return
        // 先停进度定时器再收 loading：否则定时器可能在 hideLoading 与 showToast 之间
        // 又调一次 showLoading，把刚弹出的结果提示盖掉
        this.stopAiTimers()
        this.refreshFlags()
        // 必须先 hideLoading 再 showToast：loading 与 toast 共用同一浮层，
        // 顺序反了会让 hideLoading 把刚弹出的 toast 一起关掉（表现为提示一闪而过）
        wx.hideLoading()
        // 结果只留在编辑会话里：要进「我的作品」得再点右上角「保存」（见 M30）
        wx.showToast({ title: 'AI 处理完成，点「保存」存入作品', icon: 'none' })
        this.exitAi()
      })
      .catch((err) => {
        // 同上：页面已卸载时 onUnload 已收过 loading，这里不能再弹 toast / 改状态
        if (this._destroyed) return
        this.stopAiTimers()
        wx.hideLoading()
        const code = err && err.code
        const msg = (err && err.message) || 'AI 处理失败'
        if (code === 3003 || code === 3005) {
          // 额度用完 / 未配置：不是「重试就能好」，记下原因并置灰 ✓（功能栏保留，可看提示或换能力）
          this._aiBlocked = { ...(this._aiBlocked || {}), [info.key]: msg }
          this.setData({ aiBlockReason: msg })
        }
        wx.showToast({ title: msg, icon: 'none' })
      })
      .finally(() => {
        // 兜底：导出失败（画布未就绪等）也会走到这里，保证定时器与 aiLoading 一定复位。
        // 注意这里不碰 loading 浮层 —— 收浮层的时机必须紧挨着 showToast（见上）
        this.stopAiTimers()
        if (!this._destroyed && this.data.aiLoading) this.setData({ aiLoading: false })
      })
  },

  /**
   * 开始 AI 等待：带「已用时」的进度提示 + 看门狗。
   *
   * 上游耗时波动很大（实测 66s ~ 300s），只显示静止的「处理中」会让人以为卡死；
   * 进度秒表既说明「还在跑」，也让用户能判断要不要继续等。
   * 看门狗保证任何异常路径（平台不回调 fail、连接被对端断开等）下 loading 都会被收掉，
   * 否则 mask 遮罩会一直盖住整页，✓/× 都点不动（见 11.3 第 18 条）。
   */
  startAiLoading(info) {
    this.setData({ aiLoading: true })
    const startedAt = Date.now()
    const paint = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000)
      const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      wx.showLoading({ title: `${info.name}处理中 ${clock}`, mask: true })
    }
    paint()
    this._aiTick = setInterval(paint, 1000)
    this._aiWatchdog = setTimeout(() => {
      this._aiWatchdog = null
      this.stopAiTimers()
      wx.hideLoading()
      if (this.data.aiLoading) this.setData({ aiLoading: false })
      wx.showToast({ title: 'AI 处理超时，请重试', icon: 'none' })
    }, AI_UPLOAD_TIMEOUT + AI_WATCHDOG_EXTRA)
  },

  /** 清掉 AI 进度定时器与看门狗（不碰 loading 浮层：浮层的收放由调用方按顺序处理） */
  stopAiTimers() {
    if (this._aiTick) {
      clearInterval(this._aiTick)
      this._aiTick = null
    }
    if (this._aiWatchdog) {
      clearTimeout(this._aiWatchdog)
      this._aiWatchdog = null
    }
  },

  /** 上传临时图到 /api/ai/<ability>，返回结果图完整 URL */
  uploadForAI(tempPath, ability) {
    const formData = {}
    if (ability === 'style') formData.style = this.data.aiStyle
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: absoluteUrl(`/api/ai/${ability}`),
        filePath: tempPath,
        name: 'file',
        formData,
        // AI 出图是同步长耗时（实测单张 66~122s），必须放宽超时：
        // 小程序默认 60s，不改这里真机上必然「网络异常」而实际服务端还在出图。
        // 与 app.json 的 networkTimeout.uploadFile 保持一致。
        timeout: AI_UPLOAD_TIMEOUT,
        header: { Authorization: `Bearer ${getToken()}` },
        success: (res) => {
          let body = null
          try {
            body = JSON.parse(res.data)
          } catch (e) {
            body = null
          }
          // 除 code 外还必须判 data.url：code=0 但缺该字段时访问 body.data.url 会抛 TypeError，
          // 而该抛出不经过 Promise executor —— Promise 既不合也不失败，整条 AI 链会永久挂起
          // （只能靠看门狗兜住）。空值兜底口径同 mine.js / chat.js 的上传回调。
          if (body && body.code === 0 && body.data && body.data.url) {
            resolve(absoluteUrl(body.data.url))
            return
          }
          // 把错误码一起抛出：调用方据此区分「额度用完 3003 / 未配置 3005 / 参数非法 3004 / 处理失败 3002」
          reject(Object.assign(new Error((body && body.msg) || 'AI 处理失败'), {
            code: body ? body.code : -1,
          }))
        },
        fail: (err) => {
          const raw = (err && err.errMsg) || ''
          reject(
            Object.assign(
              new Error(raw.indexOf('timeout') >= 0 ? 'AI 处理超时，请稍后重试' : '网络异常，请稍后重试'),
              { code: -1 }
            )
          )
        },
      })
    })
  },

  // ---------- 历史（撤销/重做） ----------

  snapshot() {
    return {
      path: this.basePath,
      // 本次会话是否用过 AI：决定「保存」时作品类型取 ai 还是 basic/sticker，
      // 必须与底图/参数一起入栈 —— 否则「用了 AI 再撤销」后保存，作品仍会被标成 AI 创作
      aiAbility: this._aiAbility || '',
      // 相框同理：它是会话级装饰层（不属于底图），入栈才能被撤销/重做精确还原
      frameKey: normalizeFrame(this.frameKey),
      rotation: this.rotation || 0,
      // 裁切功能栏的微调角也是画面状态的一部分：不入栈时「转 90° + 拨 30° → ✓ → 撤销」
      // 只会还原 rotation，微调角丢失而刻度盘仍显示 0 → 显示与实际画面不一致
      fineAngle: this.fineAngle || 0,
      flipX: !!this.flipX,
      flipY: !!this.flipY,
      filter: this.filter || 'none',
      adj: { ...this.adj },
      // 笔迹只**复制点数组**（slice）而不逐个复制点对象：点是只读的（绘制只读 x/y，
      // 新增点一律 push 到活动笔迹上，从不原地修改），复制数组即可冻结快照时的长度；
      // 一条 300 点的笔迹原来每按一次撤销就多分配 300 个对象。
      doodles: this.doodles.map((s) => ({
        color: s.color,
        size: s.size,
        points: s.points.slice(),
      })),
      // 文字（含颜色/字号/位置）与马赛克笔画一并入栈，撤销可整体还原
      texts: (this.texts || []).map((t) => ({ ...t })),
      mosaics: (this.mosaics || []).map((s) => ({
        size: s.size,
        level: s.level,
        points: (s.points || []).map((p) => ({ x: p.x, y: p.y })),
      })),
      stickers: this.layerStickers.map((s) => ({
        id: s.id,
        src: s.src,
        nx: s.nx,
        ny: s.ny,
        nw: s.nw,
        nh: s.nh,
        rot: s.rot,
        // 模板叠加层（tpl=true）不参与贴纸拖动，还原时必须带上这个标记
        tpl: !!s.tpl,
      })),
    }
  },

  /** 压入撤销栈；不传 snap 时记录当前状态（裁切/滤镜会话可传入「进入前」的快照） */
  pushHistory(snap) {
    this.undoStack.push(snap || this.snapshot())
    if (this.undoStack.length > 30) this.undoStack.shift()
    this.redoStack = []
    this.refreshFlags()
  },

  applySnapshot(s) {
    if (!s || !this.canvas) return
    this._aiAbility = s.aiAbility || ''
    this.frameKey = normalizeFrame(s.frameKey)
    this.rotation = s.rotation
    this.fineAngle = s.fineAngle || 0
    this.flipX = s.flipX
    this.flipY = s.flipY
    this.filter = s.filter
    this.adj = { ...s.adj }
    this.doodles = s.doodles.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }))
    this.texts = (s.texts || []).map((t) => ({ ...t }))
    this.mosaics = (s.mosaics || []).map((x) => ({
      size: x.size,
      level: x.level,
      points: (x.points || []).map((p) => ({ ...p })),
    }))
    this._textSel = null
    this.layerStickers = []
    // 微调角要一起回写视图层（刻度盘显示它），否则还原后刻度盘与实际角度对不上
    this.setData({ filter: this.filter, fineAngle: this.fineAngle })
    this.pushAdjData()
    const stickers = (s.stickers || []).filter((x) => x && x.src)
    let pending = stickers.length
    // 代际令牌：撤销/重做连点（或导出中途返回）时，上一轮贴纸图片的 onload 可能在本轮之后才到，
    // 直接 push 会往当前状态里塞进不属于它的叠加层（画面上出现「撤销不掉的贴纸」）
    const gen = (this._snapSeq || 0) + 1
    this._snapSeq = gen
    const alive = () => this._snapSeq === gen && !!this.canvas
    const done = () => {
      if (!alive()) return
      this.refreshFlags()
      this.computeCropUI()
    }
    stickers.forEach((st) => {
      const img = this.canvas.createImage()
      img.onload = () => {
        if (alive()) {
          this.layerStickers.push({ ...st, img })
          this.render()
        }
        if (--pending === 0) done()
      }
      img.onerror = () => {
        if (--pending === 0) done()
      }
      img.src = st.src
    })
    if (s.path && s.path !== this.basePath) {
      this.basePath = s.path
      this.reloadImage(s.path).then(done)
    } else {
      this.render()
      done()
    }
  },

  /** 是否存在编辑（决定「保存」是否可用） */
  hasChanges() {
    return !!(
      (this.basePath && this.basePath !== this.originalPath) ||
      this.rotation ||
      this.flipX ||
      this.flipY ||
      this.filter !== 'none' ||
      this.doodles.length ||
      (this.texts || []).length ||
      (this.mosaics || []).length ||
      (this.layerStickers || []).length ||
      hasFrame(this.frameKey) ||
      ADJ_KEYS.some((k) => (this.adj[k] || 0) !== 0)
    )
  },

  refreshFlags() {
    this.setData({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      hasEdits: this.hasChanges(),
    })
  },

  // ================= 绘制 =================

  /** 计算图片 content-fit 在绘制视口中的位置并重绘 */
  render() {
    const { canvas, ctx, pxW, pxH, dpr } = this
    if (!canvas || !this.imgReady) return
    // 视口（.anchor）尚未量到时不画：首帧的默认视口是「整块画布」，编辑层若按它画一帧，
    // 图片会先以整屏尺寸出现、再随 syncViewport 收缩（又是一次「闪一下」）。
    // syncViewport 量取成功/失败兜底时都会把 _vpReady 置真并主动 render 一次。
    if (!this._vpReady) return

    // 绘制视口（画布 px）：由当前层的 .anchor 量取得到
    const vp = this.viewport || { x: 0, y: 0, w: pxW / dpr, h: pxH / dpr }
    const vx = vp.x * dpr
    const vy = vp.y * dpr
    const vw = vp.w * dpr
    const vh = vp.h * dpr

    // 总旋转角 = 90° 步进旋转 + 裁切功能栏的角度微调
    const ex = this._exportOffset
    const rot = this.totalAngle()
    const rad = (rot * Math.PI) / 180
    // 任意角度下的旋转外接框（90° 整数倍时与原来完全等价）
    const ca = Math.abs(Math.cos(rad))
    const sa = Math.abs(Math.sin(rad))
    const effW = this.imgW * ca + this.imgH * sa
    const effH = this.imgW * sa + this.imgH * ca
    const scale = Math.min(vw / effW, vh / effH)
    const dw = this.imgW * scale
    const dh = this.imgH * scale
    const cx = vx + vw / 2
    const cy = vy + vh / 2

    // 记录绘制几何：显示区域（画布 px 外接矩形）+ 图片中心与未旋转尺寸。
    // **必须在绘制叠加层之前写入**：笔迹 / 马赛克 / 文字都在图片空间（dw·dh）里定位，
    // 而 drawMosaics / drawStroke 读的是 this.imgRect —— 若沿用上一次渲染的旧几何，
    // 视口变化（进出功能栏、切换工具面板、切 Tab 让底部工具区变高变矮）后的那一帧
    // 叠加层会按旧尺寸绘制，与底图错位，且要等下一次重绘才恢复。
    // 导出模式下 dw / dh / cx / cy 与普通渲染完全相同（视口未变），写入的值同样正确。
    const bw = dw * ca + dh * sa
    const bh = dw * sa + dh * ca
    this.displayRegion = { x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh }
    this.imgRect = { cx, cy, dw, dh }

    ctx.clearRect(0, 0, ex ? ex.w : pxW, ex ? ex.h : pxH)
    // 沉浸预览层：黑幕与图片同层同帧（先铺黑再画图；编辑层 / 查看层 / 导出不铺）
    this.paintBackdrop()
    ctx.save()
    if (ex) {
      // 导出模式：缓冲区即目标区域，画面整体平移到左上角（1:1，不缩放）
      ctx.translate(-ex.x, -ex.y)
    } else {
      ctx.beginPath()
      ctx.rect(vx, vy, vw, vh)
      ctx.clip()
    }
    // 滤镜预设与增强五项统一走逐像素（见 ensureAdjustedSource）：**iOS 真机的 canvas 2d
    // 不支持 ctx.filter**，只把效果写进 ctx.filter 的话在 iOS 上会全部静默失效。
    // 仅当逐像素不可用（离屏 canvas 不可用 / 取像素失败 → adjSrc 为空）时才退回 ctx.filter 近似，
    // 作为「最后的尽力而为」——它只在支持 filter 属性的平台（如开发者工具、部分安卓）上有效。
    const src = this.ensureAdjustedSource(this._adjFast === true) || this.img
    ctx.translate(cx, cy)
    ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1)
    ctx.rotate(rad)
    if (!this.adjSrc) ctx.filter = this.buildFilter()
    ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh)
    ctx.filter = 'none'
    // 图片自身矩形内裁剪叠加内容（模板/笔迹），避免溢出到黑底
    ctx.save()
    ctx.beginPath()
    ctx.rect(-dw / 2, -dh / 2, dw, dh)
    ctx.clip()
    this.drawStickers(dw, dh)
    this.drawMosaics(dw, dh)
    this.drawDoodles(dw, dh)
    this.drawTexts(dw, dh)
    // 相框画在**最上层**：它是贴边的内缩边框，最后画才能保证涂鸦 / 文字 / 贴纸都盖不住它。
    // 内部拍平导出（裁切 / 涂鸦拍平 / AI 入参）跳过，避免相框被烘进底图后重复绘制
    if (this.shouldDrawFrame()) drawFrame(ctx, this.frameKey, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
    ctx.restore()

    // 画布已经画出这一帧：撤掉 DOM 占位图（两者同为 aspectFit、同一视口，切换无痕）
    this.dropPreviewPhoto()

    // 导出模式：不绘制裁切框（否则会被烘焙进导出图；显示几何已在绘制前写好）
    if (ex) return

    // 裁切框与图片同层绘制（canvas 是原生组件，DOM 浮层会被其盖住）；导出时跳过
    if (!this._noOverlay) this.drawCropOverlay()
  },

  /**
   * 绘制裁切框：四角白色括号 +（拖动中）三分九宫格辅助线。
   * 必须画在 canvas 上：小程序 canvas 渲染层独立于 WXML 节点树、层级恒高于普通节点
   * （z-index 无效），DOM 浮层会被图片直接盖住。导出前由 _noOverlay 跳过，避免被烘焙。
   */
  drawCropOverlay() {
    const box = this.cropBox
    const { ctx } = this
    if (!ctx || !box || !this.data.cropMode) return
    const len = Math.min(box.width, box.height) * 0.18
    const L = box.x
    const T = box.y
    const R = box.x + box.width
    const B = box.y + box.height
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,.95)'
    ctx.lineWidth = Math.max(2, 3 * this.dpr)
    ctx.beginPath()
    // 四角括号：向框内折角
    const corners = [
      [L, T, 1, 1],
      [R, T, -1, 1],
      [L, B, 1, -1],
      [R, B, -1, -1],
    ]
    corners.forEach((c) => {
      ctx.moveTo(c[0] + c[2] * len, c[1])
      ctx.lineTo(c[0], c[1])
      ctx.lineTo(c[0], c[1] + c[3] * len)
    })
    ctx.stroke()
    if (this.data.cropDragging) {
      ctx.strokeStyle = 'rgba(255,255,255,.3)'
      ctx.lineWidth = Math.max(1, this.dpr)
      ctx.beginPath()
      for (let i = 1; i <= 2; i++) {
        const x = L + (box.width * i) / 3
        const y = T + (box.height * i) / 3
        ctx.moveTo(x, T)
        ctx.lineTo(x, B)
        ctx.moveTo(L, y)
        ctx.lineTo(R, y)
      }
      ctx.stroke()
    }
    ctx.restore()
  },

  /**
   * ctx.filter 字符串：滤镜 + 增强五项。
   * 曝光与亮度都落在 brightness 上（叠加），自然饱和度按较小的系数作用在 saturate 上
   * （canvas 2D 的 ctx.filter 没有独立的曝光/自然饱和度算子，只能这样近似）。
   *
   * **只作为兜底使用**：正常路径下这些效果全部由 ensureAdjustedSource() 逐像素完成，
   * 只有在逐像素不可用（`adjSrc` 为空）时 `render()` / `drawMosaics()` 才退回这里 ——
   * 因为 iOS 真机的 canvas 2d 不支持 ctx.filter，这条兜底在 iOS 上等于无效果（见 compileFilter）。
   */
  buildFilter() {
    const f = FILTER_MAP[this.filter] || FILTER_MAP.none
    const a = this.adj || ADJ_DEFAULT
    const d = (k) => (a[k] || 0) / 100
    // 曝光 / 自然饱和度优先由逐像素处理（ensureAdjustedSource）作用在底图上，这里不再重复施加；
    // 仅当取像素不可用（adjSrc 缺失、已退化为纯 ctx.filter）时才把它们近似并入
    const pixel = !!this.adjSrc
    const exposure = pixel ? 0 : d('exposure')
    const vibrance = pixel ? 0 : d('vibrance')
    const brightness = Math.max(0, 1 + exposure + d('brightness'))
    const contrast = Math.max(0, 1 + d('contrast'))
    const saturate = Math.max(0, 1 + d('saturate') + vibrance * 0.5 + exposure * 0.35)
    // 注意：CSS filter 的 none 是独立关键字，不能与其它函数并列 —— "none brightness(1)" 整条非法、
    // 会被浏览器/WebView 整体忽略（不是只忽略 none）。而「原图」预设的 value 正是 'none'，
    // 所以未选滤镜时必须把它省略，否则增强的亮度/对比度/饱和度会静默失效。
    const parts = []
    if (f && f.value && f.value !== 'none') parts.push(f.value)
    parts.push(`brightness(${brightness.toFixed(3)})`)
    parts.push(`contrast(${contrast.toFixed(3)})`)
    parts.push(`saturate(${saturate.toFixed(3)})`)
    return parts.join(' ')
  },

  /** 绘制叠加层（模板 / 贴纸），坐标为图片空间归一值 */
  drawStickers(dw, dh) {
    const { ctx } = this
    const list = this.layerStickers || []
    for (const s of list) {
      if (!s.img) continue
      const w = s.nw * dw
      const h = s.nh * dh
      ctx.save()
      ctx.translate((s.nx - 0.5) * dw, (s.ny - 0.5) * dh)
      ctx.rotate(((s.rot || 0) * Math.PI) / 180)
      ctx.drawImage(s.img, -w / 2, -h / 2, w, h)
      // 拖动中的贴纸显示白色虚线选中框（与文字叠加层同一套观感）。
      // 导出期间必须跳过：选中框是「交互反馈」，不是画面内容 —— 否则它会跟着被烘进
      // 保存的作品图 / 下载到相册的图 / AI 入参图与裁切结果（口径同 shouldDrawFrame）
      if (this._stkSel === s.id && !this._exportOffset) {
        ctx.setLineDash([6, 5])
        ctx.lineWidth = Math.max(1, this.dpr)
        ctx.strokeStyle = 'rgba(255,255,255,.9)'
        ctx.strokeRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8)
        ctx.setLineDash([])
      }
      ctx.restore()
    }
  },

  /** 绘制全部笔迹（含正在绘制中的当前笔迹，保证跟手可见） */
  drawDoodles(dw, dh) {
    const list = this.doodles || []
    for (const s of list) this.drawStroke(s, dw, dh)
    if (this._stroke) this.drawStroke(this._stroke, dw, dh)
  },

  /**
   * 绘制马赛克：把像素化底图按笔迹覆盖区域裁剪后画上去。
   * 底图离屏不可用时退化为模糊，保证功能仍可见。
   */
  drawMosaics(dw, dh) {
    const list = this.mosaics || []
    if (!list.length && !this._mosaic) return
    const { ctx } = this
    const r = this.imgRect || { dw, dh }
    const w = r.dw || dw
    const h = r.dh || dh
    const paint = (s) => {
      if (!s || !s.points || !s.points.length) return
      const src = this.ensurePixelImage(s.level)
      ctx.save()
      this.traceStroke(s, w, h)
      ctx.clip()
      // 像素化底图取自 this.adjSrc || this.img（见 ensurePixelImage）。adjSrc 已包含滤镜与增强的
      // 逐像素结果，因此正常路径下这里**不能再叠一次 ctx.filter** —— 既会重复施加，在 iOS 上又根本不生效；
      // 只有逐像素不可用（adjSrc 为空）时才用 buildFilter() 让马赛克块与主画面保持同一口径。
      const paintFilter = this.adjSrc ? 'none' : this.buildFilter()
      if (src) {
        // 关闭插值放大，块状边缘才清晰（webkit 前缀兼容旧 webview）
        ctx.imageSmoothingEnabled = false
        ctx.webkitImageSmoothingEnabled = false
        ctx.filter = paintFilter
        ctx.drawImage(src, -w / 2, -h / 2, w, h)
      } else {
        ctx.filter = paintFilter === 'none' ? 'blur(14px)' : `${paintFilter} blur(14px)`
        ctx.drawImage(this.adjSrc || this.img, -w / 2, -h / 2, w, h)
      }
      ctx.filter = 'none'
      ctx.imageSmoothingEnabled = true
      ctx.webkitImageSmoothingEnabled = true
      ctx.restore()
    }
    list.forEach(paint)
    paint(this._mosaic)
  },

  /**
   * 把一条「粗描边笔迹」转成可 clip 的闭合路径。
   * clip() 取的是路径填充区，而笔迹是描边形态，故手工铺出：每点一个圆（含圆头）
   * + 相邻两点间一个四边形，多个子路径在 nonzero 规则下取并集，即为笔画覆盖区。
   */
  traceStroke(stroke, w, h) {
    const { ctx } = this
    const pts = stroke.points || []
    const rad = Math.max(0.5, (((stroke.size || 8) / 1000) * w) / 2)
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const x = (pts[i].x - 0.5) * w
      const y = (pts[i].y - 0.5) * h
      ctx.moveTo(x + rad, y)
      ctx.arc(x, y, rad, 0, Math.PI * 2)
      const n = pts[i + 1]
      if (!n) continue
      const nx = (n.x - 0.5) * w
      const ny = (n.y - 0.5) * h
      const dx = nx - x
      const dy = ny - y
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const ox = (-dy / len) * rad
      const oy = (dx / len) * rad
      ctx.moveTo(x + ox, y + oy)
      ctx.lineTo(nx + ox, ny + oy)
      ctx.lineTo(nx - ox, ny - oy)
      ctx.lineTo(x - ox, y - oy)
      ctx.closePath()
    }
  },

  /** 绘制文字叠加层（归一化坐标 → 图片空间，字号随图片尺寸等比缩放） */
  drawTexts(dw, dh) {
    const list = this.texts || []
    if (!list.length) return
    const { ctx } = this
    const w = dw || 1
    const h = dh || 1
    list.forEach((t) => {
      const font = Math.max(6, ((t.size || 8) / 100) * h)
      ctx.save()
      ctx.translate((t.nx - 0.5) * w, (t.ny - 0.5) * h)
      if (t.rot) ctx.rotate((t.rot * Math.PI) / 180)
      ctx.font = `${font}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // 深色描边：保证浅色文字在花背景上也能看清
      ctx.lineWidth = Math.max(2, font * 0.16)
      ctx.strokeStyle = 'rgba(0,0,0,.45)'
      ctx.strokeText(t.text, 0, 0)
      ctx.fillStyle = t.color || '#ffffff'
      ctx.fillText(t.text, 0, 0)
      // 记录命中框（归一化），供拖动选中使用
      const tw = Math.max(1, ctx.measureText(t.text).width)
      t._nw = tw / w
      t._nh = font / h
      // 同上：文字选中框只在显示态画，导出期间跳过，避免被烘进产物
      if (this._textSel === t.id && !this._exportOffset) {
        ctx.setLineDash([6, 5])
        ctx.lineWidth = Math.max(1, font * 0.08)
        ctx.strokeStyle = 'rgba(255,255,255,.9)'
        ctx.strokeRect(-tw / 2 - 8, -font / 2 - 6, tw + 16, font + 12)
        ctx.setLineDash([])
      }
      ctx.restore()
    })
  },

  /** 绘制一条笔迹（归一化坐标 → 图片空间） */
  drawStroke(stroke, dw, dh) {
    const { ctx } = this
    if (!ctx || !stroke || !stroke.points || !stroke.points.length) return
    const r = this.imgRect || { dw: dw || 1, dh: dh || 1 }
    const w = r.dw
    const h = r.dh
    ctx.save()
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = (stroke.size / 1000) * w
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    stroke.points.forEach((p, i) => {
      const x = (p.x - 0.5) * w
      const y = (p.y - 0.5) * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.restore()
  },

  // ================= 查看层动作 =================

  /** 第二层返回：退出页面（无历史时回落首页） */
  onBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    })
  },

  /** 第二层「下载」：导出当前图 → 保存到系统相册 */
  onDownload() {
    if (!this.imgReady || this.data.saving) return
    this.setData({ saving: true })
    this.exportRegion(this.displayRegion, true) // 最终导出：带相框
      .then(
        (tempPath) =>
          new Promise((resolve, reject) => {
            wx.saveImageToPhotosAlbum({ filePath: tempPath, success: resolve, fail: reject })
          })
      )
      .then(() => wx.showToast({ title: '已保存到相册', icon: 'success' }))
      .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }))
      .finally(() => this.setData({ saving: false }))
  },

  /** 第二层「收藏」：导出 → 上传 → 创建作品 */
  onFavorite() {
    if (this.data.saving || !this.imgReady) return
    if (this.workId) {
      wx.showToast({ title: '已在我的作品中', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    this.saveAsWork()
      .then(() => {
        this.setData({ favorited: true })
        wx.showToast({ title: '已收藏到我的作品', icon: 'success' })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '收藏失败', icon: 'none' })
      })
      .finally(() => this.setData({ saving: false }))
  },

  /** 第二层「删除」：确认后删除已收藏作品并退出 */
  onDelete() {
    wx.showModal({
      title: '删除图片',
      content: this.workId ? '将同时删除已收藏的这条作品，确定吗？' : '确定删除这张图片吗？',
      confirmColor: '#ff3b30',
      success: (res) => {
        if (!res.confirm) return
        const goBack = () =>
          wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) })
        if (!this.workId) {
          goBack()
          return
        }
        request({ url: `/api/works/${this.workId}`, method: 'DELETE' })
          .then(goBack)
          .catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' })
          })
      },
    })
  },

  /** 第二层「更多」 */
  onMore() {
    if (!this.imgReady) return
    wx.showActionSheet({
      itemList: ['保存到相册', '重置为原图', '图片信息'],
      success: (res) => {
        // 「保存到相册」直接复用下载：导出与存相册的逻辑只保留一份（含 saving 防重入，
        // 两次导出并发会互相破坏画布缓冲区与显示矩形，见 exportRegion 的说明）
        if (res.tapIndex === 0) this.onDownload()
        else if (res.tapIndex === 1) this.onReset()
        else if (res.tapIndex === 2) this.showImageInfo()
      },
    })
  },

  /** 重置为进入页面时的原图（与「取消 → 放弃」同一实现，只是多一句提示） */
  onReset() {
    if (!this.originalPath) return
    this.discardEdits()
    wx.showToast({ title: '已重置为原图', icon: 'none' })
  },

  showImageInfo() {
    const d = this.displayRegion
    const edited = this.hasChanges()
    wx.showModal({
      title: '图片信息',
      content: `拍摄时间：${this.data.shootDate} ${this.data.shootTime}\n显示尺寸：${Math.round(d ? d.width / this.dpr : 0)} × ${Math.round(d ? d.height / this.dpr : 0)}\n状态：${edited ? '已编辑' : '原图'}`,
      showCancel: false,
    })
  },

  /** 导出当前区域 → 上传 → 创建作品，返回作品 id */
  saveAsWork() {
    // 作品类型在**保存这一刻**按会话状态判定（AI 不再「处理即入库」，见 M30）：
    // 用过 AI → ai；含装饰叠加层（模板/贴纸/**相框**）→ sticker；否则 basic
    const decorated =
      (this.layerStickers && this.layerStickers.length) || hasFrame(this.frameKey)
    const workType = this._aiAbility ? 'ai' : (decorated ? 'sticker' : 'basic')
    return this.exportRegion(this.displayRegion, true) // 最终导出：带相框
      .then((tempPath) => this.uploadImage(tempPath))
      .then((up) => this.createWork(up.url, up.thumbUrl, workType))
      .then((res) => {
        const id = res && res.data && (res.data.id || res.data.work_id)
        if (id) this.workId = id
        return id
      })
  },

  /** 让出两帧：等 canvas 真正绘制落盘后再截图（绘制后立刻导出会拿到空白画布） */
  nextFrame() {
    return new Promise((resolve) => {
      // 固定住 canvas 引用：第二次 requestAnimationFrame 里再读 this.canvas 可能已被 onUnload
      // 置空（导出中途返回），那会抛 TypeError 让整条导出链变成失败
      const canvas = this.canvas
      const raf = canvas && canvas.requestAnimationFrame
      if (!raf) {
        setTimeout(resolve, 32)
        return
      }
      canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(() => resolve()))
    })
  },

  /**
   * 导出画布指定区域(px)为临时图片。
   * 不能把 x/y/width/height 交给 canvasToTempFilePath：各基础库/平台对其坐标基准认定
   * 不一致（画布缓冲区像素 / 逻辑像素），传错就会导出整块空白，编码成 JPEG 后即全黑。
   * 做法：① 缓冲区尺寸裁剪到目标区域，画面整体平移使该区域对齐画布左上角（1:1，不缩放）；
   *      ② canvas 元素显示矩形同步设为该区域（视觉位置尺寸不变，且天然不含裁切框等叠加绘制）；
   *      ③ 导出整块画布（不带区域参数）；④ 复原缓冲区、显示矩形并重绘。
   *
   * `withFrame` 控制导出是否含相框，**默认 false（不含）** —— 安全默认值：新增调用点时
   * 不会因为忘记处理而把相框烘进「内部拍平」的底图（裁切 / 涂鸦拍平 / AI 入参都会把结果
   * 重新载入为底图，相框会被再画一遍，出现双重边框）。只有最终给用户看的导出
   * （保存作品 / 下载到相册）才显式传 true。
   */
  exportRegion(box, withFrame) {
    if (!this.canvas || !box) return Promise.reject(new Error('画布未就绪'))
    // 串行化：导出期间画布缓冲区被临时裁到目标区域、`_exportOffset` 全程生效，
    // 两条导出链重叠（「拍平涂鸦」还没结束用户又点了保存 / 连点两次保存）会互相踩缓冲区，
    // 症状是偶发黑图或导出了错误的区域。这里把并发导出排成队列，后一条等前一条复原完再跑。
    const run = () => this._doExport(box, withFrame)
    this._exportChain = (this._exportChain || Promise.resolve()).then(run, run)
    return this._exportChain
  },

  /** 真正的导出实现（只允许经由 exportRegion 调用，串行化原因见那里的注释） */
  _doExport(box, withFrame) {
    if (!this.canvas) return Promise.reject(new Error('画布未就绪'))
    this._adjFast = false // 导出必须用完整档的逐像素底图
    this._exportWithFrame = withFrame === true
    const rawW = this.pxW
    const rawH = this.pxH
    const w = Math.max(1, Math.round(box.width))
    const h = Math.max(1, Math.round(box.height))
    this._exportOffset = { x: Math.round(box.x), y: Math.round(box.y), w, h }
    this.canvas.width = w
    this.canvas.height = h
    this.setData({
      canvasStyle:
        `left:${box.x / this.dpr}px;top:${box.y / this.dpr}px;` +
        `width:${w / this.dpr}px;height:${h / this.dpr}px;`,
    })
    this.render()
    const restore = () => {
      this._exportOffset = null
      this._exportWithFrame = true // 回到默认：非导出（显示）状态始终绘制相框
      // 页面已卸载（onUnload 置空 canvas）：缓冲区没什么可还原的，但上面两个标记必须先复位，
      // 否则队列里的下一条导出会以为「还在导出中」而按错误的尺寸画
      if (!this.canvas) return
      this.canvas.width = rawW
      this.canvas.height = rawH
      this.setData({ canvasStyle: '' })
      this.render()
    }
    return this.nextFrame()
      .then(
        () =>
          new Promise((resolve, reject) => {
            wx.canvasToTempFilePath({
              canvas: this.canvas,
              fileType: 'jpg',
              quality: 0.9,
              success: (res) => resolve(res.tempFilePath),
              fail: reject,
            })
          })
      )
      .then((tempPath) => {
        restore()
        return tempPath
      })
      .catch((err) => {
        restore()
        throw err
      })
  },

  /** 上传临时图到后端，返回 { url, thumbUrl }（缩略图由后端在 upload 时生成） */
  uploadImage(tempPath) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: absoluteUrl('/api/upload'),
        filePath: tempPath,
        name: 'file',
        header: { Authorization: `Bearer ${getToken()}` },
        success: (res) => {
          try {
            const body = JSON.parse(res.data)
            // 除 code 外还要判 data.url：code=0 但缺字段时 body.data.url 会在 success 回调里抛
            // TypeError —— 该抛出不经过 Promise executor，Promise 既不合也不失败，
            // 调用方（保存/收藏）的 finally 永不执行，「保存中」会一直卡住
            if (body && body.code === 0 && body.data && body.data.url) {
              resolve({ url: body.data.url, thumbUrl: body.data.thumb_url })
            } else {
              reject(new Error((body && body.msg) || '上传失败'))
            }
          } catch (e) {
            reject(new Error('上传响应异常'))
          }
        },
        fail: () => reject(new Error('网络异常')),
      })
    })
  },

  createWork(imageUrl, thumbUrl, workType) {
    return request({
      url: '/api/works',
      method: 'POST',
      data: {
        title: '我的作品',
        type: workType || 'basic',
        image_path: imageUrl,
        // undefined 在 JSON 序列化时会被丢弃，未拿到缩略图时不传该字段
        thumb_path: thumbUrl || undefined,
      },
    })
  },

  /** 用指定路径重载底图（保留当前编辑参数），返回 Promise */
  reloadImage(path) {
    return new Promise((resolve) => {
      // 页面已卸载（onUnload 置空 canvas）时直接失败：异步链条（导出 → 上传 → 重载底图）
      // 可能在卸载之后才回到这里，此时 createImage() 会抛 TypeError，把整条链变成未处理异常
      if (!this.canvas || !path) {
        resolve(false)
        return
      }
      const img = this.canvas.createImage()
      img.onload = () => {
        if (!this.canvas) {
          resolve(false)
          return
        }
        this.img = img
        this.imgW = img.width
        this.imgH = img.height
        this.imgReady = true
        this.render()
        this.computeCropUI()
        this.refreshFlags()
        resolve(true)
      }
      img.onerror = () => {
        wx.showToast({ title: '图片加载失败', icon: 'none' })
        resolve(false)
      }
      img.src = path
    })
  },

  /** 模板套用：模板图铺满图片区域，作为归一化叠加层（跟随旋转/翻转） */
  applyTemplateOverlay(filePath) {
    if (!this.displayRegion) return
    const src = absoluteUrl(filePath)
    const img = this.canvas.createImage()
    img.onload = () => {
      // 模板图片加载期间用户可能已离开页面：此时再改状态没人渲染，只会留下脏数据
      if (!this.canvas) return
      this.layerStickers.unshift({
        id: this.nextOverlayId('tpl'),
        src,
        img,
        nx: 0.5,
        ny: 0.5,
        nw: 1,
        nh: 1,
        rot: 0,
        tpl: true, // 模板是全画布装饰层：不参与贴纸拖动命中（见 hitSticker）
      })
      this.render()
      this.refreshFlags()
      wx.showToast({ title: '模板已套用', icon: 'none' })
    }
    img.onerror = () => wx.showToast({ title: '模板加载失败', icon: 'none' })
    img.src = src
  },

  /** 首图加载完成后套用模板（仅一次） */
  consumeTemplate() {
    if (!this.pendingTemplate) return
    const tpl = this.pendingTemplate
    this.pendingTemplate = ''
    this.applyTemplateOverlay(tpl)
  },

  /**
   * 首图加载完成后**直达**首页 AI 卡片对应的功能栏（仅一次）。
   *
   * 与手动进入的差别只有「少点三步」，且**不再重放进场动画**：
   * - 直达入口（`ai=`）在 `onLoad` 里就把 `layer / editTab / aiMode / aiAbility` 写进首帧，
   *   所以页面一出现就是「已在功能栏里」的形态（见 11.3 第 67 条）；这里只需补一次额度查询。
   * - 旧实现是「加载完图片 → setLayer('edit') → 80ms 后 enterAi（工具区下移 240ms → 功能栏
   *   上滑）」——用户先看到整屏图片，随后深色工具栏与功能栏依次盖上来，观感就是
   *   「图片闪一下 + 黑幕」。这也是「导入」正常、其它入口有闪断的原因（导入不带 ai 参数）。
   *
   * **只进功能栏、不自动执行 AI**：额度消耗必须由用户点「✓」触发（见 8.8 / M30），
   * 进入后用户还能换风格、改主意点「×」退出，不产生任何副作用。
   */
  consumeAiEntry() {
    const ability = this.pendingAi
    this.pendingAi = ''
    if (!ability || !this.imgReady) return
    // 一个入口只会带一个落点：既然直达 AI 功能栏，就不该再打开工具面板
    // （两者占同一个底部区域，同时进入会互相打架）
    this.pendingPanel = ''
    if (this._aiDirect) {
      // 首帧已在功能栏：只补一次额度（失败静默），不切层、不动画
      this.loadQuota(ability)
      return
    }
    this.setLayer('edit')
    this.setData({ editTab: 'ai' }, () => {
      // AI 创作工具行比基础工具行多一行风格胶囊，绘制视口随之变化，需重新量取
      this.syncViewport()
      // enterAi 内部是「工具区下移 240ms → 功能栏上滑」的动画序列，等这一帧布局落定再进入，
      // 否则量到的还是旧视口（图片缩放/位置会与新的可见区域错位）
      this.later(() => this.enterAi(ability), 80)
    })
  },

  /**
   * 首图加载完成后**直达**首页工具入口对应的底部工具面板（仅一次，见 M54）。
   *
   * 与 `consumeAiEntry` 同一套口径：**首帧就已经是编辑层 + 目标面板**（`onLoad` 里写进
   * `data.panel`），这里只做资源补拉与视口校正，不再 `setLayer('edit')` + 80ms 后
   * `setPanel()` —— 那一次「切层 + 面板展开」会让图片先整屏出现、再随布局收缩（闪断）。
   *
   * **只打开面板、不替用户动作**：不新增任何叠加层、不烘焙底图、不产生计费调用，
   * 用户可以直接改主意点其他工具或「×」退出。贴纸面板的列表仍由 `loadStickers()` 提供
   * （自带缓存与失败终态）。
   */
  consumePanelEntry() {
    const panel = this.pendingPanel
    this.pendingPanel = ''
    if (!panel || !this.imgReady) return
    // 兜底：若已进入某个独立功能栏（理论上不会，consumeAiEntry 已清掉面板参数），不叠加打开
    if (this.data.cropMode || this.data.filterMode || this.data.adjustMode || this.data.aiMode) return
    if (this.data.panel === panel) {
      // 首帧已展开（直达入口）
      if (panel === 'sticker' && !this._stickerAll) this.loadStickers()
      this.syncViewport()
      return
    }
    this.setLayer('edit')
    if (panel === 'sticker' && !this._stickerAll) this.loadStickers()
    // 底部工具区高度会随面板出现而变化（绘制视口 = 标题与工具区之间的剩余空间），
    // 等这一帧布局落定再打开面板，否则 syncViewport 量到的还是旧视口（口径同 consumeAiEntry）
    wx.nextTick(() => this.later(() => this.setPanel(panel), 80))
  },
})
