// pages/chat/chat.js — 「AI 智能处理」对话页（首页「聊天 ›」进入，见 README 7.4 / 13 章）
//
// 三个必须知道的约定：
// 1) **意图与修图指令全部由服务端决定**：本页只上传「文字 + 图片路径」，绝不传 prompt / ability /
//    model 之类的字段（传了也会被服务端忽略）；改修图能力请改后端 services/chat.py。
// 2) **出图是长耗时请求**：同步等待上限 `SEND_TIMEOUT`(300s) 与服务端预算
//    （生成 240s + 结果图下载 30s）成对取值（见 README 7.x「耗时预算」）；
//    等的时候用页内「思考中」气泡提示，不用 wx.showLoading（mask 会吃掉整页点击）。
// 3) **Skyline 约束**：页面级滚动不生效，消息列表必须由 <scroll-view type="list"> 承载，
//    根节点 flex 定高（见 README 11.3 第 29 条）。
const { request, absoluteUrl, getToken } = require('../../utils/request')
const { getSafeTop } = require('../../utils/navbar')

// 图标：SVG base64（与首页同一套做法 —— Skyline 下 <image> 能正常渲染 data URI）
const ICON = {
  back: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nI2ZmZmZmZicgZD0nTTE1LjQxIDcuNDEgMTQgNmwtNiA2IDYgNiAxLjQxLTEuNDFMMTAuODMgMTJ6Jy8+PC9zdmc+',
  newChat: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nI2ZmZmZmZicgZD0nTTEzIDdoLTJ2NEg3djJoNHY0aDJ2LTRoNHYtMmgtNFY3em0tMS01QzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQxIDAtOC0zLjU5LTgtOHMzLjU5LTggOC04IDggMy41OSA4IDgtMy41OSA4LTggOHonLz48L3N2Zz4=',
  image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nI2I5YjliOScgZD0nTTIxIDE5VjVjMC0xLjEtLjktMi0yLTJINWMtMS4xIDAtMiAuOS0yIDJ2MTRjMCAxLjEuOSAyIDIgMmgxNGMxLjEgMCAyLS45IDItMnpNOC41IDEzLjVsMi41IDMuMDFMMTQuNSAxMmw0LjUgNkg1bDMuNS00LjV6Jy8+PC9zdmc+',
  mic: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nI2ZmZmZmZicgZD0nTTEyIDE0YzEuNjYgMCAzLTEuMzQgMy0zVjVjMC0xLjY2LTEuMzQtMy0zLTNTOSAzLjM0IDkgNXY2YzAgMS42NiAxLjM0IDMgMyAzem01LjMtM2MwIDMtMi41NCA1LjEtNS4zIDUuMVM2LjcgMTQgNi43IDExSDVjMCAzLjQxIDIuNzIgNi4yMyA2IDYuNzJWMjFoMnYtMy4yOGMzLjI4LS40OSA2LTMuMzEgNi02LjcyaC0xLjd6Jy8+PC9zdmc+',
  micOn: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nI2Y1OWUwYicgZD0nTTEyIDE0YzEuNjYgMCAzLTEuMzQgMy0zVjVjMC0xLjY2LTEuMzQtMy0zLTNTOSAzLjM0IDkgNXY2YzAgMS42NiAxLjM0IDMgMyAzem01LjMtM2MwIDMtMi41NCA1LjEtNS4zIDUuMVM2LjcgMTQgNi43IDExSDVjMCAzLjQxIDIuNzIgNi4yMyA2IDYuNzJWMjFoMnYtMy4yOGMzLjI4LS40OSA2LTMuMzEgNi02LjcyaC0xLjd6Jy8+PC9zdmc+',
  close: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nI2I5YjliOScgZD0nTTE5IDYuNDEgMTcuNTkgNSAxMiAxMC41OSA2LjQxIDUgNSA2LjQxIDEwLjU5IDEyIDUgMTcuNTkgNi40MSAxOSAxMiAxMy40MSAxNy41OSAxOSAxOSAxNy41OSAxMy40MSAxMnonLz48L3N2Zz4=',
  del: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nI2I5YjliOScgZD0nTTYgMTljMCAxLjEuOSAyIDIgMmg4YzEuMSAwIDItLjkgMi0yVjdINnYxMnptMTQtMTVoLTQuNWwtMS0xaC01bC0xIDFINHYyaDE2VjR6Jy8+PC9zdmc+',
}

