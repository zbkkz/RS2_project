// pages/template/template.js — 模板页：搜索 + 分类 Tab + 双列瀑布流（参考稿布局，紫色主题）
const { request, absoluteUrl } = require('../../utils/request')
const { getSafeTop, getTabBarHeight } = require('../../utils/navbar')

// SVG 图标（base64 data URI）
const ICON = {
  search: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTE1LjUgMTRoLS43OWwtLjI4LS4yN0MxNS40MSAxMi41OSAxNiAxMS4xMSAxNiA5LjUgMTYgNS45MSAxMy4wOSAzIDkuNSAzUzMgNS45MSAzIDkuNSA1LjkxIDE2IDkuNSAxNmMxLjYxIDAgMy4wOS0uNTkgNC4yMy0xLjU3bC4yNy4yOHYuNzlsNSA0Ljk5TDIwLjQ5IDE5bC00Ljk5LTV6bS02IDBDNy4wMSAxNCA1IDExLjk5IDUgOS41UzcuMDEgNSA5LjUgNSAxNCA3LjAxIDE0IDkuNSAxMS45OSAxNCA5LjUgMTR6Ii8+PC9zdmc+',
  // 已点赞：实心爱心
  heartFill: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2Y4NTdhNiIgZD0iTTEyIDIxLjM1bC0xLjQ1LTEuMzJDNS40IDE1LjM2IDIgMTIuMjggMiA4LjUgMiA1LjQyIDQuNDIgMyA3LjUgM2MxLjc0IDAgMy40MS44MSA0LjUgMi4wOUMxMy4wOSAzLjgxIDE0Ljc2IDMgMTYuNSAzIDE5LjU4IDMgMjIgNS40MiAyMiA4LjVjMCAzLjc4LTMuNCA2Ljg2LTguNTUgMTEuNTRMMTIgMjEuMzV6Ii8+PC9zdmc+',
  // 未点赞：空心爱心（灰描边），与实心态区分
  heartOutline: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0ibm9uZSIgc3Ryb2tlPSIjYzBjMGM4IiBzdHJva2Utd2lkdGg9IjEuNyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNMTkgMTRjMS40OS0xLjQ2IDMtMy4yMSAzLTUuNUE1LjUgNS41IDAgMCAwIDE2LjUgM2MtMS43NiAwLTMgLjUtNC41IDItMS41LTEuNS0yLjc0LTItNC41LTJBNS41IDUuNSAwIDAgMCAyIDguNWMwIDIuMyAxLjUgNC4wNSAzIDUuNWw3IDdaIi8+PC9zdmc+',
  plus: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTE5IDEzaC02djZoLTJ2LTZINXYtMmg2VjVoMnY2aDZ2MnoiLz48L3N2Zz4=',
  user: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTEyIDEyYzIuMjEgMCA0LTEuNzkgNC00cy0xLjc5LTQtNC00LTQgMS43OS00IDQgMS43OSA0IDQgNHptMCAyYy0yLjY3IDAtOCAxLjM0LTggNHYyaDE2di0yYzAtMi42Ni01LjMzLTQtOC00eiIvPjwvc3ZnPg==',
}

const HOT_TAB = '热门'
const COL_W = 337 // 瀑布流单列宽（rpx）

