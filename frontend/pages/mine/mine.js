// pages/mine/mine.js — 个人页：资料展示/编辑、作品统计、菜单、退出登录
const { request, clearToken, getToken, absoluteUrl } = require('../../utils/request')
const { getSafeTop, getTabBarHeight } = require('../../utils/navbar')

// SVG 图标（base64 data URI）
const ICON = {
  user: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTEyIDEyYzIuMjEgMCA0LTEuNzkgNC00cy0xLjc5LTQtNC00LTQgMS43OS00IDQgMS43OSA0IDQgNHptMCAyYy0yLjY3IDAtOCAxLjM0LTggNHYyaDE2di0yYzAtMi42Ni01LjMzLTQtOC00eiIvPjwvc3ZnPg==',
  pencil: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzhiNWNmNiIgZD0iTTMgMTcuMjVWMjFoMy43NUwxNy44MSA5Ljk0bC0zLjc1LTMuNzVMMyAxNy4yNXpNMjAuNzEgNy4wNGMuMzktLjM5LjM5LTEuMDIgMC0xLjQxbC0yLjM0LTIuMzRjLS4zOS0uMzktMS4wMi0uMzktMS40MSAwbC0xLjgzIDEuODMgMy43NSAzLjc1IDEuODMtMS44M3oiLz48L3N2Zz4=',
  chevron: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2I5YThkNCIgZD0iTTEwIDZMOC41OSA3LjQxIDEzLjE3IDEybC00LjU4IDQuNTlMMTAgMThsNi02eiIvPjwvc3ZnPg==',
  works: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzNiODJmNiIgZD0iTTIxIDE5VjVjMC0xLjEtLjktMi0yLTJINWMtMS4xIDAtMiAuOS0yIDJ2MTRjMCAxLjEuOSAyIDIgMmgxNGMxLjEgMCAyLS45IDItMnpNOC41IDEzLjVsMi41IDMuMDFMMTQuNSAxMmw0LjUgNkg1bDMuNS00LjV6Ii8+PC9zdmc+',
  doc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzhiNWNmNiIgZD0iTTE0IDJINmMtMS4xIDAtMS45OS45LTEuOTkgMkw0IDIwYzAgMS4xLjg5IDIgMS45OSAySDE4YzEuMSAwIDItLjkgMi0yVjhsLTYtNnptMiAxNkg4di0yaDh2MnptMC00SDh2LTJoOHYyem0tMy01VjMuNUwxOC41IDlIMTN6Ii8+PC9zdmc+',
  shield: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzIyYzU1ZSIgZD0iTTEyIDFMMyA1djZjMCA1LjU1IDMuODQgMTAuNzQgOSAxMiA1LjE2LTEuMjYgOS02LjQ1IDktMTJWNWwtOS00eiIvPjwvc3ZnPg==',
  info: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2Y1OWUwYiIgZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTEgMTVoLTJ2LTZoMnY2em0wLThoLTJWN2gydjJ6Ii8+PC9zdmc+',
  logout: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2VmNDQ0NCIgZD0iTTE3IDdsLTEuNDEgMS40MUwxOC4xNyAxMUg4djJoMTAuMTdsLTIuNTggMi41OEwxNyAxN2w1LTV6TTQgNWg4VjNINGMtMS4xIDAtMiAuOS0yIDJ2MTRjMCAxLjEuOSAyIDIgMmg4di0ySDRWNXoiLz48L3N2Zz4=',
  camera: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTEyIDE1LjJjMS43NyAwIDMuMi0xLjQzIDMuMi0zLjJzLTEuNDMtMy4yLTMuMi0zLjItMy4yIDEuNDMtMy4yIDMuMiAxLjQzIDMuMiAzLjIgMy4yek05IDJMNy4xNyA0SDRjLTEuMSAwLTIgLjktMiAydjEyYzAgMS4xLjkgMiAyIDJoMTZjMS4xIDAgMi0uOSAyLTJWNmMwLTEuMS0uOS0yLTItMmgtMy4xN0wxNSAySDl6bTMgMTVjLTIuNzYgMC01LTIuMjQtNS01czIuMjQtNSA1LTUgNSAyLjI0IDUgNS0yLjI0IDUtNSA1eiIvPjwvc3ZnPg==',
}

/** 头像显示地址：交给 absoluteUrl 统一补全（http 开头直接用、空值返回 ''） */
function fullAvatar(avatar) {
  return absoluteUrl(avatar)
}

/** 加入天数：由 created_at（"YYYY-MM-DD HH:mm:ss"）计算，最小 1 天 */
function calcJoinDays(createdAt) {
  if (!createdAt) return 1
  const t = new Date(createdAt.replace(' ', 'T')).getTime()
  if (isNaN(t)) return 1
  return Math.max(1, Math.floor((Date.now() - t) / 86400000) + 1)
}

