// components/angle-ruler/angle-ruler.js
// 圆弧角度标尺（圆形滚动刻度盘）—— 纯 canvas 手绘，不依赖任何第三方库。
//
// 设计：
//   · 一段「向下凹」的圆弧刻度：圆心位于画布上方，圆弧最低点落在画布中线上，
//     因此越靠两侧刻度越高，形成向下凹的弧形；刻度垂直于圆弧、朝圆心方向（即朝上）；
//   · 每 1° 一根短刻度、每 5° 一根长刻度（长刻度更亮更粗）；
//   · 黄色游标竖线固定在圆弧最低点（= 画布中线），**游标不动，拖动时整个刻度盘滚动**；
//   · 手指在画布上横向拖动 → 刻度盘跟手滚动 → 游标处「读」出的角度变化，
//     角度被限制在 [min, max]（默认 -45° ~ +45°）；
//   · 角度变化通过 changing（拖动中，实时）/ change（松手）事件抛出，外部据此实时旋转图片。
//
// 手感：把刻度盘当成一条可推动的尺子（内容跟着手指走）。
// 向右拖动 dx（px）→ 刻度盘右移 → 游标读到更小的角度：Δ角度 = -dx / 每度弧长。

const DEG = Math.PI / 180

Component({
  options: {
    // 组件内部结构与样式不外泄；宿主节点仍可由父级 class 控制尺寸
    styleIsolation: 'isolated',
  },

  properties: {
    /** 当前角度（度）。外部可写：变化时重绘并对齐刻度 */
    value: { type: Number, value: 0, observer: 'onValueChange' },
    /** 可滚动角度范围（度） */
    min: { type: Number, value: -45 },
    max: { type: Number, value: 45 },
    /** 圆弧半径（rpx）：越大弧越平缓、单位角度对应的刻度间距越小 */
    radius: { type: Number, value: 900 },
    /** 短刻度（1°）/ 长刻度（5°）/ 游标 的长度（rpx） */
    minorLen: { type: Number, value: 10 },
    majorLen: { type: Number, value: 20 },
    cursorLen: { type: Number, value: 30 },
    /** 圆弧最低点距画布底边的距离（rpx） */
    bottomGap: { type: Number, value: 8 },
    /** 是否在游标上方绘制白色圆点（当前角度标记） */
    showDot: { type: Boolean, value: true },
    /** 是否禁用拖动 */
    disabled: { type: Boolean, value: false },
  },

  data: {},

  lifetimes: {
    ready() {
      this.initCanvas()
    },
    detached() {
      // 释放引用，避免页面销毁后仍被持有；同时作废可能仍挂着的重试定时器
      // （否则组件销毁后回调仍会重建 _ctx 并继续 draw()）
      this._destroyed = true
      if (this._arTimer) {
        clearTimeout(this._arTimer)
        this._arTimer = null
      }
      this._ctx = null
      this._drag = null
    },
  },

  methods: {
    /* ==================== 初始化与绘制 ==================== */

    /** 取 canvas 节点并按 dpr 建立缓冲区；首帧布局未稳时重试（组件销毁后立即停止） */
    initCanvas(retry = 0) {
      if (this._destroyed) return
      this.createSelectorQuery()
        .select('#arCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (this._destroyed) return
          const info = res && res[0]
          if (!info || !info.node || !info.width || !info.height) {
            if (retry < 10) this._arTimer = setTimeout(() => this.initCanvas(retry + 1), 50)
            return
          }
          const win = wx.getWindowInfo()
          const dpr = win.pixelRatio || 1
          const canvas = info.node
          this._w = info.width
          this._h = info.height
          // 1rpx 对应的 CSS px（750rpx = 屏宽）
          this._rpx = (win.windowWidth || 375) / 750

          canvas.width = Math.max(1, Math.round(info.width * dpr))
          canvas.height = Math.max(1, Math.round(info.height * dpr))
          const ctx = canvas.getContext('2d')
          // 后续统一用 CSS px 作图：整体缩放 dpr
          // （设置 canvas.width/height 会重置变换，故必须在其之后调用 scale）
          ctx.scale(dpr, dpr)
          this._ctx = ctx

          this._angle = this.clamp(this.data.value)
          this.draw()
        })
    },

    /** 角度取整到 0.1° 并夹在 [min, max] 内 */
    clamp(v) {
      const n = Number(v) || 0
      const { min, max } = this.data
      return Math.min(max, Math.max(min, Math.round(n * 10) / 10))
    },

    /** 外部写入 value：与内部角度一致时直接忽略，避免回写触发重绘（拖动时尤为重要） */
    onValueChange(nv) {
      const v = this.clamp(nv)
      if (this._angle === undefined) {
        this._angle = v
        return
      }
      if (Math.abs(v - this._angle) < 0.05) return
      this._angle = v
      this.draw()
    },

    /** 绘制整盘：圆弧刻度 + 固定游标 + 游标上方白点 */
    draw() {
      const ctx = this._ctx
      if (!ctx) return
      const W = this._w
      const H = this._h
      const r = Math.max(1, this.data.radius * this._rpx) // 弧半径（CSS px）
      const cx = W / 2
      const baseY = H - this.data.bottomGap * this._rpx // 圆弧最低点 = 游标所在处
      const cy = baseY - r // 圆心在画布上方 → 圆弧向下凹

      ctx.clearRect(0, 0, W, H)

      // 画布左右边缘对应的角度偏移；只绘制可见区间，且不超出 [min, max]
      const half = Math.asin(Math.min(1, W / 2 / r)) / DEG
      const from = Math.max(this.data.min, this._angle - half)
      const to = Math.min(this.data.max, this._angle + half)

      // 先短后长：同类刻度合并为一条路径，减少 stroke 次数
      this.strokeTicks(from, to, r, cx, cy, false, this.data.minorLen * this._rpx)
      this.strokeTicks(from, to, r, cx, cy, true, this.data.majorLen * this._rpx)

      // 游标：固定在圆弧中点（画布中线）的黄色竖线
      const cursorLen = this.data.cursorLen * this._rpx
      ctx.beginPath()
      ctx.moveTo(cx, baseY)
      ctx.lineTo(cx, baseY - cursorLen)
      ctx.strokeStyle = '#ffcd3c'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.stroke()

      // 游标上方的白色圆点（当前角度标记）
      if (this.data.showDot) {
        const dotR = 5 * this._rpx
        ctx.beginPath()
        ctx.arc(cx, baseY - cursorLen - 10 * this._rpx - dotR, dotR, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }
    },

    /**
     * 批量描边某一类刻度（5° 长刻度与其它 1° 短刻度分成两次调用）。
     * @param {number} from 可见起始角（度，可含小数）
     * @param {number} to 可见结束角（度）
     * @param {number} r 弧半径（CSS px）
     * @param {number} cx 圆心 x（CSS px）
     * @param {number} cy 圆心 y（CSS px）
     * @param {boolean} major true=画 5° 长刻度；false=画 1° 短刻度
     * @param {number} len 刻度长度（CSS px）
     */
    strokeTicks(from, to, r, cx, cy, major, len) {
      const ctx = this._ctx
      let has = false
      ctx.beginPath()
      for (let a = Math.ceil(from); a <= to; a++) {
        // 5 的倍数归长刻度，其余归短刻度（负数取模同样成立：-5 % 5 === -0）
        if ((a % 5 === 0) !== major) continue
        const phi = (a - this._angle) * DEG
        const sin = Math.sin(phi)
        const cos = Math.cos(phi)
        const x = cx + r * sin
        const y = cy + r * cos
        // 刻度垂直于圆弧、指向圆心：方向向量为 (-sinφ, -cosφ)
        ctx.moveTo(x, y)
        ctx.lineTo(x - sin * len, y - cos * len)
        has = true
      }
      if (!has) return
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.40)'
      ctx.lineWidth = major ? 1.6 : 1
      ctx.lineCap = 'round'
      ctx.stroke()
    },

    /* ==================== 拖动交互 ==================== */

    onTouchStart(e) {
      if (this.data.disabled || !this._ctx) return
      const t = e.touches && e.touches[0]
      if (!t) return
      // 只记录起手位置与起始角度，后续按位移增量换算，避免累计误差
      this._drag = { x: t.clientX, angle: this._angle }
    },

    onTouchMove(e) {
      const drag = this._drag
      if (!drag) return
      const t = e.touches && e.touches[0]
      if (!t) return
      // 每度对应的弧长（CSS px）：R·π/180。小角度下弧长 ≈ 水平位移，误差 < 5%
      const perDeg = Math.max(1, this.data.radius * this._rpx * DEG)
      // 刻度盘跟手：向右拖动 → 内容右移 → 游标读到更小的角度
      const angle = this.clamp(drag.angle - (t.clientX - drag.x) / perDeg)
      if (angle === this._angle) return
      this._angle = angle
      this.draw()
      // 实时抛出，外部据此旋转图片预览
      this.triggerEvent('changing', { angle })
    },

    onTouchEnd() {
      if (!this._drag) return
      this._drag = null
      this.triggerEvent('change', { angle: this._angle })
    },
  },
})