Page({
  data: {
    topPadding: 20,
    tabBarHeight: 90,   // 底部导航占位高度（px）：onLoad 算出，做 .page-root 的 padding-bottom
    icons: ICON,
    keyword: '',
    tabs: [HOT_TAB],
    activeTab: HOT_TAB,
    colLeft: [],
    colRight: [],
    empty: false,       // 过滤后为空（含搜索无结果）
    loaded: false,
  },

  onLoad() {
    this._alive = true
    // tabBarHeight = 底部导航占位高度（px），做 .page-root 的 padding-bottom
    this.setData({ topPadding: getSafeTop(), tabBarHeight: getTabBarHeight() })
  },

  onUnload() {
    // 只用于拦住「已离开页面后回来的响应」：本页的 setData 都是列表级，晚到会覆盖新数据
    this._alive = false
  },

  onShow() {
    // `this.all` 只在成功回调里写入，因此在途期间 onShow 会再发一次同样的请求（onShow 很频繁）。
    // 用 _tplReq 去重：同一次请求没有回来之前不再发第二条。
    if (!this.all) {
      this.loadTemplates()
    }
  },

  /** 拉取模板列表（一次全量，前端过滤/分水） */
  loadTemplates() {
    if (this._tplReq) return
    this._tplReq = true
    request({ url: '/api/templates' })
      .then((res) => {
        if (!this._alive) return
        // res.data 兜空对象：接口返回非统一结构时不该在这里抛 TypeError
        const d = res.data || {}
        this.all = (d.items || []).map((t) => ({
          ...t,
          fullImage: absoluteUrl(t.file_path),
        }))
        const set = {}
        this.all.forEach((t) => { if (t.category) set[t.category] = true })
        this.setData({ tabs: [HOT_TAB, ...Object.keys(set)], loaded: true }, () => this.applyFilter())
      })
      .catch((err) => {
        if (!this._alive) return
        // 拉取失败时既没有列表也没有 empty 标记，页面会整片空白且毫无提示；
        // 这里落下 empty（走「模板准备中」占位）并给出失败原因
        this.setData({ loaded: true, empty: true })
        wx.showToast({ title: (err && err.message) || '模板加载失败', icon: 'none' })
      })
      .finally(() => {
        this._tplReq = false
      })
  },

  /** 关键词 + 分类过滤，然后瀑布流分水 */
  applyFilter() {
    const { keyword, activeTab } = this.data
    let list = this.all || []
    if (activeTab !== HOT_TAB) {
      list = list.filter((t) => t.category === activeTab)
    } else {
      list = list.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0))
    }
    const kw = (keyword || '').trim()
    if (kw) {
      list = list.filter((t) => (t.name || '').indexOf(kw) !== -1)
    }
    // 贪心分水：按封面估算高度分配左右列
    const colLeft = []
    const colRight = []
    let lh = 0
    let rh = 0
    list.forEach((t) => {
      const h = t.width ? Math.round((COL_W * (t.height || t.width)) / t.width) : 420
      const item = { ...t, coverH: h }
      if (lh <= rh) {
        colLeft.push(item)
        lh += h
      } else {
        colRight.push(item)
        rh += h
      }
    })
    this.setData({ colLeft, colRight, empty: this.data.loaded && list.length === 0 })
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  /** 点「搜索」或键盘确认时过滤 */
  onSearch() {
    this.applyFilter()
  },

  onTabTap(e) {
    const { name } = e.currentTarget.dataset
    if (name === this.data.activeTab) return
    this.setData({ activeTab: name }, () => this.applyFilter())
  },

  /**
   * 点赞 / 取消点赞（toggle，POST /api/templates/<id>/like）。
   *
   * 三个关键点：
   * ① **wxml 侧必须用 `catchtap`** —— 卡片外层是 `bindtap="onTemplateTap"`，
   *    用 `bindtap` 会连同触发「选图 → 套用模板」，表现为「点了爱心却让我选图」；
   * ② **乐观更新与回滚都要同时遍历 colLeft / colRight** —— 模板分列存放在两个数组里
   *    （瀑布流贪心分水），只改一列会出现"数字变了、卡片没变"；
   * ③ **在途请求未返回时忽略再次点击**（按模板 id 记 pending），避免连点导致本地与后端计数不一致。
   *
   * 「热门」Tab 的就地重排不做：点赞后立即重排会让刚点的那张卡跳走，
   * 排序统一交给 `applyFilter()`（切 Tab / 重新进入时按 likes 降序）。
   */
  onLikeTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    if (!this._likePending) this._likePending = {}
    if (this._likePending[id]) return

    const before = this.findTemplate(id)
    if (!before) return
    this._likePending[id] = true

    const liked = !before.liked
    const likes = Math.max(0, (before.likes || 0) + (liked ? 1 : -1))
    this.patchTemplate(id, { liked, likes })

    request({ url: `/api/templates/${id}/like`, method: 'POST' })
      .then((res) => {
        const d = (res && res.data) || {}
        // 以服务端返回为准校正（并发点击、种子计数等情况下本地推算可能不准）
        this.patchTemplate(id, { liked: !!d.liked, likes: Number(d.likes) || 0 })
      })
      .catch((err) => {
        // 失败回滚到点击前的状态，并说明原因
        this.patchTemplate(id, { liked: before.liked, likes: before.likes || 0 })
        wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
      })
      .finally(() => { delete this._likePending[id] })
  },

  /** 在瀑布流两列里查找某个模板（点赞用） */
  findTemplate(id) {
    const hit = (arr) => (arr || []).find((t) => t.id === id)
    return hit(this.data.colLeft) || hit(this.data.colRight) || null
  },

  /**
   * 局部更新某个模板的字段。
   *
   * 瀑布流是两列存放的，所以两列都要扫 —— 但**只提交真正命中的那一列**：
   * 点赞一次要更新 3 次（乐观 → 服务端校正 → 失败回滚），原来每次都把两列整组重传，
   * 一次点赞最多 6 次全量 setData（每列几十个模板对象跨线程序列化），列表越长越明显。
   * 传空对象时 setData 什么也不做，等价于原来的「没命中就白跑一趟」。
   */
  patchTemplate(id, patch) {
    const next = {}
    const patchCol = (key) => {
      const list = this.data[key] || []
      if (!list.some((t) => t.id === id)) return
      next[key] = list.map((t) => (t.id === id ? { ...t, ...patch } : t))
    }
    patchCol('colLeft')
    patchCol('colRight')
    if (next.colLeft || next.colRight) this.setData(next)
  },

  /** 选中模板：先选图，再带模板参数进编辑页 */
  onTemplateTap(e) {
    const { path } = e.currentTarget.dataset
    this.chooseImage((img) => {
      wx.navigateTo({
        url: `/pages/editor/editor?imagePath=${encodeURIComponent(img)}&template=${encodeURIComponent(path)}`,
      })
    })
  },

  /** 右下 + 悬浮钮：选图进编辑页（空白创作） */
  onFabTap() {
    this.chooseImage((img) => {
      wx.navigateTo({ url: `/pages/editor/editor?imagePath=${encodeURIComponent(img)}` })
    })
  },

  chooseImage(cb) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (path) cb(path)
      },
    })
  },
})