// 一次发送的等待上限（ms）：服务端最坏「生成 240s + 结果图下载 30s = 270s」，
// 与 app.json 的 networkTimeout.uploadFile(300s) 同一口径，避免客户端先放弃
// 而服务端仍在出图（那会变成「用户看到失败、额度却已消耗」，见 README 7.x / M27）
const SEND_TIMEOUT = 300000
// 语音识别等待上限（ms）：与后端 AI_CHAT_TIMEOUT(60s) 对齐后留余量
const ASR_TIMEOUT = 90000
// 出图通常 10s 上下：超过该秒数把「正在思考」换成更具体的进度文案，避免用户以为卡死
const SLOW_HINT_SEC = 4
// 录音上限（秒）：超过自动结束；太长的录音对 ASR 也没必要
const RECORD_MAX_SEC = 60
const RECORD_MIN_MS = 500

const EXAMPLES = ['帮我磨皮美白', '换个干净的背景', '把头发换成短发']

/** 后端消息 → 页面消息（`fullImage` 供 <image> 直接用） */
function toView(m) {
  return {
    key: 'm' + m.id,
    id: m.id,
    role: m.role,
    type: m.type,
    content: m.content || '',
    imagePath: m.image_path || '',
    fullImage: absoluteUrl(m.image_path),
    failed: false,
  }
}

