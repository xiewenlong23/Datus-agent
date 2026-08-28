import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import CommandPalette from '../components/CommandPalette'

export default function ChatLayout() {
  return (
    <div className="chat-layout">
      <Sidebar />
      <main className="chat-main">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  )
}