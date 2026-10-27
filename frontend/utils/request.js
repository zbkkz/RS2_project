// utils/request.js
// 统一网络请求封装：自动携带 token、统一响应解包、401 自动刷新并重放
//
// BASE_URL 必须是**电脑的局域网 IP**（模拟器与真机都能访问）：
//   ⚠️ 不要用 127.0.0.1 做真机联调 —— 它在本机模拟器上指向电脑、能通，
//      但在真机上指向**手机自己**，请求直接 fail，前端统一提示「网络异常」
//      （真机登录失败最常见的原因，排查步骤见 README 11.3 第 6 条 / M32）。
// 查本机 IP：PowerShell 执行 `ipconfig`，取 WLAN 网卡的 IPv4（必须与下面 BASE_URL 保持一致）。
// 注意 IP 由 DHCP 分配，换网络/重启路由后可能变化，届时改这一行即可；改了之后
// **必须重新确认它能通**（浏览器打开 http://<IP>:5000/api/ping 应返回 pong）。
// 正式环境必须换成 HTTPS 域名，并在微信公众平台配置为合法域名。
// 2026-10 复核：本机 WLAN 网卡 IPv4 为 172.16.9.229（`ipconfig` 实查）。IP 由 DHCP 分配，
// 换网 / 重启路由就可能变 —— 变更后**必须**用浏览器打开 http://<IP>:5000/api/ping 确认返回 pong。
const BASE_URL = 'http://172.16.9.229:5000'

const TOKEN_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'

// 刷新锁：避免并发请求同时触发多次 refresh
let refreshing = false
let refreshWaiters = []

function getStorage(key) {
  try {
    return wx.getStorageSync(key) || ''
  } catch (e) {
    return ''
  }
}

function setStorage(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    // ignore
  }
}

function clearToken() {
  wx.removeStorageSync(TOKEN_KEY)
  wx.removeStorageSync(REFRESH_KEY)
}

/** 刷新 access_token；返回新 token 或抛出错误 */
function refreshAccessToken() {
  const refreshToken = getStorage(REFRESH_KEY)
  if (!refreshToken) {
    return Promise.reject(new Error('NO_REFRESH'))
  }
  if (refreshing) {
    // 已有刷新在进行，等待其结果
    return new Promise((resolve, reject) => {
      refreshWaiters.push({ resolve, reject })
    })
  }
  refreshing = true
  let newToken = ''
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/api/auth/refresh`,
      method: 'POST',
      header: { Authorization: `Bearer ${refreshToken}` },
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 200 && body.code === 0) {
          newToken = body.data.access_token
          setStorage(TOKEN_KEY, newToken)
          resolve(newToken)
        } else {
          clearToken()
          reject(new Error('REFRESH_FAIL'))
        }
      },
      fail() {
        reject(new Error('NETWORK'))
      },
      complete() {
        refreshing = false
        // 刷新成功则唤醒并发等待者（携带新 token），失败才让其走登录页
        const waiters = refreshWaiters
        refreshWaiters = []
        waiters.forEach((w) => {
          if (newToken) w.resolve(newToken)
          else w.reject(new Error('REFRESH_FAIL'))
        })
      },
    })
  })
}

function toLogin() {
  clearToken()
  wx.reLaunch({ url: '/pages/login/login' })
}

/**
 * 发起请求。用法：
 *   request({ url: '/api/works', method: 'GET', data: {...} })
 *   .then(res => res.data)      // res 已解包为 { code, msg, data }
 *   .catch(err => ...)          // 业务错误与网络错误均 reject
 */
function request({ url, method = 'GET', data, auth = true, header = {}, timeout }) {
  const token = getStorage(TOKEN_KEY)
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json', ...header }
    if (auth && token) {
      headers.Authorization = `Bearer ${token}`
    }

    wx.request({
      url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
      method,
      data,
      header: headers,
      // 单请求超时（ms）：不传则用 app.json 的 networkTimeout.request。
      // 需要它的场景是「长耗时的同步 AI 请求」（聊天页出图最坏 270s，见 README 7.4）
      ...(timeout ? { timeout } : {}),
      success: (res) => {
        const body = res.data || {}
        // JWT 过期(4001)或未携带(4003)：尝试用 refresh token 刷新并重放原请求。
        // 两条分支必须分开处理：
        // ① 刷新失败（refresh token 也过期/网络异常）→ 清 token 回登录页，并把原 Promise
        //    reject —— 否则调用方的 .catch/.finally 永远不会执行（页面会一直停在「加载中」）；
        // ② 刷新成功 → **原样透传**重放请求的结果。此处不能写 `.catch(() => toLogin())`：
        //    那样会把「重放本身失败」（业务错误 2001/2004 或网络抖动）也当成登录失效，
        //    于是 token 明明有效、刷新也刚刚成功，用户却被莫名踢回登录页。
        if (res.statusCode === 401 && auth && (body.code === 4001 || body.code === 4003)) {
          refreshAccessToken().then(
            () => {
              // 重放必须带上 timeout：长耗时的 AI/聊天请求（最坏 270s）一旦在重放时丢掉它，
              // 就会退回 app.json 的 networkTimeout.request（60s）被客户端提前判失败 ——
              // 正是「客户端先放弃、服务端仍在出图且已计费」那种最难查的失败
              request({ url, method, data, auth, header, timeout }).then(resolve, reject)
            },
            () => {
              toLogin()
              reject(Object.assign(new Error('登录已过期，请重新登录'), { code: 4001 }))
            }
          )
          return
        }
        // token 无效(4002)：直接跳转登录
        if (res.statusCode === 401 && auth && body.code === 4002) {
          toLogin()
          reject(new Error(body.msg || '登录失效'))
          return
        }
        if (body.code === 0) {
          resolve(body)
        } else {
          reject(Object.assign(new Error(body.msg || '请求失败'), { code: body.code, data: body.data }))
        }
      },
      fail: (err) => reject(Object.assign(new Error('网络异常'), { code: -1, raw: err })),
    })
  })
}

/**
 * 把服务端下发的**相对路径**补成绝对地址（`<image src>` / `wx.uploadFile` 都要绝对地址）。
 *
 * 全站只有这一份拼接规则，避免各页各写一遍：
 * - 已经是 `http(s)://` 的原样返回（例如账号直接用的外链头像）；
 * - 空值 / 空串返回 `''` —— 调用方不用再写 `path ? BASE_URL + path : ''`，
 *   也不会拼出 `http://<ip>:5000undefined` 这种一看就是拼错了的脏地址（图裂还难排查）；
 * - 其余按 BASE_URL 前缀补全。
 */
function absoluteUrl(path) {
  if (!path) return ''
  const s = String(path)
  return /^https?:\/\//i.test(s) ? s : BASE_URL + s
}

module.exports = {
  request,
  absoluteUrl,
  getToken: () => getStorage(TOKEN_KEY),
  saveTokens: (access, refresh) => {
    setStorage(TOKEN_KEY, access)
    setStorage(REFRESH_KEY, refresh)
  },
  clearToken,
  // 存储键名对外导出：首页「清除缓存」需要「先取回再写回」，
  // 按同一份定义取值而不在各页手写 'access_token' 字符串（口径同 absoluteUrl）
  TOKEN_KEY,
  REFRESH_KEY,
}