Page({
  data: {
    topPadding: 20,
    ICON,
    examples: EXAMPLES,
    sessionId: 0,
    messages: [],
    draftText: '',
    draftImage: '',        // 本地临时路径（缩略图预览用；上传失败时保留它以便重试）
    draftImagePath: '',    // 已上传的 /uploads/ 路径（发送时用它）
    draftUploading: false, // 缩略图上传中
    draftError: '',        // 上传失败原因（非空时缩略图显示可重试、输入栏下方给提示）
    pending: false,
    pendingHint: '正在思考…',
    recording: false,
    recordSec: 0,
    scrollInto: '',
    historyShow: false,
    historyItems: [],
  },

  onLoad() {
    this.setData({ topPadding: getSafeTop() })
    this._alive = true
    // 会话加载的竞态守卫（见 openSession）：每次「切会话/开新对话」都自增，晚到的响应据此丢弃
    this._sessionToken = 0
    // 输入栏草稿图的竞态守卫（见 uploadDraft）：换图时自增，旧图的上传结果据此丢弃
    this._draftToken = 0
    // 录音器：注册一次性回调（叠加注册会重复触发，故用 _alive 兜底已销毁的页面）
    this.recorder = wx.getRecorderManager()
    this.recorder.onStop((res) => {
      if (!this._alive) return
      this.finishRecord(res)
    })
    this.recorder.onError(() => {
      if (!this._alive) return
      this.clearRecTimer()
      this.setData({ recording: false, recordSec: 0 })
      wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' })
    })
    this.loadLatestSession()
  },

  onUnload() {
    this._alive = false
    this.clearRecTimer()
    this.stopSlowHint()
    // loading 是**全局浮层**，不属于任何页面：识别 / 保存途中返回上一页时必须在这里收掉，
    // 否则遮罩会跟着盖到上一页（回调缺失时更会一直卡住，口径同 README 11.3 第 21 条）
    wx.hideLoading()
    if (this.data.recording) {
      try {
        this.recorder.stop()
      } catch (e) {
        // 忽略：页面已卸载，录音器状态无关紧要
      }
    }
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages && pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },

  // ==================== 会话：恢复 / 新建 / 历史 ====================

  /**
   * 进入页面恢复最近一次会话（这样「回看」是天然的：上次聊到哪，这次接着看）。
   *
   * 同样要带竞态守卫：首次加载是**两个串行请求**（先列会话、再拉消息），若弱网下用户
   * 在这一步之间点了「新对话」，晚到的响应会把旧会话的消息灌进刚清空的视图 ——
   * 这正是 11.3 第 38 条点名的「刚进页面就点新对话」场景，所以这里也要先取 token 再比对
   * （onNewChat 自增 token 即作废在途加载）。
   */
  loadLatestSession() {
    const token = ++this._sessionToken
    request({ url: '/api/chat/sessions?page=1&size=1' })
      .then((res) => {
        if (!this._alive || token !== this._sessionToken) return
        const items = (res.data && res.data.items) || []
        if (items.length) {
          this.openSession(items[0].id)
        }
      })
      .catch(() => {
        // 拉不到就停在空态，不打扰用户（首次进入后端无会话属正常）
      })
  },

  /**
   * 打开某个会话。
   *
   * 两个要点：
   * 1) 用 `order=desc` 取**最近**的 100 条（展示前反转成时间正序）—— 若按 `page=1`（最早一页）取，
   *    会话超过 100 条后最新的消息永远看不到，用户视角是「聊到一半记录没了」；
   * 2) **竞态守卫**：弱网下「刚进页面就点新对话 / 切别的会话」时，先发出的请求可能后返回并把
   *    旧消息回填进当前视图；用自增 token 比对，晚到的响应直接丢弃。
   */
  openSession(id) {
    const token = ++this._sessionToken
    request({ url: `/api/chat/sessions/${id}/messages?page=1&size=100&order=desc` })
      .then((res) => {
        if (!this._alive || token !== this._sessionToken) return
        const messages = ((res.data && res.data.items) || []).map(toView).reverse()
        this.setData({ sessionId: id, messages, historyShow: false }, () => this.scrollToBottom())
      })
      .catch((err) => {
        if (!this._alive || token !== this._sessionToken) return
        wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      })
  },

  /** 「新对话」：只清空当前视图（会话在**发出第一条消息时**才真正创建，避免产生一堆空会话） */
  onNewChat() {
    if (this.data.pending) {
      wx.showToast({ title: '正在回复中，请稍候', icon: 'none' })
      return
    }
    if (!this.data.messages.length && !this.data.sessionId) {
      wx.showToast({ title: '已经在新对话里了', icon: 'none' })
      return
    }
    // 作废在途的会话加载（否则慢网下它的响应会把旧消息回填进刚清空的视图）
    this._sessionToken = (this._sessionToken || 0) + 1
    this.setData({ sessionId: 0, messages: [], scrollInto: '' })
    wx.showToast({ title: '已开启新对话', icon: 'none' })
  },

  /** 长按「新对话」= 历史对话（截图要求的顶部只保留一个图标，历史入口放在长按里） */
  onHistory() {
    // 回复中不打开历史（否则可删除正在等回复的那个会话，服务端落库时会撞上已删会话）
    if (this.data.pending) {
      wx.showToast({ title: '正在回复中，请稍候', icon: 'none' })
      return
    }
    request({ url: '/api/chat/sessions?page=1&size=20' })
      .then((res) => {
        const items = (res.data && res.data.items) || []
        this.setData({ historyShow: true, historyItems: items })
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }))
  },

  onCloseHistory() {
    this.setData({ historyShow: false })
  },

  onOpenHistory(e) {
    this.openSession(Number(e.currentTarget.dataset.id))
  },

  onDeleteHistory(e) {
    const id = Number(e.currentTarget.dataset.id)
    wx.showModal({
      title: '删除这段对话？',
      content: '删除后无法恢复（已生成的图片仍保留在服务器，可继续用于编辑）',
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: (res) => {
        if (!res.confirm) return
        request({ url: `/api/chat/sessions/${id}`, method: 'DELETE' })
          .then(() => {
            const historyItems = this.data.historyItems.filter((x) => x.id !== id)
            const patch = { historyItems }
            // 删掉的正是当前会话 → 同时清空对话视图
            if (this.data.sessionId === id) {
              patch.sessionId = 0
              patch.messages = []
            }
            this.setData(patch)
            wx.showToast({ title: '已删除', icon: 'none' })
          })
          .catch((err) => wx.showToast({ title: err.message || '删除失败', icon: 'none' }))
      },
    })
  },

  // ==================== 输入 / 选图 ====================

  onInput(e) {
    this.setData({ draftText: e.detail.value })
  },

  onExample(e) {
    this.setData({ draftText: e.currentTarget.dataset.text })
  },

  onPickImage() {
    if (this.data.pending) {
      wx.showToast({ title: '正在处理上一条，稍等一下', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        // 选完立即上传：发送时只带路径，用户点「发送」不用再等上传
        this.setData({
          draftImage: path, draftImagePath: '', draftUploading: true, draftError: '',
        })
        this.uploadDraft(path)
      },
    })
  },

  /**
   * 上传选中的图片，拿到 `/uploads/` 路径。
   *
   * **失败时必须保留缩略图并显式标错**（这里是「一直提示上传照片」的根因）：
   * 旧实现失败就把 `draftImage` 一起清空、只弹一个很容易错过的 toast，用户以为图已经附上了，
   * 继续发消息时服务端收到的 `image_path` 是空的 → 被判成「没带图」→ 回「请上传照片再发一次」，
   * 于是「明明发了图却一直让上传」。现在失败态挂在缩略图上（可点击重试）+ 输入栏下方一行提示，
   * 且发送时会被拦住并说明原因。
   */
  uploadDraft(filePath) {
    const token = getToken()
    if (!token) {
      this.setData({ draftUploading: false, draftError: '登录已过期' })
      return
    }
    // 竞态守卫（同 openSession 的 _sessionToken 口径）：上传在途时用户又换了一张图，
    // 旧图的上传结果晚到会把 draftImagePath 覆盖成**上一张**的路径 —— 缩略图显示的是新图、
    // 发出去的却是旧图（用户视角：发错图）。令牌一变，旧回调直接丢弃。
    const draftToken = ++this._draftToken
    const alive = () => this._alive && draftToken === this._draftToken
    this.setData({ draftUploading: true, draftError: '' })
    wx.uploadFile({
      url: absoluteUrl('/api/upload'),
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${token}` },
      timeout: 60000,
      success: (res) => {
        if (!alive()) return
        let body = {}
        try {
          body = JSON.parse(res.data || '{}')
        } catch (e) {
          body = {}
        }
        const url = (body.data && body.data.url) || ''
        if (res.statusCode === 200 && body.code === 0 && url) {
          this.setData({ draftUploading: false, draftError: '', draftImagePath: url })
        } else {
          this.setData({
            draftUploading: false,
            draftError: body.msg || `上传失败（${res.statusCode}）`,
          })
        }
      },
      fail: (err) => {
        if (!alive()) return
        // 网络层失败：域名校验没勾 / BASE_URL 不是局域网 IP / 后端没启动都会走这里
        const msg = (err && err.errMsg) || ''
        this.setData({
          draftUploading: false,
          draftError: /timeout/i.test(msg) ? '上传超时' : '上传失败，请检查网络',
        })
      },
    })
  },

  /** 缩略图点击：上传失败时重试（成功/上传中不响应） */
  onRetryUpload() {
    if (!this.data.draftImage || this.data.draftUploading || this.data.draftImagePath) return
    this.uploadDraft(this.data.draftImage)
  },

  onRemoveDraft() {
    this.setData({ draftImage: '', draftImagePath: '', draftUploading: false, draftError: '' })
  },

  // ==================== 发送 / 重试 ====================

  onSend() {
    if (this.data.pending) {
      // pending 期间输入框通常已被清空（点不到发送）；若用户又敲了字再点，给一句反馈而不是静默丢弃
      wx.showToast({ title: '正在处理上一条，稍等一下', icon: 'none' })
      return
    }
    const text = (this.data.draftText || '').trim()
    const imagePath = this.data.draftImagePath
    if (!text && !imagePath) {
      wx.showToast({ title: '说点什么吧～', icon: 'none' })
      return
    }
    if (this.data.draftImage && !imagePath) {
      // 图没传成功就发，服务端只会看到「没带图」—— 所以这里必须拦住并说清原因
      wx.showToast({
        title: this.data.draftError ? '图片没传成功，点缩略图重试' : '图片上传中，稍等一下',
        icon: 'none',
      })
      return
    }
    // 乐观上屏：先显示用户消息（带图时连图一起显示）与「思考中」，失败再标记可重试
    const local = {
      key: 'tmp' + Date.now(),
      id: 0,
      role: 'user',
      type: imagePath ? 'image' : 'text',
      content: text,
      imagePath,
      // 本地临时路径优先（立即能显示），没有就用服务器路径拼
      fullImage: this.data.draftImage || absoluteUrl(imagePath),
      failed: false,
    }
    // 只提交新增的那一条（`messages[n]` 路径追加），不再整表重传：
    // 一个会话最多 100 条消息，每次发声都把这 100 个对象跨线程序列化一遍纯属浪费
    // （字段全是纯数据，路径更新的结果与 `concat` 完全一致）
    this.setData({
      [`messages[${this.data.messages.length}]`]: local,
      draftText: '',
      draftImage: '',
      draftImagePath: '',
      draftUploading: false,
      draftError: '',
      pending: true,
      pendingHint: '正在思考…',
    })
    this.scrollToBottom()
    this.startSlowHint()
    this.postMessage(local)
  },

  /** 失败气泡点击重试（保留原文与图片，不重复上屏） */
  onBubbleTap(e) {
    const key = e.currentTarget.dataset.key
    const msg = this.data.messages.find((x) => x.key === key)
    if (!msg || !msg.failed || this.data.pending) return
    // 只改这一条的 failed 与 pending（路径更新），不整表重传
    const retryAt = this.data.messages.findIndex((x) => x.key === key)
    const retryPatch = { pending: true, pendingHint: '正在思考…' }
    if (retryAt >= 0) retryPatch[`messages[${retryAt}].failed`] = false
    this.setData(retryPatch)
    this.scrollToBottom()
    this.startSlowHint()
    this.postMessage(msg)
  },

  postMessage(msg) {
    const ensureSession = this.data.sessionId
      ? Promise.resolve(this.data.sessionId)
      : request({ url: '/api/chat/sessions', method: 'POST', data: {} }).then((res) => {
          const id = res.data.id
          this.setData({ sessionId: id })
          return id
        })

    ensureSession
      .then((sid) =>
        request({
          url: `/api/chat/sessions/${sid}/messages`,
          method: 'POST',
          // 只传这两个字段：意图与修图指令由服务端判定（见文件头约定）
          data: { text: msg.content || '', image_path: msg.imagePath || undefined },
          timeout: SEND_TIMEOUT,
        })
      )
      .then((res) => {
        // 发消息最长要等 300s（出图）：期间用户完全可能返回上一页，
        // 响应回来时页面已卸载 —— 直接丢弃，避免对已销毁页面 setData
        if (!this._alive) return
        const aiView = toView(res.data.ai_message)
        // 用服务端返回的用户消息替换本地乐观消息：拿到真实的 id / type / 图片路径，
        // 这样「用户发的图」在重新进会话后仍能正常显示
        const userView = toView(res.data.user_message)
        // 路径更新：只替换本地那条乐观消息 + 追加 AI 回复（口径同 messages.map + concat，
        // 但不重传整表）。与「思考中」气泡一起收掉：否则滚动目标还是 pending 气泡，定位会差一条消息
        const replaced = this.data.messages.findIndex((x) => x.key === msg.key)
        const appendAt = this.data.messages.length
        const patch = { pending: false, [`messages[${appendAt}]`]: aiView }
        if (replaced >= 0) patch[`messages[${replaced}]`] = userView
        this.setData(patch, () => this.scrollToBottom())
      })
      .catch((err) => {
        if (!this._alive) return
        // 只把这一条标红（路径更新），不整表重传
        const failedAt = this.data.messages.findIndex((x) => x.key === msg.key)
        if (failedAt >= 0) {
          this.setData({ [`messages[${failedAt}].failed`]: true })
        }
        wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' })
      })
      .finally(() => {
        // 页面已卸载时不再 setData（toast/浮层同理）：onUnload 里已经收过 loading 与慢提示
        if (!this._alive) return
        this.setData({ pending: false })
        this.stopSlowHint()
      })
  },

  // ==================== 出图结果：保存 / 编辑 / 预览 ====================

  onPreview(e) {
    const src = e.currentTarget.dataset.src
    if (src) wx.previewImage({ urls: [src], current: src })
  },

  onSaveWork(e) {
    const imagePath = e.currentTarget.dataset.src
    if (!imagePath) return
    const d = new Date()
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    let failMsg = ''
    wx.showLoading({ title: '保存中…', mask: true })
    request({
      url: '/api/works',
      method: 'POST',
      data: {
        title: `AI 修图 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
        type: 'ai',
        image_path: imagePath,
      },
    })
      .catch((err) => {
        failMsg = (err && err.message) || '保存失败'
      })
      // 必须**先 hideLoading 再 showToast**：wx 的 loading 是全局浮层，
      // 在它还没收起时就 showToast 会被随后的 hideLoading 一起收掉（表现为「点了保存没有任何提示」）
      .finally(() => {
        wx.hideLoading()
        wx.showToast(
          failMsg
            ? { title: failMsg, icon: 'none' }
            : { title: '已保存到我的作品', icon: 'success' }
        )
      })
  },

  /** 去编辑：复用编辑页的 imagePath 入参（见 13 章编辑页） */
  onEditImage(e) {
    const imagePath = e.currentTarget.dataset.src
    if (!imagePath) return
    wx.navigateTo({
      url:
        `/pages/editor/editor?imagePath=${encodeURIComponent(absoluteUrl(imagePath))}` +
        `&captureTime=${Date.now()}`,
    })
  },

  // ==================== 语音输入（录音 → 转文字 → 填入输入框，不自动发送） ====================

  onMicTap() {
    if (this.data.pending) return
    if (this.data.recording) {
      this.recorder.stop() // 结束录音，结果在 onStop 里处理
      return
    }
    this.ensureRecordAuth()
      .then(() => this.startRecord())
      .catch(() => {
        // 权限被拒：已在 ensureRecordAuth 里给出引导
      })
  },

  /** 录音授权：未问过就弹授权；明确拒绝过则直接引导去设置页（wx.authorize 不会再弹） */
  ensureRecordAuth() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          const granted = (res.authSetting || {})['scope.record']
          if (granted) {
            resolve()
            return
          }
          if (granted === false) {
            this.showRecordGuide()
            reject(new Error('DENIED'))
            return
          }
          wx.authorize({
            scope: 'scope.record',
            success: () => resolve(),
            fail: () => {
              this.showRecordGuide()
              reject(new Error('DENIED'))
            },
          })
        },
        fail: () => reject(new Error('SETTING_FAIL')),
      })
    })
  },

  showRecordGuide() {
    wx.showModal({
      title: '需要麦克风权限',
      content: '开启后可以说出修图需求，我会把语音转成文字填进输入框（不会自动发送）',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) wx.openSetting({})
      },
    })
  },

  startRecord() {
    this.setData({ recording: true, recordSec: 0 })
    // 16k 单声道 mp3：体积小、语音识别支持良好（后端 ALLOWED_AUDIO_EXT 见 services/asr.py）
    this.recorder.start({
      duration: RECORD_MAX_SEC * 1000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3',
    })
    this.clearRecTimer()
    this._recTimer = setInterval(() => {
      const sec = this.data.recordSec + 1
      this.setData({ recordSec: sec })
      if (sec >= RECORD_MAX_SEC) this.recorder.stop()
    }, 1000)
  },

  clearRecTimer() {
    if (this._recTimer) {
      clearInterval(this._recTimer)
      this._recTimer = null
    }
  },

  finishRecord(res) {
    this.clearRecTimer()
    this.setData({ recording: false, recordSec: 0 })
    const path = res && res.tempFilePath
    if (!path) {
      wx.showToast({ title: '没有录到声音，再试一次', icon: 'none' })
      return
    }
    if ((res.duration || 0) < RECORD_MIN_MS) {
      wx.showToast({ title: '说话时间太短，请再说一次', icon: 'none' })
      return
    }
    this.uploadAsr(path)
  },

  uploadAsr(filePath) {
    wx.showLoading({ title: '识别中…', mask: true })
    wx.uploadFile({
      url: absoluteUrl('/api/chat/asr'),
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${getToken()}` },
      timeout: ASR_TIMEOUT,
      success: (res) => {
        // 识别期间用户可能已离开页面：此时既不能再 setData，也不能再弹 toast
        // （loading 是全局浮层，页面卸载后仍会显示，故先在 onUnload 里收起）
        if (!this._alive) {
          wx.hideLoading()
          return
        }
        let body = {}
        try {
          body = JSON.parse(res.data || '{}')
        } catch (e) {
          body = {}
        }
        const text = (body.data && body.data.text) || ''
        let toast = ''
        if (res.statusCode === 200 && body.code === 0) {
          if (!text) {
            toast = '没听清，请再说一次'
          } else {
            // 只填入输入框，由用户确认后自己点发送（避免识别偏差被直接发出去）
            this.setData({ draftText: text })
            toast = '已转成文字，可修改后发送'
          }
        } else {
          toast = body.msg || '语音识别失败'
        }
        // loading 与 toast 共用同一浮层：必须先 hideLoading 再 showToast，
        // 否则（放在 complete 里）hideLoading 会把刚弹出的提示一起关掉（见 11.3 第 16 / 39 条）
        wx.hideLoading()
        wx.showToast({ title: toast, icon: 'none' })
      },
      fail: () => {
        wx.hideLoading()
        if (!this._alive) return
        wx.showToast({ title: '语音识别失败', icon: 'none' })
      },
    })
  },

  // ==================== 滚动与进度提示 ====================

  scrollToBottom() {
    wx.nextTick(() => {
      const list = this.data.messages
      const last = list[list.length - 1]
      this.setData({ scrollInto: this.data.pending ? 'msg-pending' : last ? 'msg-' + last.key : '' })
    })
  },

  /** 出图比文本慢得多：超过几秒后换文案，让用户知道还在跑而不是卡死 */
  startSlowHint() {
    this.stopSlowHint()
    this._slowTimer = setTimeout(() => {
      if (this.data.pending) this.setData({ pendingHint: '正在生成图片，约需 10 秒…' })
    }, SLOW_HINT_SEC * 1000)
  },

  stopSlowHint() {
    if (this._slowTimer) {
      clearTimeout(this._slowTimer)
      this._slowTimer = null
    }
  },
})
