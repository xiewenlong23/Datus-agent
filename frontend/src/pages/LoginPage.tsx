import { useState } from 'react'
import { loginWithFeishu, loginErrorFromUrl } from '../services/auth'

const ERROR_TEXTS: Record<string, string> = {
  missing_code: '飞书未返回授权码,请重试。',
  bad_state: '登录状态校验失败(可能页面停留过久),请重试。',
  token_exchange_failed: '向飞书换取登录凭证失败,请检查网络后重试。',
  token_rejected: '飞书拒绝了授权码,请重试;若持续失败请确认应用配置。',
  no_access_token: '飞书未返回登录凭证,请重试。',
  user_info_failed: '获取飞书用户信息失败,请检查网络后重试。',
  user_info_rejected: '飞书拒绝提供用户信息,请确认应用已开通相关权限。',
  no_open_id: '飞书未返回用户身份,请重试。',
}

export default function LoginPage() {
  const [error] = useState<string | null>(() => loginErrorFromUrl())

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="/favicon.svg" alt="Datus" />
        </div>
        <h1 className="login-title">登录 Datus</h1>
        <p className="login-subtitle">使用飞书扫码登录,登录后只能看到自己的会话。</p>
        {error && <div className="login-error">{ERROR_TEXTS[error] || `登录失败:${error}`}</div>}
        <button className="login-btn" onClick={loginWithFeishu}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="9" y="9" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
            <rect x="13" y="9" width="2" height="6" rx="0.5" fill="currentColor" />
            <rect x="9" y="13" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
          </svg>
          飞书扫码登录
        </button>
      </div>
    </div>
  )
}
