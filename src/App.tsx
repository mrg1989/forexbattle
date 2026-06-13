import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ChartSandbox from './pages/ChartSandbox'
import ResearchDashboard from './pages/ResearchDashboard'

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-full">
        <Routes>
          <Route path="/" element={<ChartSandbox />} />
          <Route path="/research" element={<ResearchDashboard />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
