// pages/camera/camera.js — 竖屏相机拍摄页（M9）
// 首页「拍照」进入；实时取景 → 拍摄/选图进入编辑页。Skyline 不支持 <camera> 原生组件，
// 本页在页面级配置 "renderer": "webview" 以保证相机预览可用。
//
// 拍摄/选图后进入编辑页时会带上 `frame` 参数（当前选中的相框，见 utils/frames.js），
// 由编辑页把相框绘制到画面最上层（M35）。
//
// ===== 闪光灯：开启态用 `flash="torch"`（常亮），不用 `on`（见 M53）=====
// `on`/`auto` 只在**按下快门的那一瞬间**由系统触发，预览画面不会有任何变化 ——
// 用户点开闪光灯却「看不出效果」，很容易判定为「功能无效」；更糟的是安卓部分机型上
// `on` 会「闪一下即关」，暗光下拍出的照片反而发黑（该问题为微信原生 camera 与系统
// 相机驱动层行为，业务代码无法根治）。`torch`（常亮，基础库 2.8.0+）则让 LED 在预览
// 期间持续点亮：**开没开一眼可见、拍照期间不会突然熄灭**，且动态切换在两端都可靠。
// 微信**没有** `setFlash` 这类运行时接口（CameraContext 只有 takePhoto/setZoom/录制等），
// `flash` 属性是唯一的控制面，故这里只保留「关（off）/ 开（torch）」两态。
const { getSafeTop } = require('../../utils/navbar')
const { FRAMES, normalizeFrame, frameNameOf } = require('../../utils/frames')
// 图标统一使用 SVG base64 data URI（与全站约定一致），白色实心/描边。
// 转换实现与编辑页共用 utils/icon.js 的唯一一份（原先两页各写一份，见该文件说明）
const { svgBase64: svg } = require('../../utils/icon')

const ICONS = {
  // 左上角白色 ×
  close: svg(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'><path d='M15 15 L33 33 M33 15 L15 33' stroke='#ffffff' stroke-width='6' stroke-linecap='round'/></svg>"
  ),
  // 闪光灯开启：琥珀色闪电（无斜杠）—— 与关闭态的「白色闪电 + 斜杠」一眼可辨
  flashOn: svg(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><path d='M25 4 L8 26 h13 l-4 18 19-26 H22 l3-14z' fill='#ffcd3c'/></svg>"
  ),
  // 闪光灯关闭：白色闪电 + 斜杠（斜杠加粗，44rpx 下也清晰可读）
  flashOff: svg(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><path d='M25 4 L8 26 h13 l-4 18 19-26 H22 l3-14z' fill='#ffffff'/><path d='M9 39 L39 11' stroke='#ffffff' stroke-width='6' stroke-linecap='round'/></svg>"
  ),
  // 相框入口：白色矩形环（fill-rule=evenodd 让内圈成为镂空，形成「画框」观感）
  frame: svg(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><path fill='#ffffff' fill-rule='evenodd' d='M8 8h32v32H8V8zm4.8 4.8v22.4h22.4V12.8H12.8z'/></svg>"
  ),
  // 相册：白色线框
  album: svg(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'><rect x='4' y='6' width='40' height='36' rx='9' stroke='#ffffff' stroke-width='4'/><path d='M10 34 l9-8 6 5 8-7 5 5' stroke='#ffffff' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/><circle cx='33' cy='15' r='3.6' fill='#ffffff'/></svg>"
  ),
  // 前后摄像头翻转：白色环形箭头
  flip: svg(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'><path d='M24 8 A 16 16 0 1 1 8 24' stroke='#ffffff' stroke-width='4.5' stroke-linecap='round'/><path d='M22.5 1.5 L29.5 8 L15.5 8 Z' fill='#ffffff'/></svg>"
  ),
}

