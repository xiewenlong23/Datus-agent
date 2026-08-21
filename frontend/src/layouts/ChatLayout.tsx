import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'

export default function ChatLayout() {
  return (
    <div className="chat-layout">
      <Sidebar />
      <main className="chat-main">
        <Outlet />
      </main>
    </div>
  )
}