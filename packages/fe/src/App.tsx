import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import AuthForm from './components/AuthForm'
import AdminPage from './pages/AdminPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
      <Route path="/login" element={<AuthForm mode="login" />} />
      <Route path="/register" element={<AuthForm mode="register" />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  )
}
