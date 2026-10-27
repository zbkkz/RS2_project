// pages/index/index.js — 首页（登录后进入）：品牌头 + 创作入口 + AI 能力 + 美颜贴纸 + 最近作品
const { request, absoluteUrl, clearToken, TOKEN_KEY, REFRESH_KEY } = require('../../utils/request')
const { getSafeTop, getTabBarHeight } = require('../../utils/navbar')
const { workTypeLabel } = require('../../utils/labels')

// SVG 图标（base64 data URI，<image> 组件嵌入）
const ICON = {
  scissors: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2VmNDQ0NCIgZD0iTTkuNjQgNy42NGMuMjMtLjUuMzYtMS4wNS4zNi0xLjY0IDAtMi4yMS0xLjc5LTQtNC00UzIgMy43OSAyIDZzMS43OSA0IDQgNGMuNTkgMCAxLjE0LS4xMyAxLjY0LS4zNkwxMCAxMmwtMi4zNiAyLjM2QzcuMTQgMTQuMTMgNi41OSAxNCA2IDE0Yy0yLjIxIDAtNCAxLjc5LTQgNHMxLjc5IDQgNCA0IDQtMS43OSA0LTRjMC0uNTktLjEzLTEuMTQtLjM2LTEuNjRMMTIgMTRsNyA3aDN2LTFMOS42NCA3LjY0ek02IDhjLTEuMSAwLTItLjg5LTItMnMuOS0yIDItMiAyIC44OSAyIDItLjkgMi0yIDJ6bTAgMTJjLTEuMSAwLTItLjg5LTItMnMuOS0yIDItMiAyIC44OSAyIDItLjkgMi0yIDJ6bTYtNy41Yy0uMjggMC0uNS0uMjItLjUtLjVzLjIyLS41LjUtLjUuNS4yMi41LjUtLjIyLjUtLjUuNXpNMTkgM2wtNiA2IDIgMiA3LTdWM3oiLz48L3N2Zz4=',
  palette: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2Y1OWUwYiIgZD0iTTEyIDNjLTQuOTcgMC05IDQuMDMtOSA5czQuMDMgOSA5IDljLjgzIDAgMS41LS42NyAxLjUtMS41IDAtLjM5LS4xNS0uNzQtLjM5LTEuMDEtLjIzLS4yNi0uMzgtLjYxLS4zOC0uOTkgMC0uODMuNjctMS41IDEuNS0xLjVIMTZjMi43NiAwIDUtMi4yNCA1LTUgMC00LjQyLTQuMDMtOC05LTh6bS01LjUgOWMtLjgzIDAtMS41LS42Ny0xLjUtMS41UzUuNjcgOSA2LjUgOSA4IDkuNjcgOCAxMC41IDcuMzMgMTIgNi41IDEyem0zLTRDOC42NyA4IDggNy4zMyA4IDYuNVM4LjY3IDUgOS41IDVzMS41LjY3IDEuNSAxLjVTMTAuMzMgOCA5LjUgOHptNSAwYy0uODMgMC0xLjUtLjY3LTEuNS0xLjVTMTMuNjcgNSAxNC41IDVzMS41LjY3IDEuNSAxLjVTMTUuMzMgOCAxNC41IDh6bTMgNGMtLjgzIDAtMS41LS42Ny0xLjUtMS41UzE2LjY3IDkgMTcuNSA5czEuNS42NyAxLjUgMS41LS42NyAxLjUtMS41IDEuNXoiLz48L3N2Zz4=',
  magnify: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzNiODJmNiIgZD0iTTE1LjUgMTRoLS43OWwtLjI4LS4yN0MxNS40MSAxMi41OSAxNiAxMS4xMSAxNiA5LjUgMTYgNS45MSAxMy4wOSAzIDkuNSAzUzMgNS45MSAzIDkuNSA1LjkxIDE2IDkuNSAxNmMxLjYxIDAgMy4wOS0uNTkgNC4yMy0xLjU3bC4yNy4yOHYuNzlsNSA0Ljk5TDIwLjQ5IDE5bC00Ljk5LTV6bS02IDBDNy4wMSAxNCA1IDExLjk5IDUgOS41UzcuMDEgNSA5LjUgNSAxNCA3LjAxIDE0IDkuNSAxMS45OSAxNCA5LjUgMTR6Ii8+PC9zdmc+',
  sparkle: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2Y1YTYyMyIgZD0iTTE5IDlsMS4yNS0yLjc1TDIzIDVsLTIuNzUtMS4yNUwxOSAxbC0xLjI1IDIuNzVMMTUgNWwyLjc1IDEuMjVMMTkgOXptLTcuNS41TDkgNCA2LjUgOS41IDEgMTJsNS41IDIuNUw5IDIwbDIuNS01LjVMMTcgMTJsLTUuNS0yLjV6TTE5IDE1bC0xLjI1IDIuNzVMMTUgMTlsMi43NSAxLjI1TDE5IDIzbDEuMjUtMi43NUwyMyAxOWwtMi43NS0xLjI1TDE5IDE1eiIvPjwvc3ZnPg==',
  wand: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2E4NTVmNyIgZD0iTTcuNSA1LjZMMTAgNyA4LjYgNC41IDEwIDIgNy41IDMuNCA1IDJsMS40IDIuNUw1IDdsMi41LTEuNHptMTIgOS44TDE3IDE0bDEuNCAyLjVMMjEgMThsLTIuNSAxLjRMMTcgMjJsLTEuNC0yLjVMMTMgMThsMi41LTEuNHpNMjIgMmwtMi41IDEuNEwxNyAybDEuNCAyLjVMMTcgN2wyLjUtMS40TDIyIDdsLTEuNC0yLjVMMjIgMnpNMTQuMzcgNy4yOWMtLjM5LS4zOS0xLjAyLS4zOS0xLjQxIDBMMS4yOSAxOC45NmMtLjM5LjM5LS4zOSAxLjAyIDAgMS40MWwyLjM0IDIuMzRjLjM5LjM5IDEuMDIuMzkgMS40MSAwTDE2LjcgMTEuMDVjLjM5LS4zOS4zOS0xLjAyIDAtMS40MWwtMi4zMy0yLjM1em0tMS4wMyA1LjQ5bC0yLjEyLTIuMTIgMi40NC0yLjQ0IDIuMTIgMi4xMi0yLjQ0IDIuNDR6Ii8+PC9zdmc+',
  drop: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzM4YmRmOCIgZD0iTTEyIDJTNSAxMC4yIDUgMTVhNyA3IDAgMCAwIDE0IDBjMC00LjgtNy0xMy03LTEzeiIvPjwvc3ZnPg==',
  upload: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzNiODJmNiIgZD0iTTkgMTZoNnYtNmg0bC03LTctNyA3aDR2NnptLTQgMmgxNHYySDV2LTJ6Ii8+PC9zdmc+',
  smile: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZhY2MxNSIgZD0iTTExLjk5IDJDNi40NyAyIDIgNi40OCAyIDEyczQuNDcgMTAgOS45OSAxMEMxNy41MiAyMiAyMiAxNy41MiAyMiAxMlMxNy41MiAyIDExLjk5IDJ6TTEyIDIwYy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHptMy41LTljLjgzIDAgMS41LS42NyAxLjUtMS41UzE2LjMzIDggMTUuNSA4IDE0IDguNjcgMTQgOS41cy42NyAxLjUgMS41IDEuNXptLTcgMGMuODMgMCAxLjUtLjY3IDEuNS0xLjVTOS4zMyA4IDguNSA4IDcgOC42NyA3IDkuNSA3LjY3IDExIDguNSAxMXptMy41IDYuNWMyLjMzIDAgNC4zMS0xLjQ2IDUuMTEtMy41SDYuODljLjggMi4wNCAyLjc4IDMuNSA1LjExIDMuNXoiLz48L3N2Zz4=',
  layers: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzM0ZDM5OSIgZD0iTTExLjk5IDE4LjU0bC03LjM3LTUuNzNMMyAxNC4wN2w5IDcgOS03LTEuNjMtMS4yNy03LjM4IDUuNzR6TTEyIDE2bDcuMzYtNS43M0wyMSA5bC05LTctOSA3IDEuNjMgMS4yN0wxMiAxNnoiLz48L3N2Zz4=',
  tpl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzhiNWNmNiIgZD0iTTIxIDE5VjVjMC0xLjEtLjktMi0yLTJINWMtMS4xIDAtMiAuOS0yIDJ2MTRjMCAxLjEuOSAyIDIgMmgxNGMxLjEgMCAyLS45IDItMnpNOC41IDEzLjVsMi41IDMuMDFMMTQuNSAxMmw0LjUgNkg1bDMuNS00LjV6Ii8+PC9zdmc+',
  text: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2Y1OWUwYiIgZD0iTTIuNSA0djNoNXYxMmgzVjdoNVY0aC0xM3ptMTkgNWgtOXYzaDN2N2gzdi03aDNWOXoiLz48L3N2Zz4=',
  draw: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2VmNDQ0NCIgZD0iTTMgMTcuMjVWMjFoMy43NUwxNy44MSA5Ljk0bC0zLjc1LTMuNzVMMyAxNy4yNXpNMjAuNzEgNy4wNGMuMzktLjM5LjM5LTEuMDIgMC0xLjQxbC0yLjM0LTIuMzRjLS4zOS0uMzktMS4wMi0uMzktMS40MSAwbC0xLjgzIDEuODMgMy43NSAzLjc1IDEuODMtMS44M3oiLz48L3N2Zz4=',
  // ↓ 设置弹层用（口径同个人页菜单图标，颜色一一对应）
  refresh: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzNiODJmNiIgZD0iTTE3LjY1IDYuMzVDMTYuMiA0LjkgMTQuMjEgNCAxMiA0Yy00LjQyIDAtNy45OSAzLjU4LTcuOTkgOHMzLjU3IDggNy45OSA4YzMuNzMgMCA2Ljg0LTIuNTUgNy43My02aC0yLjA4Yy0uODIgMi4zMy0zLjA0IDQtNS42NSA0LTMuMzEgMC02LTIuNjktNi02czIuNjktNiA2LTZjMS42NiAwIDMuMTQuNjkgNC4yMiAxLjc4TDEzIDExaDdWNGwtMi4zNSAyLjM1eiIvPjwvc3ZnPg==',
  doc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzhiNWNmNiIgZD0iTTE0IDJINmMtMS4xIDAtMS45OS45LTEuOTkgMkw0IDIwYzAgMS4xLjg5IDIgMS45OSAySDE4YzEuMSAwIDItLjkgMi0yVjhsLTYtNnptMiAxNkg4di0yaDh2MnptMC00SDh2LTJoOHYyem0tMy01VjMuNUwxOC41IDlIMTN6Ii8+PC9zdmc+',
  shield: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzIyYzU1ZSIgZD0iTTEyIDFMMyA1djZjMCA1LjU1IDMuODQgMTAuNzQgOSAxMiA1LjE2LTEuMjYgOS02LjQ1IDktMTJWNWwtOS00eiIvPjwvc3ZnPg==',
  logout: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2VmNDQ0NCIgZD0iTTE3IDdsLTEuNDEgMS40MUwxOC4xNyAxMUg4djJoMTAuMTdsLTIuNTggMi41OEwxNyAxN2w1LTV6TTQgNWg4VjNINGMtMS4xIDAtMiAuOS0yIDJ2MTRjMCAxLjEuOSAyIDIgMmg4di0ySDRWNXoiLz48L3N2Zz4=',
  chevron: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2I5YThkNCIgZD0iTTEwIDZMOC41OSA3LjQxIDEzLjE3IDEybC00LjU4IDQuNTlMMTAgMThsNi02eiIvPjwvc3ZnPg==',
  // ↓ 新增 AI 能力（换背景 / 发型发色）的卡片图标
  aiBg: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzhiNWNmNiIgZD0iTTE5IDNINWEyIDIgMCAwIDAtMiAydjE0YTIgMiAwIDAgMCAyIDJoMTRhMiAyIDAgMCAwIDItMlY1YTIgMiAwIDAgMC0yLTJ6bS05LjUgNS41YTEuNSAxLjUgMCAxIDEgMC0zIDEuNSAxLjUgMCAwIDEgMCAzek0xOSAxOUg1bDQuNS02IDMgNCAyLjUtMyA0IDV6Ii8+PC9zdmc+',
  aiHair: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2VjNDg5OSIgZD0iTTEyIDEyYTQuNSA0LjUgMCAwIDAgNC41LTQuNUMxNi41IDUuMDEgMTQuNDkgMyAxMiAzUzcuNSA1LjAxIDcuNSA3LjUgOS41MSAxMiAxMiAxMnptMCAxLjVjLTMuMzEgMC02IDEuNzktNiA0VjIwaDEydi0yLjVjMC0yLjIxLTIuNjktNC02LTR6Ii8+PC9zdmc+',
}

