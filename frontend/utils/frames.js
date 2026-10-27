// utils/frames.js — 相机页「相框」样式的**唯一定义与 canvas 绘制实现**
//
// 为什么把定义与绘制放在 utils：相机页的选择面板要画预览、编辑页要把相框落到画面里，
// 两处必须用同一份样式参数（口径同滤镜：`FILTER_GROUPS` 的 `value` 既是缩略图 CSS filter、
// 也是画布逐像素的输入），否则「预览一个样、结果另一个样」。
//
// 坐标系与自适应：`drawFrame(ctx, key, x, y, w, h)` 以图片（或预览框）的**左上角**为原点，
// 边框粗细 / 圆角半径 / 齿孔尺寸全部按 `min(w, h)` 等比换算 —— 任意长宽比下边框粗细都一致，
// 不会像「固定尺寸相框 PNG 拉伸铺满」那样被拉变形（横图左右框变粗、竖图上下框变粗）。
//
// 新增相框只需在 `FRAMES` 追加一项，并在 `drawFrame()` 里加一个分支；
// 相机页的选择面板按 4 列自动换行渲染，无需改动布局。

/** 全部相框样式（`none` 表示不套相框，供用户取消） */
const FRAMES = [
  { key: 'none', name: '无' },
  { key: 'white', name: '简约白' },
  { key: 'black', name: '经典黑' },
  { key: 'rounded', name: '圆角' },
  { key: 'dashed', name: '虚线' },
  { key: 'film', name: '胶片' },
  { key: 'corners', name: '四角' },
  { key: 'gold', name: '金边' },
]

const FRAME_MAP = {}
FRAMES.forEach((f) => {
  FRAME_MAP[f.key] = f
})

/** 规范化相框标识：非法值/空值一律回落 `none`（入口参数可能被手改） */
function normalizeFrame(key) {
  const k = String(key == null ? '' : key).trim()
  return FRAME_MAP[k] ? k : 'none'
}

/** 相框名称；非法值先按 `normalizeFrame` 规范化，因此未知标识会得到 `none` 的名字「无」 */
function frameNameOf(key) {
  return FRAME_MAP[normalizeFrame(key)].name
}

/** 是否为「真的套了相框」（`none` 与非法值都算没套） */
function hasFrame(key) {
  return normalizeFrame(key) !== 'none'
}

/** 圆角矩形路径（小程序 canvas 2d 不保证有 roundRect，用 arcTo 自己拼） */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

/**
 * 在 canvas 上绘制相框（原地绘制，调用方负责它在图层中的位置）。
 * @param {CanvasRenderingContext2D} ctx 画布上下文
 * @param {string} key 相框标识（非法值按 `none` 处理，即不绘制）
 * @param {number} x 目标区域左上角 x
 * @param {number} y 目标区域左上角 y
 * @param {number} w 目标区域宽
 * @param {number} h 目标区域高
 */
function drawFrame(ctx, key, x, y, w, h) {
  const id = normalizeFrame(key)
  if (id === 'none' || !ctx || !(w > 0) || !(h > 0)) return
  const k = Math.min(w, h) // 一切尺寸以「短边」为基准 → 任意长宽比粗细一致

  ctx.save()
  ctx.setLineDash([])

  if (id === 'white') {
    // 简约白：贴边的白色细框
    const lw = k * 0.055
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = lw
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
  } else if (id === 'black') {
    // 经典黑：黑色外框 + 紧贴内侧的白色细线
    const lw = k * 0.06
    const lw2 = k * 0.02
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = lw
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.lineWidth = lw2
    const inset = lw + lw2 / 2
    ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2)
  } else if (id === 'gold') {
    // 金边：琥珀色外框 + 内侧白色细线
    const lw = k * 0.05
    const lw2 = k * 0.015
    ctx.strokeStyle = '#e8b73a'
    ctx.lineWidth = lw
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.lineWidth = lw2
    const inset = lw + lw2 / 2
    ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2)
  } else if (id === 'rounded') {
    // 圆角白框
    const lw = k * 0.055
    const r = k * 0.1
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = lw
    roundRectPath(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, r)
    ctx.stroke()
  } else if (id === 'dashed') {
    // 虚线白框（裁剪框同款虚线观感）
    const lw = k * 0.04
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = lw
    ctx.setLineDash([k * 0.075, k * 0.05])
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
    ctx.setLineDash([])
  } else if (id === 'film') {
    // 胶片：上下黑条 + 等距白色齿孔
    const bar = h * 0.14
    ctx.fillStyle = '#111111'
    ctx.fillRect(x, y, w, bar)
    ctx.fillRect(x, y + h - bar, w, bar)

    const holeW = k * 0.05
    const holeH = k * 0.032
    const step = holeW + k * 0.085
    const count = Math.max(1, Math.floor((w - k * 0.085) / step))
    const startX = x + (w - (count * step - k * 0.085)) / 2
    const holeY = y + (bar - holeH) / 2
    const holeY2 = y + h - bar + (bar - holeH) / 2
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    for (let i = 0; i < count; i++) {
      const hx = startX + i * step
      roundRectPath(ctx, hx, holeY, holeW, holeH, holeH * 0.3)
      ctx.fill()
      roundRectPath(ctx, hx, holeY2, holeW, holeH, holeH * 0.3)
      ctx.fill()
    }
  } else if (id === 'corners') {
    // 四角：四个 L 形括号（与编辑页裁切框同一观感）
    const lw = k * 0.045
    const arm = k * 0.2
    const off = lw / 2
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = lw
    const corners = [
      [x + off, y + off, 1, 1],
      [x + w - off, y + off, -1, 1],
      [x + off, y + h - off, 1, -1],
      [x + w - off, y + h - off, -1, -1],
    ]
    ctx.beginPath()
    corners.forEach((c) => {
      ctx.moveTo(c[0] + c[2] * arm, c[1])
      ctx.lineTo(c[0], c[1])
      ctx.lineTo(c[0], c[1] + c[3] * arm)
    })
    ctx.stroke()
  }

  ctx.restore()
}

module.exports = {
  FRAMES,
  normalizeFrame,
  frameNameOf,
  hasFrame,
  drawFrame,
}
