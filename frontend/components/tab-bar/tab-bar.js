// components/tab-bar/tab-bar.js — 全局底部导航栏（首页/模板/我的）
// 自导航：redirectTo 切换，避免页面栈堆积
const NAV = {
  home: '/pages/index/index',
  template: '/pages/template/template',
  mine: '/pages/mine/mine',
}

Component({
  properties: {
    // 当前选中项：home / template / mine
    active: { type: String, value: 'home' },
    // 入场动画（登录转场接力时由页面传入 true：导航栏从底部滑入）
    enter: { type: Boolean, value: false },
  },
  methods: {
    onTap(e) {
      const { key } = e.currentTarget.dataset
      if (key === this.data.active || !NAV[key]) return
      wx.redirectTo({ url: NAV[key] })
    },
  },
})