// 顶部「通知」弹层的公告内容 —— **前端静态文案**（后端消息中心为 [规划]，见 README 13 章）。
// tag 是展示给用户的中文短标签（同 AI 卡片胶囊口径，不暴露内部标识）
const NOTICE_LIST = [
  { id: 1, tag: '公告', title: '欢迎使用 Hi.cut', desc: '拍照、导入或直接点 AI 能力卡，选一张图就能开始创作。' },
  { id: 2, tag: '功能', title: '六项 AI 能力已全部可用', desc: '智能抠图 / 风格迁移 / 画质修复 / AI 美颜 / 换背景 / 发型发色 已接通百炼，每项能力每天有独立额度。' },
  { id: 3, tag: '功能', title: 'AI 智能处理支持对话修图', desc: '首页「AI 智能处理 · 聊天 ›」可以直接说需求、传照片，AI 会帮你出图。' },
  { id: 4, tag: '提示', title: '相机页新增 8 种相框', desc: '取景时选好相框，拍摄或选图后会自动带入编辑页，所见即所得。' },
]

// 本地「已读」标记：通知弹层打开过一次即写入，铃铛上的未读小红点随之消失
const NOTICE_READ_KEY = 'notice_read'

// AI 能力（与后端 /api/ai/<ability> 对应）—— 首页实际渲染的只有前三项：
// AI_LIST[0]/[1] 是「核心入口区」的两张竖排小卡（index.wxml 的 `wx:if="{{index < 2}}"`）、
// `beauty` 是「AI 美颜」卡。其余项保留不是摆设：本数组与编辑页 AI_ABILITIES **顺序必须一致**
// （见 README 11.3 第 31 / 53 条），两处都以「append 到末尾」维护能力清单。
// bg：hero 卡片内装饰底图（25% 不透明度弱氛围图）。
// 注：`desc` / `tag` 原先只喂给「AI 智能处理」横排卡片，M60 删除该排卡片后
// 随之删掉，避免留下没有消费方的死数据（口径同 M50 删 works.js 的 data.BASE_URL）。
const AI_LIST = [
  { key: 'matting', name: '智能抠图', icon: ICON.scissors, bg: '/assets/cards/matting.jpg' },
  { key: 'style', name: '风格迁移', icon: ICON.palette, bg: '/assets/cards/style.jpg' },
  { key: 'enhance', name: '画质修复', icon: ICON.magnify },
  { key: 'beauty', name: 'AI 美颜', icon: ICON.sparkle, bg: '/assets/cards/beauty.jpg' },
  // ⚠️ 新能力必须 append 到末尾：前两项被「核心入口区」当作两张竖排小卡
  // （index.wxml 的 `wx:if="{{index < 2}}"`），插到前面会顶掉「智能抠图 / 风格迁移」。
  // 顺序与编辑页 AI_ABILITIES 保持一致（见 README 11.3 第 31 条）。
  { key: 'background', name: '换背景', icon: ICON.aiBg },
  { key: 'hair', name: '发型发色', icon: ICON.aiHair },
]

