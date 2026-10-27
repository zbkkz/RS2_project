// pages/login/login.js
const { request, saveTokens } = require('../../utils/request')
const { getSafeTop } = require('../../utils/navbar')

// 漂浮物品配置：x/y/尺寸(rpx)、fx/fy 飞入起始偏移(rpx)、rot 飞入旋转、delay 飞入延迟、
// dur/sdelay 自由晃动周期与相位、dx/dy 拖动位移(px)、rebound 是否回弹中
const FLOAT_ITEMS = [
  { name: 'fox',        x: 20,  y: 70,   size: 250, fx: -460, fy: -160, rot: -30, delay: 0,   dur: 3.4, sdelay: -1.2 },
  { name: 'dress',      x: 460, y: 40,   size: 280, fx: 460,  fy: -240, rot: 25,  delay: 60,  dur: 4.0, sdelay: -2.0 },
  { name: 'robin',      x: 20,  y: 340,  size: 150, fx: -400, fy: -60,  rot: -20, delay: 120, dur: 3.0, sdelay: -0.5 },
  { name: 'succulent',  x: 300, y: 230,  size: 160, fx: -140, fy: -440, rot: 15,  delay: 180, dur: 3.6, sdelay: -2.8 },
  { name: 'mug',        x: 600, y: 390,  size: 135, fx: 420,  fy: -80,  rot: 20,  delay: 90,  dur: 3.2, sdelay: -1.6 },
  { name: 'butterfly',  x: 10,  y: 540,  size: 170, fx: -420, fy: 60,   rot: -25, delay: 150, dur: 2.8, sdelay: -0.9 },
  { name: 'skateboard', x: 560, y: 585,  size: 185, fx: 440,  fy: 40,   rot: 30,  delay: 210, dur: 3.5, sdelay: -3.1 },
  { name: 'swan',       x: 15,  y: 740,  size: 190, fx: -450, fy: 120,  rot: -15, delay: 110, dur: 3.8, sdelay: -2.2 },
  { name: 'jacket',     x: 290, y: 845,  size: 210, fx: -60,  fy: 460,  rot: 18,  delay: 240, dur: 4.2, sdelay: -1.4 },
  { name: 'monstera',   x: 25,  y: 1010, size: 200, fx: -430, fy: 220,  rot: -22, delay: 70,  dur: 3.3, sdelay: -0.3 },
  { name: 'sneakers',   x: 285, y: 1160, size: 220, fx: -30,  fy: 500,  rot: 12,  delay: 190, dur: 3.7, sdelay: -2.5 },
  { name: 'cone',       x: 580, y: 990,  size: 155, fx: 420,  fy: 180,  rot: 24,  delay: 140, dur: 3.1, sdelay: -1.0 },
]

// 校验规则（与后端一致）
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,19}$/
const PHONE_RE = /^1[3-9]\d{9}$/

// 卡片切换时序：弹出 380ms（加速下落），延迟 170ms 后下一张弹入 560ms（弹簧回弹）
const SWITCH_DELAY = 170
const SWITCH_SETTLE = 1100

// 登录成功转场时序：① 镜头飞行 500ms → ② 背景向四周扩展 720ms
// （扩展末尾 0.24s 叠化首页同款渐变，见 login.wxss .boom-veil）→ ③ reLaunch 首页
const FLY_MS = 500
const BOOM_MS = 720

