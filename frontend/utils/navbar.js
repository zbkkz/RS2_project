// 自定义导航栏（app.json navigationStyle: custom）下的页面顶部安全内边距。
// 各页面（登录页除外）顶部内容需要下移到右上角胶囊按钮（"···/○"）之下，避免被遮挡。
// 返回：内容应从屏幕顶部下方多少 px 开始布局（= 胶囊按钮下边缘 + 间隙）。
function getSafeTop(gap = 10) {
  let bottom = 0
  try {
    const rect = wx.getMenuButtonBoundingClientRect()
    bottom = (rect && rect.bottom) || 0
  } catch (e) {
    // ignore
  }
  const statusBar = (wx.getWindowInfo && wx.getWindowInfo().statusBarHeight) || 20
  // 取不到胶囊位置时按「状态栏 + 胶囊高度（约 32px）」估算
  const base = bottom > 0 ? bottom : statusBar + 32
  return base + gap
}

// 底部安全区高度（px）：iPhone 全面屏的 Home indicator 区域，安卓 / 无安全区机型为 0。
// 语义等同 CSS `env(safe-area-inset-bottom)`，但**不依赖渲染引擎对 env 的支持** ——
// Skyline 下把它写进 `calc()` 会把整条声明直接丢掉；getTabBarHeight() 用它算出导航栏占位。
function getSafeBottom() {
  try {
    const info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync()
    const screenH = info && info.screenHeight
    const safeBottom = info && info.safeArea && info.safeArea.bottom
    if (screenH && typeof safeBottom === 'number') {
      const inset = screenH - safeBottom
      return inset > 0 ? inset : 0
    }
  } catch (e) {
    // ignore
  }
  return 0
}

// 底部导航在页面里的实际占位高度（px）= 导航本体 112rpx（按屏宽换算成 px）+ 底部安全区，
// 与 components/tab-bar 的 `height: 112rpx + padding-bottom: env(safe-area-inset-bottom)` 同源。
// 页面把它当作 .page-root 的 padding-bottom，滚动区（flex:1）自然就停在导航栏上沿 ——
// 与聊天页「根节点 flex 定高」同一套可复现做法（见 README 11.3 第 29 条）。
function getTabBarHeight() {
  try {
    const info = wx.getWindowInfo()
    const winW = info.windowWidth || 375
    return Math.round((112 * winW) / 750) + getSafeBottom()
  } catch (e) {
    return 90
  }
}

// getSafeBottom 只被本模块的 getTabBarHeight 使用，不对外导出 —— 少一个出口就少一处
// 「各页自己算一遍底部安全区」的机会（口径同 README 11.3 第 48 条）
module.exports = { getSafeTop, getTabBarHeight }