// 美颜/贴纸四宫格
// ability：磨皮 / 美白 即「AI 美颜」这一个能力（后端 `ABILITY_SPECS.beauty` 的固定指令就是
// 「适度磨皮、提亮肤色美白」），带上后选图直达编辑页的 AI 美颜功能栏（口径同 AI 卡片）；
// panel ：贴纸两项落到编辑页的「贴纸」底部面板（见 8.10 / M54），选图后**直达**该面板
const BEAUTY_LIST = [
  { key: 'smooth', name: '磨皮', icon: ICON.wand, ability: 'beauty' },
  { key: 'whiten', name: '美白', icon: ICON.drop, ability: 'beauty' },
  { key: 'stickerLib', name: '贴纸库', icon: ICON.smile, panel: 'sticker' },
  { key: 'stickerAdd', name: '贴纸叠加', icon: ICON.layers, panel: 'sticker' },
]

// 工具面板（「工具 · 全部 >」底部弹层，4 列网格）。
// **每一项都必须有明确落点**（M54）：条目上的 ability / panel 决定「选图进编辑页后落在哪里」——
//   action = template   → 模板页（整页切换，不选图）
//   ability = <能力>    → 编辑页的该 AI 功能栏（AI 四项 + 磨皮/美白 → beauty）
//   panel   = <面板名>  → 编辑页的该底部工具面板（文字 text / 涂鸦 doodle / 贴纸 sticker）
// 三者都没有的条目就是「点了没反应的入口」，必须删掉而不是用 toast 占位：
// 原「背景」项（`action: 'todo'`，点击只弹「功能开发中」）没有对应功能页面，已删除。
const TOOL_LIST = [
  { key: 'template', name: '模板', tag: '新建', cls: 'new', icon: ICON.tpl, action: 'template' },
  { key: 'text', name: '文字', tag: '新建', cls: 'new', icon: ICON.text, action: 'edit', panel: 'text' },
  { key: 'draw', name: '涂鸦', tag: '新建', cls: 'new', icon: ICON.draw, action: 'edit', panel: 'doodle' },
  { key: 'matting', name: '智能抠图', tag: 'AI', cls: 'ai', icon: ICON.scissors, action: 'edit', ability: 'matting' },
  { key: 'style', name: '风格迁移', tag: 'AI', cls: 'ai', icon: ICON.palette, action: 'edit', ability: 'style' },
  { key: 'enhance', name: '画质修复', tag: 'AI', cls: 'ai', icon: ICON.magnify, action: 'edit', ability: 'enhance' },
  { key: 'beauty', name: 'AI 美颜', tag: 'AI', cls: 'ai', icon: ICON.sparkle, action: 'edit', ability: 'beauty' },
  { key: 'smooth', name: '磨皮', tag: '', cls: '', icon: ICON.wand, action: 'edit', ability: 'beauty' },
  { key: 'whiten', name: '美白', tag: '', cls: '', icon: ICON.drop, action: 'edit', ability: 'beauty' },
  { key: 'stickerLib', name: '贴纸库', tag: '', cls: '', icon: ICON.smile, action: 'edit', panel: 'sticker' },
  { key: 'stickerAdd', name: '贴纸叠加', tag: '', cls: '', icon: ICON.layers, action: 'edit', panel: 'sticker' },
  // ability 显式写出、不靠 key 推断（口径同 M38 ①；避免以后改 key 时行为静默漂移）
  { key: 'background', name: '换背景', tag: 'AI', cls: 'ai', icon: ICON.aiBg, action: 'edit', ability: 'background' },
  { key: 'hair', name: '发型发色', tag: 'AI', cls: 'ai', icon: ICON.aiHair, action: 'edit', ability: 'hair' },
]

