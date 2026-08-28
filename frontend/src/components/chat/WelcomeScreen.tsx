import InputBox from '../InputBox'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** Original-style welcome screen: greeting + centered large input box. */
export default function WelcomeScreen() {
  return (
    <div className="chat-welcome-screen">
      <div className="chat-welcome-inner">
        <h1 className="chat-welcome-greeting">{greeting()}，有什么想分析的？</h1>
        <p className="chat-welcome-subtitle">
          用自然语言提问，Datus 会生成并执行 SQL，逐步展示思考过程与结果。
        </p>
        <InputBox />
      </div>
    </div>
  )
}
