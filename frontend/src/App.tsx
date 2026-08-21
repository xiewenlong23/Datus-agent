import { Routes, Route, Navigate } from 'react-router-dom'
import ChatLayout from './layouts/ChatLayout'
import ChatPage from './pages/ChatPage'
import DataConnectionPage from './pages/DataConnectionPage'
import SkillShopPage from './pages/SkillShopPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="/chat" element={<ChatLayout />}>
        <Route index element={<ChatPage />} />
      </Route>
      <Route path="/data-connection" element={<DataConnectionPage />} />
      <Route path="/skill-shop" element={<SkillShopPage />} />
      <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
    </Routes>
  )
}