Page({
  data: {
    topPadding: 20,
    tabBarHeight: 90,                       // 底部导航占位高度（px）：onLoad 算出，做 .page-root 的 padding-bottom
    importIcon: ICON.upload,                // 核心入口「导入」图标
    importBg: '/assets/cards/album.jpg',    // 「导入」卡片内装饰底图（相册网格示意）
    beautyCard: AI_LIST.find((x) => x.key === 'beauty') || {},
    aiList: AI_LIST,
    beautyList: BEAUTY_LIST,
    toolItems: TOOL_LIST,
    panelShow: false,    // 工具面板（底部弹层）开关
    dragY: 2000,         // 面板垂直位移（px）；初始放屏外，仅在点「全部 >」后落位
    foldY: 0,            // 折叠档位位移（默认只露 ~2 行，上拖全展开）
    dragging: false,     // 拖动中（禁用过渡，跟手）
    recentWorks: [],
    worksLoaded: false,
    entrance: false,     // 登录转场入场动画（仅 ?from=login 时启用）
    icons: ICON,         // 设置弹层的菜单图标
    noticeList: NOTICE_LIST,
    noticeUnread: false, // 铃铛未读小红点（本地 notice_read 标记）
    noticeShow: false,   // 「通知」弹层开关
    settingShow: false,  // 「设置」弹层开关
    popAnim: false,      // 弹层抬起动画开关（挂载后再置 true 才有滑入效果）
  },

  onLoad(options) {
    // 存活标记：onShow 发起的请求（loadRecentWorks）可能在页面销毁后才回来，
    // 晚到的响应会 setData 到已卸载页面（口径同 template.js 的 _alive）
    this._alive = true
    this.winH = wx.getWindowInfo().windowHeight || 700
    const topPadding = getSafeTop()
    this.setData({
      // 顶部内边距：避开右上角胶囊按钮（登录页转场落点公式也引用同一 getSafeTop 计算）
      topPadding,
      // 底部导航的真实占位高度（px）：做 .page-root 的 padding-bottom，
      // 滚动区（flex:1）因此不会伸进导航栏区域（与聊天页「根节点 flex 定高」同口径）
      tabBarHeight: getTabBarHeight(),
      // 面板初始在屏外，避免登录进入后被常驻的全展面板盖住
      dragY: this.winH + 200,
      // 登录页转场接力：镜头飞抵摄像头位 + 方块背景铺屏后，首页区块依次淡入弹出
      entrance: !!(options && options.from === 'login'),
      // 未读通知小红点：只认本地标记（没有后端消息中心，见 NOTICE_LIST 注释）
      noticeUnread: !wx.getStorageSync(NOTICE_READ_KEY),
    })
  },

  onShow() {
    this.loadRecentWorks()
  },

  /** 最近作品（前 6 条，横向滚动） */
  loadRecentWorks() {
    // onShow 每次回到首页都会调用它（首页 ⇄ 编辑页来回切）：请求在途时直接跳过，
    // 避免请求叠加与「晚到的旧响应覆盖新响应」；失败时也不再连续弹条 toast
    if (this._worksReq) return
    this._worksReq = true
    request({ url: '/api/works?page=1&size=6' })
      .then((res) => {
        if (!this._alive) return
        // res.data 兜空对象：接口返回非统一结构时不抛 TypeError（否则页面弹的是英文报错串）
        const d = res.data || {}
        const recentWorks = (d.items || []).map((w) => ({
          ...w,
          fullImage: absoluteUrl(w.thumb_path || w.image_path),
          typeLabel: workTypeLabel(w.type),
        }))
        this.setData({ recentWorks, worksLoaded: true })
      })
      .catch((err) => {
        if (!this._alive) return
        // 失败也要落下 worksLoaded（否则这一块永远停在加载态），但要给原因：
        // 「加载失败」与「确实还没有作品」在界面上一模一样，用户会以为作品丢了（见 11.3 第 46 条）
        this.setData({ worksLoaded: true })
        wx.showToast({ title: (err && err.message) || '作品加载失败', icon: 'none' })
      })
      .finally(() => {
        this._worksReq = false
      })
  },

  /** 拍照：直接调起相机 → 编辑页 */
  onTakePhoto() {
    // 进入自研竖屏相机拍摄页（M9），拍摄后进入编辑页
    wx.navigateTo({ url: '/pages/camera/camera' })
  },

  /** 导入：从相册选图 → 编辑页 */
  onImport() {
    this.chooseMedia(['album'])
  },

  /**
   * 统一点击选图后进入编辑页（拍照/导入/AI 能力/美颜贴纸均走此流程）。
   * 卡片带 `data-ability` 时（AI 四项 + 磨皮/美白）把能力标识带给编辑页 → 直达对应 AI 功能栏；
   * 带 `data-panel` 时（贴纸库/贴纸叠加）把面板名带给编辑页 → 直达「贴纸」底部面板。
   */
  goEditWithImage(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    this.chooseMedia(['album', 'camera'], ds.ability, ds.panel)
  },

  /**
   * 选图并进入编辑页。
   * ability（AI 能力 key）/ panel（工具面板名）都会随 URL 带给编辑页，
   * 编辑页各自做白名单校验 + 一次性消费后**直达**对应落点（见 consumeAiEntry / consumePanelEntry）。
   */
  chooseMedia(sourceType, ability, panel) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType,
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (path) {
          // 图片经入参直传编辑页（含选择时刻，编辑页头部日期时间使用）
          const extra =
            (ability ? `&ai=${ability}` : '') + (panel ? `&panel=${panel}` : '')
          const direct = !!(ability || panel)
          wx.navigateTo({
            url: `/pages/editor/editor?imagePath=${encodeURIComponent(path)}&captureTime=${Date.now()}${extra}`,
            // 直达入口（带 ai / panel）用 `none`：**不做页面转场动画**。
            // 首页是 Skyline、编辑页是 WebView（页面级 renderer），新页首帧常常晚于转场开始：
            // 位移动画 / 淡入都会让旧首页与新页的图层混在一帧里（「先看到当前页面，再出现黑幕」）。
            // 直接切换后，旧页立刻消失，新页由自己的首帧（DOM 占位图 + 已就位的功能栏）接上。
            // 「导入」不带参数，保持默认动画不变。
            ...(direct ? { animationType: 'none' } : {}),
          })
        }
      },
    })
  },

  goWorks() {
    wx.navigateTo({ url: '/pages/works/works' })
  },

  /**
   * 最近作品卡片：带着这张已保存的图**直接进编辑页**接着改。
   * 此前整张卡片跳的是「我的作品」列表，用户点自己的作品只能看、改不了；
   * 传作品的**原图**（image_path），编辑页加载网络图与模板叠加同一口径（absoluteUrl）。
   */
  onEditWork(e) {
    const id = Number(e.currentTarget.dataset.id)
    const work = (this.data.recentWorks || []).find((w) => w.id === id)
    const path = work && (work.image_path || work.thumb_path)
    if (!path) {
      wx.showToast({ title: '该作品图片不可用', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/editor/editor?imagePath=${encodeURIComponent(absoluteUrl(path))}`,
    })
  },

  /** 「AI 智能处理」区块右上角入口：进入 AI 对话页（见 README 7.4） */
  goChat() {
    wx.navigateTo({ url: '/pages/chat/chat' })
  },

  /* ===== 顶部「通知」/「设置」弹层 ===== */

  /**
   * 打开弹层（key = 'noticeShow' / 'settingShow'）：
   * 先挂载（此时面板在屏外 + 遮罩透明）→ 下一帧再抬起，滑入/淡入才看得到；
   * 两个弹层共用一套遮罩，故打开一个时把另一个立刻卸载（否则会叠在一起）。
   */
  openPop(key) {
    if (this._popTimer) clearTimeout(this._popTimer)
    const other = key === 'noticeShow' ? 'settingShow' : 'noticeShow'
    this.setData({ [key]: true, [other]: false, popAnim: false })
    wx.nextTick(() => this.setData({ popAnim: true }))
  },

  /** 关闭弹层（遮罩 / 关闭钮 / 设置各项共用）：先滑出，动画结束再卸载 */
  onClosePop() {
    if (!this.data.noticeShow && !this.data.settingShow) return
    if (this._popTimer) clearTimeout(this._popTimer)
    this.setData({ popAnim: false })
    this._popTimer = setTimeout(() => this.setData({ noticeShow: false, settingShow: false }), 320)
  },

  /** 铃铛：打开通知列表；打开即视为已读（小红点消失并记进本地） */
  onOpenNotice() {
    this.openPop('noticeShow')
    if (!wx.getStorageSync(NOTICE_READ_KEY)) {
      wx.setStorageSync(NOTICE_READ_KEY, 1)
      this.setData({ noticeUnread: false })
    }
  },

  /** 齿轮：打开设置弹层 */
  onOpenSetting() {
    this.openPop('settingShow')
  },

  /** 设置 → 用户协议 / 隐私政策（路径与参数同个人页，复用同一个静态长文页） */
  goAgreement(e) {
    const { type } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/agreement/agreement?type=${type}` })
  },

  /**
   * 设置 → 清除缓存：清空本地缓存，但**保留登录凭证与已读标记**。
   * 注意不能只清「token 之外」的东西 —— 当前本地本就只存 token 与 notice_read，
   * 那样等于空操作；所以先把要保留的取出来，清完再写回。
   */
  onClearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清理本地缓存的图片与列表数据，不影响登录状态与云端作品。',
      confirmColor: '#8b5cf6',
      success: (res) => {
        if (!res.confirm) return
        const access = wx.getStorageSync(TOKEN_KEY)
        const refresh = wx.getStorageSync(REFRESH_KEY)
        const noticeRead = wx.getStorageSync(NOTICE_READ_KEY)
        try {
          wx.clearStorageSync()
        } catch (e) {
          // 清缓存失败不影响使用，静默忽略
        }
        if (access) wx.setStorageSync(TOKEN_KEY, access)
        if (refresh) wx.setStorageSync(REFRESH_KEY, refresh)
        if (noticeRead) wx.setStorageSync(NOTICE_READ_KEY, noticeRead)
        wx.showToast({ title: '缓存已清理', icon: 'success' })
      },
    })
  },

  /** 设置 → 退出登录（口径同个人页：确认后清 token 回登录页） */
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        clearToken()
        wx.reLaunch({ url: '/pages/login/login' })
      },
    })
  },

  /** 打开工具面板（工具区「全部 >」）：先藏到屏外，测量后落入「折叠位」（露出约 2 行） */
  onOpenPanel() {
    if (this._hideTimer) clearTimeout(this._hideTimer)
    if (this.data.panelShow) {
      this.setData({ dragging: false, dragY: this.data.foldY })
      return
    }
    this.setData({ panelShow: true, dragging: true, dragY: this.winH + 200 })
    wx.nextTick(() => {
      const q = wx.createSelectorQuery()
      q.select('.sheet-panel').boundingClientRect()
      q.select('.sheet-head').boundingClientRect()
      q.select('.tool-cell').boundingClientRect()
      q.exec((res) => {
        const H = (res[0] && res[0].height) || 0
        const hh = (res[1] && res[1].height) || 72
        const ch = (res[2] && res[2].height) || 110
        this.panelH = H
        // 测量失败时兜底：折叠位约为屏高 40%
        let foldY = H > 0 ? Math.max(0, H - (hh + 2 * ch + 56)) : Math.round(this.winH * 0.4)
        this.foldY = foldY
        this.setData({ dragging: false, foldY, dragY: foldY })
      })
    })
  },

  /** 关闭工具面板（点遮罩 / 工具项点击 / 下拖过距）：滑出屏幕后隐藏 */
  onClosePanel() {
    if (!this.data.panelShow) return
    if (this._hideTimer) clearTimeout(this._hideTimer)
    this.setData({ dragging: false, dragY: this.winH + 200 })
    this._hideTimer = setTimeout(() => this.setData({ panelShow: false }), 330)
  },

  onUnload() {
    this._alive = false
    // 面板滑出 / 弹层收起用的定时器不受页面生命周期约束：页面销毁后它们仍会回来 setData
    if (this._hideTimer) {
      clearTimeout(this._hideTimer)
      this._hideTimer = null
    }
    if (this._popTimer) {
      clearTimeout(this._popTimer)
      this._popTimer = null
    }
  },

  onSheetTouchStart(e) {
    if (!this.data.panelShow) return
    const t = e.touches && e.touches[0]
    if (!t) return
    this._st = { y: t.clientY, dragY: this.data.dragY, moved: false }
    this.setData({ dragging: true })
  },

  onSheetTouchMove(e) {
    if (!this._st) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const dy = t.clientY - this._st.y
    if (Math.abs(dy) > 6) this._st.moved = true
    let v = this._st.dragY + dy
    if (v < -60) v = -60 + (v + 60) * 0.2 // 顶部阻尼（向上越过全展开）
    const maxY = this.winH + 200
    if (v > maxY) v = maxY
    // 位移先记下来，松手时用它吸附（见 onSheetTouchEnd）
    this._st.pendingY = v
    // touchmove 一帧内可能触发多次：每次都 setData 会让逻辑层与渲染层一起堆积（拖动手感发涩）。
    // 这里按约 1 帧（16ms）节流，只提交这一段位移里最后算出的位置。
    const now = Date.now()
    if (this._st.ts && now - this._st.ts < 16) return
    this._st.ts = now
    this.setData({ dragY: v })
  },

  onSheetTouchEnd() {
    if (!this._st) return
    const moved = this._st.moved
    // 用 pendingY 而不是 data.dragY：最后几次位移可能被上面的节流吃掉，
    // 直接读 dragY 会让「松手瞬间面板跳回上一帧的位置」，吸附判定也少算这一段
    const y = this._st.pendingY != null ? this._st.pendingY : this.data.dragY
    this._st = null
    this.setData({ dragging: false })
    if (!moved) return // 未拖动视为点击，交子节点 tap 处理
    if (y < this.data.foldY - 60) {
      // 上拖过阈：全展开
      this.setData({ dragY: 0 })
    } else if (y > this.data.foldY + 80) {
      // 下拖过阈：关闭
      this.onClosePanel()
    } else {
      // 回弹到折叠档
      this.setData({ dragY: this.data.foldY })
    }
  },

  /** 面板项点击：按 action 分发（template 模板页 / edit 选图进编辑页并落到 ability 或 panel 指定处） */
  onToolTap(e) {
    const item = this.data.toolItems.find((x) => x.key === e.currentTarget.dataset.key)
    if (!item) return
    this.onClosePanel()
    if (item.action === 'template') {
      wx.redirectTo({ url: '/pages/template/template' })
      return
    }
    // 其余均可跳转：带 ability 的直达对应 AI 功能栏，带 panel 的直达对应工具面板
    // （**没有落点的条目已从 TOOL_LIST 删除**，故这里不再需要「功能开发中」的占位分支）
    this.chooseMedia(['album', 'camera'], item.ability, item.panel)
  },
})
