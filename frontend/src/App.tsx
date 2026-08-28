import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ChatLayout from './layouts/ChatLayout'
import ChatPage from './pages/ChatPage'
import DashboardPage from './pages/DashboardPage'
import DataExplorerPage from './pages/DataExplorerPage'
import SettingsPage from './pages/SettingsPage'
import DataConnectionPage from './pages/DataConnectionPage'
import SkillShopPage from './pages/SkillShopPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import SessionsPage from './pages/SessionsPage'
import LoginPage from './pages/LoginPage'
import { useUserStore } from './stores/userStore'

export default function App() {
  const { status, feishuEnabled, authenticated, init } = useUserStore()

  useEffect(() => {
    void init()
  }, [init])

  // Feishu login gate: only active when the backend has login configured.
  // While checking (or when the backend is down) the app is not blocked.
  if (status === 'ready' && feishuEnabled && !authenticated) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/*" element={<ChatLayout />}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="data-explorer" element={<DataExplorerPage />} />
        <Route path="data-connection" element={<DataConnectionPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="skill-shop" element={<SkillShopPage />} />
        <Route path="knowledge-base" element={<KnowledgeBasePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route index element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}