Page({
  data: {
    // 登录表单
    username: '',
    password: '',
    // 注册表单
    regUsername: '',
    regNickname: '',
    regPassword: '',
    regPhone: '',
    // 忘记密码表单
    fpUsername: '',
    fpPassword: '',
    fpPassword2: '',
    // 状态
    loading: false,        // 登录按钮
    regLoading: false,     // 注册按钮
    fpLoading: false,      // 重置按钮
    switching: false,      // 卡片切换动画进行中（防连点）
    showForgot: false,     // 忘记密码弹层
    loginSlow: true,       // 登录卡片首屏缓慢入场（切换后关闭）
    loginCls: '',          // 登录卡片位移状态：'' | 'in' | 'out'
    regCls: '',            // 注册卡片位移状态：'' | 'in' | 'out'
    items: FLOAT_ITEMS,
    entered: false,        // 物品是否已飞入
    showTitle: false,      // Hi.cut 标题是否显现
    cubeCX: 0,             // 方块中心（px，onReady 测量，经 dataset 传给 drag.wxs）
    cubeCY: 0,
    cubeAmp: 0,            // 镜头注视幅度（px ≈ 9rpx）
    // 登录成功转场：镜头先飞向首页摄像头位 → 方块背景向四周扩展铺屏（覆盖登录页元素）
    leaving: false,        // 转场开始（原镜头隐去，克隆体起飞，其余 UI 保持原位）
    booming: false,        // 方块背景扩展铺屏中（层级提升，覆盖其他 UI）
    cubeScale: 16,         // 方块铺满全屏的放大倍数（按屏幕对角线计算）
    flyStart: null,        // 镜头克隆体起点 {x, y}（px，= 方块中心）
    flyTo: '',             // 镜头终点变换（translate+scale）；隔一帧写入 style，由 CSS transition 完成飞行
  },

  // 物品拖动、镜头注视跟随、弹簧回弹全部由 drag.wxs 在视图层处理（避免 setData 卡顿）

  onLoad() {
    // 下一帧触发飞入过渡动画（顺序：物品 → 标题 → 登录卡片）
    wx.nextTick(() => this.setData({ entered: true }))
    // 物品飞入完成后标题缓慢淡入
    this.later(() => this.setData({ showTitle: true }), 1400)
    // 标题出现后登录卡片从下方显现（首屏缓慢入场）
    this.later(() => this.setData({ loginCls: 'in' }), 2300)
  },

  onUnload() {
    // 本页延时回调很多（入场 1400/2300ms、卡片切换、登录成功后的跳转序列），
    // 页面销毁后它们仍会回来 setData —— 统一作废并清掉
    this._destroyed = true
    ;(this._timers || []).forEach((id) => clearTimeout(id))
    this._timers = []
  },

  /**
   * 登记一个延时回调：页面销毁后不再执行（并在销毁时统一清理）。
   * 飞屏跳转序列里最后那个 60ms 余量之后会 `wx.reLaunch`，页面若已销毁就不该再跳。
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

  onReady() {
    // 测量方块中心与注视幅度（px），经 dataset 传给 drag.wxs（Skyline 下 WXS 内测量不稳定）
    wx.createSelectorQuery()
      .in(this)
      .select('#cube')
      .boundingClientRect((rect) => {
        if (!rect || !rect.width) return
        this.setData({
          cubeCX: rect.left + rect.width / 2,
          cubeCY: rect.top + rect.height / 2,
          cubeAmp: 9 * (rect.width / 170), // 9rpx 折算 px（方块宽 170rpx）
        })
      })
      .exec()
  },

  // 空回调：用于弹层卡片 catchtap 阻止事件冒泡到遮罩（缺失会导致点卡片即关闭弹层）
  noop() {},

  // ==================== 输入绑定 ====================
  onAccountInput(e) { this.setData({ username: e.detail.value }) },
  onPwdInput(e) { this.setData({ password: e.detail.value }) },
  onRegAccountInput(e) { this.setData({ regUsername: e.detail.value }) },
  onRegNicknameInput(e) { this.setData({ regNickname: e.detail.value }) },
  onRegPwdInput(e) { this.setData({ regPassword: e.detail.value }) },
  onRegPhoneInput(e) { this.setData({ regPhone: e.detail.value }) },
  onFpAccountInput(e) { this.setData({ fpUsername: e.detail.value }) },
  onFpPwdInput(e) { this.setData({ fpPassword: e.detail.value }) },
  onFpPwd2Input(e) { this.setData({ fpPassword2: e.detail.value }) },

  // ==================== 卡片切换 ====================

  /** 登录卡片向下弹出 → 注册卡片向上弹入（果冻效果） */
  onShowRegister() {
    if (this.data.switching || this.data.loading) return
    this.setData({ switching: true, loginSlow: false, loginCls: 'out' })
    this.later(() => this.setData({ regCls: 'in' }), SWITCH_DELAY)
    this.later(() => this.setData({ switching: false }), SWITCH_SETTLE)
  },

  /** 注册卡片向下弹出 → 登录卡片向上弹回 */
  _backToLogin(extra = {}) {
    this.setData({ switching: true, regCls: 'out', ...extra })
    this.later(() => this.setData({ loginCls: 'in' }), SWITCH_DELAY)
    this.later(() => this.setData({ switching: false, regCls: '' }), SWITCH_SETTLE)
  },

  onBackToLogin() {
    if (this.data.switching || this.data.regLoading) return
    this._backToLogin()
  },

  // ==================== 登录 ====================
  onLogin() {
    const { username, password, loading } = this.data
    if (loading) return
    if (!USERNAME_RE.test(username.trim())) {
      wx.showToast({ title: '账号格式不正确', icon: 'none' })
      return
    }
    if (!password || password.length < 6) {
      wx.showToast({ title: '密码长度不能少于6位', icon: 'none' })
      return
    }

    this.setData({ loading: true })
    request({ url: '/api/auth/login', method: 'POST', data: { username: username.trim(), password }, auth: false })
      .then((res) => {
        // res.data 兜空对象：接口返回非统一结构时不抛英文 TypeError
        // （那会被下面的 catch 原样弹给用户，见 README 11.3 的三目/兜空口径）
        const d = res.data || {}
        saveTokens(d.access_token, d.refresh_token)
        this._playTransition()
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '登录失败', icon: 'none' })
      })
      .finally(() => this.setData({ loading: false }))
  },

  /**
   * 登录成功转场（登录页 → 首页共享元素过渡）：
   * ① 镜头克隆体从方块中心飞向首页「拍照/导入」摄像头圆心并放大变形
   *    （终点按首页已锁定布局精确推算：header 88rpx 固定，见 index.wxss .header）；
   * ② 镜头落位后，方块（镜头卡片）背景以中心为原点向四周扩展铺满全屏，登录页元素被覆盖而消失；
   * ③ 铺屏末尾 boom-veil 叠化出首页同款深紫渐变，随后 reLaunch 首页（from=login，各区块依次淡入接力）
   *
   * 飞行用 **CSS transition** 而不是 `this.animate` 关键帧：`ComponentInstance#animate`
   * 在部分环境未实现（WebView 渲染器 / 开发者工具会直接抛
   * `unimplemented: ComponentInstance#animate`），既污染控制台又让镜头干脆不飞。
   * 做法：克隆体挂载时就带起始 transform 与 transition，隔一帧再把终点 transform 写进 style；
   * 隔帧是必需的 —— Skyline 会把 wx:if 新节点的创建与紧随其后的 setData 批到同一帧，
   * 那样没有起始帧、transition 会被吞掉（表现为"闪"到终点）。
   */
  _playTransition() {
    if (this.data.leaving) return
    const info = wx.getWindowInfo()
    const ratio = info.windowWidth / 750
    // 首页顶部内边距（与 index.js 共用 getSafeTop，避开右上角胶囊按钮）
    const topPadding = getSafeTop()
    // 首页 hero-camera 圆心（index.wxss 布局已锁定）：
    // x = 28(页边距) + 30(卡片左 padding) + (336-60)/2(内容半宽) = 196rpx；
    // y = topPadding + header(88) + hero-grid margin(30) + hero-main padding(36) + camera margin(20) + camera 半径(89) = 263rpx
    // ⚠️ 原式里还有一段搜索栏(30+84)=114rpx —— 首页已删除搜索框（见 README M52），
    //    这里必须同步减 114，否则镜头会飞过头、落点偏下 114rpx
    const tx = 196 * ratio
    const ty = topPadding + 263 * ratio
    const x0 = this.data.cubeCX || info.windowWidth / 2
    const y0 = this.data.cubeCY || info.windowHeight * 0.3
    // 方块放大倍数：中心到最远角距离 / 半宽（85rpx）
    const dxMax = Math.max(x0, info.windowWidth - x0)
    const dyMax = Math.max(y0, info.windowHeight - y0)
    const cubeScale = Math.ceil(Math.sqrt(dxMax * dxMax + dyMax * dyMax) / (85 * ratio)) + 2

    // ① 镜头起飞（原镜头隐去，其余 UI 原位不动，等待被背景覆盖）：
    //    先只挂载克隆体（flyTo 为空 → 停在起点），隔一帧再写终点让 transition 生效
    this.setData({ leaving: true, cubeScale, flyStart: { x: x0, y: y0 }, flyTo: '' })
    // scale = 160/108 ≈ 1.4815，与首页 hero-eye 外径 160rpx 精确对应
    const to = `translate(${tx - x0}px, ${ty - y0}px) scale(1.4815)`
    wx.nextTick(() => {
      this.later(() => this.setData({ flyTo: to }), 32)
    })
    // ② 镜头落位后，方块背景向四周扩展铺屏
    this.later(() => this.setData({ booming: true }), FLY_MS)
    // ③ 铺屏 + 渐变叠化完成后跳转首页（入场动画接力）。
    // 走 later：页面已销毁时不再跳（否则会对一个正在离场的页面再发起一次 reLaunch）
    this.later(() => {
      wx.reLaunch({ url: '/pages/index/index?from=login' })
    }, FLY_MS + BOOM_MS + 60)
  },

  // ==================== 注册 ====================
  onRegister() {
    const { regUsername, regNickname, regPassword, regPhone, regLoading, switching } = this.data
    if (regLoading || switching) return
    const username = regUsername.trim()
    const nickname = regNickname.trim()
    const phone = regPhone.trim()

    if (!USERNAME_RE.test(username)) {
      wx.showToast({ title: '账号格式不正确', icon: 'none' })
      return
    }
    if (!nickname) {
      wx.showToast({ title: '请输入用户名', icon: 'none' })
      return
    }
    if (!regPassword || regPassword.length < 6) {
      wx.showToast({ title: '密码长度不能少于6位', icon: 'none' })
      return
    }
    if (phone && !PHONE_RE.test(phone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' })
      return
    }

    this.setData({ regLoading: true })
    request({
      url: '/api/auth/register',
      method: 'POST',
      data: { username, nickname, password: regPassword, phone: phone || undefined },
      auth: false,
    })
      .then(() => {
        wx.showToast({ title: '注册成功，请登录', icon: 'success' })
        // 注册卡片向下弹出、登录卡片向上弹回（账号已填入，清空注册表单）。
        // `regLoading` **留在这 700ms 之后再复位**：提前复位（原来的 .finally）会让成功后的
        // 这 700ms 内还能再点一次「注册」→ 第二次必然报「该账号已被注册」，看起来像网络出错
        this.later(() => {
          this._backToLogin({
            username,
            password: '',
            regUsername: '',
            regNickname: '',
            regPassword: '',
            regPhone: '',
          })
          this.setData({ regLoading: false })
        }, 700)
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '注册失败', icon: 'none' })
        this.setData({ regLoading: false }) // 失败路径立即复位，用户可改完再提交
      })
  },

  // ==================== 忘记密码 ====================
  onShowForgot() {
    this.setData({
      showForgot: true,
      fpUsername: this.data.username,
      fpPassword: '',
      fpPassword2: '',
    })
  },

  onCloseForgot() {
    if (this.data.fpLoading) return
    this.setData({ showForgot: false })
  },

  onConfirmReset() {
    const { fpUsername, fpPassword, fpPassword2, fpLoading } = this.data
    if (fpLoading) return
    const username = fpUsername.trim()

    if (!USERNAME_RE.test(username)) {
      wx.showToast({ title: '账号格式不正确', icon: 'none' })
      return
    }
    if (!fpPassword || fpPassword.length < 6) {
      wx.showToast({ title: '密码长度不能少于6位', icon: 'none' })
      return
    }
    if (fpPassword !== fpPassword2) {
      wx.showToast({ title: '两次输入的密码不一致', icon: 'none' })
      return
    }

    this.setData({ fpLoading: true })
    request({
      url: '/api/auth/reset-password',
      method: 'POST',
      data: { username, new_password: fpPassword },
      auth: false,
    })
      .then(() => {
        wx.showToast({ title: '重置成功，请登录', icon: 'success' })
        this.setData({ showForgot: false, username, password: '' })
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '重置失败', icon: 'none' })
      })
      .finally(() => this.setData({ fpLoading: false }))
  },

  // ==================== 协议 ====================
  onOpenAgreement(e) {
    const type = e.currentTarget.dataset.type === 'privacy' ? 'privacy' : 'user'
    wx.navigateTo({ url: `/pages/agreement/agreement?type=${type}` })
  },

  // ==================== 微信一键登录 ====================
  /** 微信一键登录：wx.login 获取 code → 后端换 openid 并签发 token */
  onWechatLogin() {
    if (this.data.loading) return
    this.setData({ loading: true })
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          wx.showToast({ title: '获取微信授权失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        request({
          url: '/api/auth/wechat',
          method: 'POST',
          data: { code: loginRes.code },
          auth: false,
        })
          .then((res) => {
            const d = res.data || {}
            saveTokens(d.access_token, d.refresh_token)
            this._playTransition()
          })
          .catch((err) => {
            wx.showToast({ title: err.message || '微信登录失败', icon: 'none' })
          })
          .finally(() => this.setData({ loading: false }))
      },
      fail: () => {
        wx.showToast({ title: '微信登录失败', icon: 'none' })
        this.setData({ loading: false })
      },
    })
  },
})
