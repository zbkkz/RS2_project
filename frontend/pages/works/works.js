// pages/works/works.js
const { request, absoluteUrl } = require('../../utils/request')
const { getSafeTop } = require('../../utils/navbar')
const { workTypeLabel, actionLabel } = require('../../utils/labels')

// 返回箭头（浅色页面用深色实心图标，base64 SVG data URI，与全站图标约定一致）
const ICON = {
  back: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZmlsbD0nIzFmMjMyOScgZD0nTTIwIDExSDcuODNsNS41OS01LjU5TDEyIDRsLTggOCA4IDggMS40MS0xLjQxTDcuODMgMTNIMjB2LTJ6Jy8+PC9zdmc+',
}

// 作品类型文案见 utils/labels.js（与首页「最近作品」角标共用同一份，避免两处漂移）

// 编辑历史列表：单条高度（rpx）与滚动区高度上限。
// 高度按条数自适应（1 条时不留大片空白），超过上限才由 scroll-view 承载滚动 ——
// Skyline 下竖直 scroll-view 必须有确定高度，所以这里给的是像素值而不是 max-height。
const HISTORY_ITEM_H = 76
const HISTORY_MAX_H = 240

Page({
  data: {
    topPadding: 20,
    icons: ICON,
    items: [],
    loading: false,
    finished: false,
    refreshing: false, // scroll-view 下拉刷新中（refresher-triggered 绑定）
    page: 1,           // 已加载到第几页（触底加载下一页）
    total: 0,          // 后端返回的作品总数（页头「共 N 个」用它，而不是已加载条数）
    detailWork: null,
    records: [],          // 当前详情作品的编辑历史（action 已映射为中文）
    recordsLoading: false,
    recordsError: '',     // 非空 = 加载失败原因（该行可点击重试）
    recordsHeight: 0,     // 历史列表高度（rpx）：按条数自适应，超过上限才滚动
  },

  onLoad() {
    this.setData({ topPadding: getSafeTop() })
    // 编辑历史请求的竞态令牌：快速连点两张卡时，先发的请求可能后返回，
    // 会把 A 作品的历史灌进 B 的弹层（口径同 README 11.3 第 38 条 ②）
    this._recordsToken = 0
    // 作品列表的响应令牌：下拉刷新会「插队」到正在进行的翻页请求之前（见 listWorks）
    this._listToken = 0
    this._shownOnce = false
    this.listWorks(1)
  },

  /**
   * 回到本页时刷新列表。
   *
   * 首次 `onShow` 紧跟 `onLoad`（列表已在加载中），跳过；之后每次回到本页都刷新 ——
   * 典型路径是「作品页 → 继续编辑 → 编辑页保存 → 返回」，此前列表仍是旧数据，
   * 刚保存的作品要手动下拉才出现（首页「最近作品」有 onShow 刷新，两页口径不一致）。
   */
  onShow() {
    if (!this._shownOnce) {
      this._shownOnce = true
      return
    }
    // 详情弹层开着时不打断（刷新会替换列表数据，弹层里读的是旧对象）
    if (this.data.detailWork) return
    this.listWorks(1, true)
  },

  /**
   * 下拉刷新：由 scroll-view 的 `bindrefresherrefresh` 驱动（见 works.wxml）。
   * 不用页面级 `onPullDownRefresh` —— Skyline 下页面级下拉刷新不生效，那个回调永远不会触发。
   */
  onRefresh() {
    this.setData({ refreshing: true })
    // force=true：触底加载正在进行（loading=true）时下拉刷新也必须真的刷新 ——
    // 否则 listWorks 会因 loading 守卫直接返回已 resolve 的 promise，下拉动画瞬间收起、
    // 列表却没重新拉取（用户以为刷新了，其实什么都没发生）
    this.listWorks(1, true).finally(() => this.setData({ refreshing: false }))
  },

  /** 触底加载下一页（scroll-view 的 bindscrolltolower） */
  onLoadMore() {
    if (this.data.loading || this.data.finished) return
    this.listWorks(this.data.page + 1)
  },

  /**
   * 拉取作品列表。
   *
   * `page === 1` 时整体替换（首屏 / 下拉刷新），否则**追加**到列表尾部 ——
   * 此前固定只取 `page=1&size=20` 且没有翻页入口，作品超过 20 张后第 21 张起永远看不到
   * （页头「共 N 个」显示的还只是已加载条数，用户会以为作品丢了）。
   */
  listWorks(page = 1, force = false) {
    if (!force && this.data.loading) return Promise.resolve()
    const p = Math.max(1, Number(page) || 1)
    // 响应令牌：刷新会插队到正在进行的翻页请求之前，晚到的旧响应必须丢弃，
    // 否则它会用旧的增量结果覆盖刚刷新出来的第一页（口径同编辑历史的 _recordsToken）
    const token = ++this._listToken
    this.setData({ loading: true })
    return request({ url: `/api/works?page=${p}&size=20` })
      .then((res) => {
        if (token !== this._listToken) return // 已被更新的请求取代：丢弃过期响应
        // res.data 先兜空对象：接口异常返回非统一结构时不该在这里抛 TypeError，
        // 否则页面弹出的是英文报错串（口径同首页「最近作品」的失败处理）
        const d = res.data || {}
        const list = (d.items || []).map((w) => ({
          ...w,
          fullImage: absoluteUrl(w.thumb_path || w.image_path),
          typeLabel: workTypeLabel(w.type),
        }))
        const items = p === 1 ? list : this.data.items.concat(list)
        const total = Number(d.total) || items.length
        this.setData({
          items,
          total,
          page: p,
          // 以 total 为准判断是否还有下一页（比「本页是否满 size」更准）
          finished: items.length >= total,
        })
      })
      .catch((err) => {
        if (token !== this._listToken) return
        // 首屏失败要落下 finished：否则列表与空态都不渲染、页面整片空白
        // （口径同模板页的同类修复）；翻页失败则保留 finished=false，用户再滑一下即可重试
        if (p === 1) this.setData({ finished: true })
        wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      })
      .finally(() => {
        // 只有「最新一次请求」才有权复位 loading：过期响应不能把新请求的 loading 提前关掉
        if (token === this._listToken) this.setData({ loading: false })
      })
  },

  /** 点击卡片：展示详情弹层（并加载该作品的编辑历史） */
  onViewDetail(e) {
    const id = Number(e.currentTarget.dataset.id)
    const work = this.data.items.find((w) => w.id === id)
    if (!work) return
    this.setData({ detailWork: work })
    this.loadRecords(work.id)
  },

  onCloseDetail() {
    // 作废在途的历史请求，并清空数据：否则「关掉 A、再打开 B」时会闪现 A 的记录
    this._recordsToken++
    this.setData({
      detailWork: null,
      records: [],
      recordsLoading: false,
      recordsError: '',
      recordsHeight: 0,
    })
  },

  /**
   * 加载作品的编辑记录（GET /api/works/<id>/records）。
   *
   * 注意内容预期：`work_id` 只在 `POST /api/works` 保存作品时写入一次（action = 作品类型），
   * AI 处理与对话链路的记录 `work_id` 为空（M30），因此**新保存的作品通常只有 1 条记录**；
   * seed.py 的演示数据因为显式关联了作品，历史会比较丰富。这不是 bug。
   */
  loadRecords(workId) {
    const token = ++this._recordsToken
    this.setData({ records: [], recordsLoading: true, recordsError: '', recordsHeight: 0 })
    return request({ url: `/api/works/${workId}/records` })
      .then((res) => {
        if (token !== this._recordsToken) return // 已关闭弹层或已切到别的作品：丢弃过期响应
        const list = ((res.data && res.data.items) || []).map((r) => ({
          ...r,
          actionLabel: actionLabel(r.action),
        }))
        this.setData({
          records: list,
          recordsLoading: false,
          recordsHeight: Math.min(list.length * HISTORY_ITEM_H, HISTORY_MAX_H),
        })
      })
      .catch((err) => {
        if (token !== this._recordsToken) return
        // 加载失败要给出可读原因与重试入口，不能整块空白
        this.setData({
          recordsLoading: false,
          recordsError: (err && err.message) || '加载失败',
        })
      })
  },

  /** 编辑历史加载失败后的重试 */
  onRetryRecords() {
    if (this.data.detailWork) this.loadRecords(this.data.detailWork.id)
  },

  /**
   * 详情弹层「继续编辑」：带着这张作品的**原图**回到编辑页接着改。
   * 先关弹层再跳转 —— 否则从编辑页返回时弹层还开着、读到的是一屏旧数据。
   */
  onEditWork() {
    const work = this.data.detailWork
    const path = work && (work.image_path || work.thumb_path)
    if (!path) {
      wx.showToast({ title: '该作品图片不可用', icon: 'none' })
      return
    }
    this.onCloseDetail()
    wx.navigateTo({
      url: `/pages/editor/editor?imagePath=${encodeURIComponent(absoluteUrl(path))}`,
    })
  },

  /**
   * 返回上一页。
   * 本页由「我的」/首页以 navigateTo 打开，而全局 navigationStyle 为 custom（无系统返回栏），
   * 页面内必须自带返回入口，否则只能靠系统手势/物理返回键，新用户会卡在这一页。
   */
  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    })
  },

  noop() {},

  /** 删除作品：二次确认 -> 调删除接口 -> 从列表移除 */
  onDelete() {
    const work = this.data.detailWork
    if (!work) return
    wx.showModal({
      title: '删除确认',
      content: `确定删除作品「${work.title}」吗？该操作不可恢复。`,
      success: (r) => {
        if (!r.confirm) return
        request({ url: `/api/works/${work.id}`, method: 'DELETE' })
          .then(() => {
            const items = this.data.items.filter((w) => w.id !== work.id)
            this.setData({
              items,
              // 页头「共 N 个」用 total，删除后同步减一（否则数字与实际不符）
              total: Math.max(0, this.data.total - 1),
              detailWork: null,
            })
            wx.showToast({ title: '已删除', icon: 'success' })
          })
          .catch((err) => {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' })
          })
      },
    })
  },
})