// 额度卡里的三个「对话类」用途：接口键名 → 展示文案（顺序即展示顺序）。
// 语音识别与 AI 对话**共用同一个上限值**（同一份 chat_daily_limit()），界面上要注明。
const USAGE_META = [
  { key: 'chat', name: 'AI 对话' },
  { key: 'chat_edit', name: '对话内出图' },
  { key: 'asr', name: '语音识别' },
]

Page({
  data: {
    topPadding: 20,
    tabBarHeight: 90,     // 底部导航占位高度（px）：onLoad 算出，做 .page-root 的 padding-bottom
    icons: ICON,
    profile: null,        // 用户信息
    avatarUrl: '',        // 头像显示地址（空 → 默认图标）
    registerDate: '',     // 注册于 YYYY-MM-DD
    worksCount: 0,
    joinDays: 1,
    // 编辑资料弹层
    showEdit: false,
    editNickname: '',
    editAvatarPreview: '', // 弹层内头像预览（本地路径或完整地址）
    editAvatarPath: '',    // 上传成功后得到的相对路径（未改头像为 ''）
    saving: false,
    // 关于弹层
    showAbout: false,
    // 今日 AI 额度（GET /api/ai/quota，只读）
    quotaLoaded: false,   // 是否已得到一次结果（含失败）
    quotaError: '',       // 非空 = 加载失败原因
    quotaTotal: { used: 0, limit: 0, remaining: 0, percent: 0 }, // 全部 AI 用途的汇总（页面展示 percent 剩余占比 + 进度条）
    quotaAbilities: [],   // 6 个图像能力的 {ability,name,used,limit,remaining}（对应接口 data.abilities）
    quotaUsages: [],      // 对话 / 对话内出图 / 语音三行（对应接口 data.chat / chat_edit / asr）
    quotaLevel: 'high',   // 剩余占比档位：high / mid / low（决定进度条配色）
  },

  onLoad() {
    // 存活标记：onShow 连发的三个请求可能在切页（redirectTo 会 unload）之后才回来，
    // 晚到的响应会 setData 到已销毁页面（口径同 template.js 的 _alive）
    this._alive = true
    // tabBarHeight = 底部导航占位高度（px），做 .page-root 的 padding-bottom
    this.setData({ topPadding: getSafeTop(), tabBarHeight: getTabBarHeight() })
  },

  onUnload() {
    this._alive = false
  },

  onShow() {
    this.loadProfile()
    this.loadWorksCount()
    this.loadQuota()
  },

  /**
   * 今日 AI 额度（只读接口，不消耗次数）。
   *
   * 展示三层（见 README 13 章个人页 / M57 / 16.6.4 位置 B）：
   * ① **整体**：`data.total.percent` 剩余占比 + 进度条（汇总口径由服务端算，前端不自己求和）；
   * ② **6 个图像能力**：逐项「剩余 / 上限」，能力名直接用接口返回的 `name`（不自己映射中英）；
   * ③ **三个对话用途**：AI 对话 / 对话内出图 / 语音识别（语音与对话共用同一个上限值）。
   * 失败时落下可读占位而不是空白（口径同首页「最近作品」的失败处理）。
   */
  loadQuota() {
    if (this._quotaReq) return // 在途去重（口径同 loadProfile / loadWorksCount）
    this._quotaReq = true
    const EMPTY = { used: 0, limit: 0, remaining: 0, percent: 0 }
    const num = (v) => Number(v) || 0
    request({ url: '/api/ai/quota' })
      .then((res) => {
        if (!this._alive) return
        const d = res.data || {}
        const total = d.total || EMPTY
        // 能力清单由接口按 ABILITY_SPECS 生成（新增能力自动出现），这里只做字段兜底
        const quotaAbilities = (d.abilities || []).map((x) => ({
          ability: x.ability,
          name: x.name || x.ability,
          used: num(x.used),
          limit: num(x.limit),
          remaining: num(x.remaining),
        }))
        // 三行用途：顺序与文案固定；asr 与 chat 共用同一上限（接口已按此返回，界面注明）
        const quotaUsages = USAGE_META.map((m) => {
          const v = d[m.key] || EMPTY
          return {
            key: m.key,
            name: m.name,
            used: num(v.used),
            limit: num(v.limit),
            remaining: num(v.remaining),
          }
        })
        this.setData({
          quotaTotal: { used: num(total.used), limit: num(total.limit), remaining: num(total.remaining), percent: num(total.percent) },
          quotaAbilities,
          quotaUsages,
          // 进度条填充表示"剩余"：越少越危险，配色随剩余占比下移
          quotaLevel: num(total.percent) >= 50 ? 'high' : (num(total.percent) >= 20 ? 'mid' : 'low'),
          quotaLoaded: true,
          quotaError: '',
        })
      })
      .catch((err) => {
        if (!this._alive) return
        this.setData({
          quotaLoaded: true,
          quotaError: (err && err.message) || '额度加载失败',
        })
      })
      .finally(() => {
        this._quotaReq = false
      })
  },

  /** 用户资料（onShow 会频繁触发：请求在途时跳过，避免请求叠加与过期响应回填） */
  loadProfile() {
    if (this._profileReq) return
    this._profileReq = true
    request({ url: '/api/auth/profile' })
      .then((res) => {
        if (!this._alive) return
        const profile = res.data || {}
        this.setData({
          profile,
          avatarUrl: fullAvatar(profile.avatar),
          registerDate: (profile.created_at || '').slice(0, 10),
          joinDays: calcJoinDays(profile.created_at),
        })
      })
      .catch(() => {})
      .finally(() => {
        this._profileReq = false
      })
  },

  /** 作品总数（读分页 total） */
  loadWorksCount() {
    if (this._worksCountReq) return
    this._worksCountReq = true
    request({ url: '/api/works?page=1&size=1' })
      // res.data 兜空对象：接口返回非统一结构时不该抛 TypeError，
      // 那会被下面的空 catch 吞掉、把「作品数量」永久显示成 0（看起来像作品丢了）
      .then((res) => {
        if (!this._alive) return
        this.setData({ worksCount: ((res.data || {}).total) || 0 })
      })
      .catch(() => {})
      .finally(() => {
        this._worksCountReq = false
      })
  },

  noop() {},

  /* ===== 编辑资料弹层 ===== */
  onOpenEdit() {
    const { profile, avatarUrl } = this.data
    this.setData({
      showEdit: true,
      editNickname: (profile && profile.nickname) || '',
      editAvatarPreview: avatarUrl,
      editAvatarPath: '',
    })
  },
  onCloseEdit() {
    if (this.data.saving) return
    this.setData({ showEdit: false })
  },
  onNicknameInput(e) {
    this.setData({ editNickname: e.detail.value })
  },

  /** 换头像：选图 → 上传 → 暂存相对路径并即时预览 */
  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        wx.showLoading({ title: '上传中', mask: true })
        wx.uploadFile({
          url: absoluteUrl('/api/upload'),
          filePath: path,
          name: 'file',
          header: { Authorization: `Bearer ${getToken()}` },
          success: (r) => {
            let body = {}
            try { body = JSON.parse(r.data || '{}') } catch (e) { /* ignore */ }
            // loading 与 toast 共用同一浮层：必须先把 loading 收掉再弹 toast，
            // 否则（放在 complete 里）hideLoading 会把刚弹出的 toast 一起关掉
            wx.hideLoading()
            // 除 code 外还要判 data.url：body.data 存在但缺 url 时会写入 undefined，
            // 于是头像预览变成空白、保存时又因为「没有新头像」而静默沿用旧图
            if (r.statusCode === 200 && body.code === 0 && body.data && body.data.url) {
              this.setData({
                editAvatarPath: body.data.url,
                editAvatarPreview: absoluteUrl(body.data.url),
              })
            } else {
              wx.showToast({ title: body.msg || '上传失败', icon: 'none' })
            }
          },
          fail: () => {
            wx.hideLoading()
            wx.showToast({ title: '网络异常', icon: 'none' })
          },
        })
      },
    })
  },

  /** 保存资料 */
  onSaveProfile() {
    // 在途守卫要放在最前：放在昵称校验之后时，连点两次会先弹「昵称不能为空」
    // （第一次保存成功后弹层关闭、输入框已清空，第二次点击先撞的是校验分支）
    if (this.data.saving) return
    const nickname = (this.data.editNickname || '').trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    const data = { nickname }
    if (this.data.editAvatarPath) data.avatar = this.data.editAvatarPath
    request({ url: '/api/auth/profile', method: 'PUT', data })
      .then((res) => {
        const profile = res.data || {}
        this.setData({
          profile,
          avatarUrl: fullAvatar(profile.avatar),
          showEdit: false,
          saving: false,
        })
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch((err) => {
        this.setData({ saving: false })
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      })
  },

  /* ===== 菜单 ===== */
  goWorks() {
    wx.navigateTo({ url: '/pages/works/works' })
  },
  goAgreement(e) {
    const { type } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/agreement/agreement?type=${type}` })
  },
  onOpenAbout() {
    this.setData({ showAbout: true })
  },
  onCloseAbout() {
    this.setData({ showAbout: false })
  },

  /* ===== 退出登录 ===== */
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) {
          clearToken()
          wx.reLaunch({ url: '/pages/login/login' })
        }
      },
    })
  },
})
