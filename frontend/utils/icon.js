// utils/icon.js — SVG 字符串 → base64 data URI 的**唯一实现**
//
// 相机页与编辑页原先各写了一份逐字符相同的 `svgBase64()`，两处都靠「复制粘贴保持一致」——
// 一旦有一边改了（例如补上 UTF-8 处理），就会出现「一个页面图标正常、另一个变裂图」的漂移，
// 且排查时很难联想到是重复实现导致的（口径同 README 11.3 第 48 条）。
//
// 为什么不用 `btoa` / 直接传字符串：小程序环境没有 `btoa`，而 `wx.arrayBufferToBase64`
// 只接受 ArrayBuffer —— 所以先把 `encodeURIComponent` 产出的 %XX 还原成字节装进 Uint8Array，
// 再交给它编码（这样中文/非 ASCII 内容也不会编坏）。
function svgBase64(content) {
  const enc = encodeURIComponent(content)
  const bytes = enc.replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return 'data:image/svg+xml;base64,' + wx.arrayBufferToBase64(arr.buffer)
}

module.exports = { svgBase64 }