Page({
  data: {
    topPadding: 20, // 状态栏安全内边距（px）
    ICONS,
    zoom: 1, // 变焦倍率（camera zoom 属性，1=不放大）；点中哪个数字就在哪个数字后加 ×
    zoomList: [1, 2, 3],
    flash: 'off', // off / torch（camera flash 取值；开启态用 torch 常亮，理由见文件头 M53 说明）
    devicePosition: 'back', // back / front
    // ===== 相框（原「特效」入口改造）=====
    frames: FRAMES, // 可选相框（定义与绘制在 utils/frames.js，编辑页共用同一份）
    frameKey: 'none', // 当前相框；none = 不套相框
    frameLabel: '相框', // 入口文案：未选时为「相框」，选中后显示相框名（如「胶片」）
    frameShow: false, // 相框选择面板（底部弹层）开关
    vfK: 300, // 取景相框叠加层的比例基准（= 取景区短边，rpx）；onReady 量取后写入
  },

  onLoad() {
    this.setData({ topPadding: getSafeTop(0) })
  },

  onReady() {
    // 量取取景区短边作为相框叠加层的 `--k`：装饰粗细按它等比换算，
    // 取景里看到的边框比例才与最终成片一致（见 camera.wxss 的 .frame-deco）
    this.updateFrameK()
  },

  onUnload() {
    // 取景比例的重试定时器必须清掉：定时器不受页面生命周期约束，
    // 页面销毁后它仍会回来调 updateFrameK → setData（开发者工具会报 setData after unload）
    this._destroyed = true
    if (this._kTimer) {
      clearTimeout(this._kTimer)
      this._kTimer = null
    }
  },

  /**
   * 量取取景区短边 → `vfK`（rpx），作为取景相框叠加层的 `--k`。
   * 首帧布局未稳时量到 0，此时按项目统一做法重试（否则叠加层会一直用兜底厚度，
   * 取景里的边框会比成片细）。
   */
  updateFrameK(retry = 0) {
    this.createSelectorQuery()
      .select('.preview-wrap')
      .boundingClientRect((rect) => {
        if (this._destroyed) return
        if (!rect || !rect.width || !rect.height) {
          if (retry < 10) {
            // 只保留一个在途重试定时器（句柄存下来供 onUnload 清理）
            this._kTimer = setTimeout(() => {
              this._kTimer = null
              this.updateFrameK(retry + 1)
            }, 50)
          }
          return
        }
        const winW = (wx.getWindowInfo && wx.getWindowInfo().windowWidth) || 375
        // px → rpx：750rpx = 屏宽
        this.setData({ vfK: Math.round((Math.min(rect.width, rect.height) * 750) / winW) })
      })
      .exec()
  },

  /**
   * camera 初始化完成：缓存相机上下文与当前机型最大倍率。
   * 安卓端仅靠 zoom 属性不生效，必须调用 cameraContext.setZoom 才能真正变焦，
   * 因此在初始化完成后把当前选中倍率再应用一次（若之前已点选）。
   */
  onCameraInit(e) {
    this._cameraCtx = wx.createCameraContext()
    this._maxZoom = (e.detail && e.detail.maxZoom) || 0
    if (this.data.zoom > 1) {
      this._applyZoom(this.data.zoom)
    }
  },

  /** 通过 cameraContext.setZoom 应用倍率（成功后 zoom 属性同步）。 */
  _applyZoom(z) {
    const ctx = this._cameraCtx || (this._cameraCtx = wx.createCameraContext())
    ctx.setZoom({
      zoom: z,
      fail: () => {
        // 部分安卓机型（如华为/小米个别固件）不支持目标倍率，回退 1× 并提示
        if (z > 1) {
          this.setData({ zoom: 1 })
          wx.showToast({ title: '当前设备暂不支持该倍率', icon: 'none' })
        }
      },
    })
  },

  /** 左上角 ×：返回上一页 */
  onClose() {
    wx.navigateBack({ delta: 1 })
  },

  /**
   * 右上角闪光灯开关：关闭态点一下 → 打开（`torch` 常亮），再点一下 → 关闭。
   *
   * · 开启态取 `torch` 而不是 `on`：`on` 只在快门瞬间由系统触发、预览毫无反馈，
   *   用户会判定为「无效」；安卓部分机型还会「闪一下即关」把暗光照片拍黑（见文件头 M53）。
   *   `torch` 让 LED 在预览期间持续点亮 —— 开没开一眼可见，且动态切换在两端都可靠；
   * · 两态视觉：**关** = 白色闪电 + 斜杠、圆钮为纯黑描边；**开** = 琥珀色闪电且圆钮点成琥珀色
   *   （描边 + 半透明底色 + 微光），缩略图尺寸下也能一眼分辨；
   * · 前置摄像头不支持闪光灯：此时只提示、不切换状态，避免「显示已开但实际不生效」。
   */
  onToggleFlash() {
    if (this.data.devicePosition === 'front') {
      wx.showToast({ title: '前置摄像头不支持闪光灯', icon: 'none' })
      return
    }
    this.setData({ flash: this.data.flash === 'off' ? 'torch' : 'off' })
  },

  /**
   * 变焦：1×/2×/3×。逻辑：
   * 1. 同步 UI 显示（点中哪个数字哪个加 ×，默认 1×）；
   * 2. 通过 cameraContext.setZoom 触发真实变焦（安卓必走此路，zoom 属性仅作 iOS/初始兜底）。
   */
  setZoom(e) {
    const z = Number(e.currentTarget.dataset.z) || 1
    if (z === this.data.zoom) return
    if (this._maxZoom && z > this._maxZoom) {
      wx.showToast({ title: '当前设备最大倍率 ' + this._maxZoom + '×', icon: 'none' })
      return
    }
    this.setData({ zoom: z })
    if (this._cameraCtx) {
      this._applyZoom(z)
    }
  },

  // ===== 相框（原「特效」入口改造）=====

  /** 打开相框选择面板 */
  onOpenFrames() {
    this.setData({ frameShow: true })
  },

  onCloseFrames() {
    this.setData({ frameShow: false })
  },

  /** 面板空白区域的 catchtap 空回调：阻止点击冒泡到遮罩（否则点卡片即关闭面板） */
  noop() {},

  /**
   * 选中相框：写入 frameKey 并同步入口文案。
   * 这里只负责「选」；真正把相框落到画面上由编辑页完成（拍摄/选图时随 imagePath 一起传参）。
   */
  onPickFrame(e) {
    const key = normalizeFrame(e.currentTarget.dataset.key)
    this.setData({
      frameKey: key,
      frameLabel: key === 'none' ? '相框' : frameNameOf(key),
    })
  },

  /** 相册：选图 → 编辑页 */
  onAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (path) this.goEditor(path)
      },
    })
  },

  /** 快门：拍摄 → 编辑页 */
  onShutter() {
    if (this._snapping) return
    this._snapping = true
    const ctx = wx.createCameraContext()
    ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        this._snapping = false
        if (res.tempImagePath) this.goEditor(res.tempImagePath)
      },
      fail: () => {
        this._snapping = false
        wx.showToast({ title: '拍摄失败，请重试', icon: 'none' })
      },
    })
  },

  /** 进入编辑页：携带拍摄时刻与当前相框（frame 取值见 utils/frames.js） */
  goEditor(path) {
    wx.navigateTo({
      url: `/pages/editor/editor?imagePath=${encodeURIComponent(path)}` +
        `&captureTime=${Date.now()}&frame=${this.data.frameKey}`,
    })
  },

  /**
   * 前后摄像头 翻转。
   * 切到前置时闪光灯一并熄灭（前置没有闪光灯硬件，留着「已开启」的琥珀色状态会误导用户），
   * 切回后置不会自动恢复，保持用户显式选择的状态。
   */
  onFlip() {
    const devicePosition = this.data.devicePosition === 'back' ? 'front' : 'back'
    const patch = { devicePosition }
    if (devicePosition === 'front' && this.data.flash !== 'off') {
      patch.flash = 'off'
      wx.showToast({ title: '前置摄像头不支持闪光灯，已关闭', icon: 'none' })
    }
    this.setData(patch)
  },
})