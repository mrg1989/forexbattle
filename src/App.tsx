import { useGameStore } from './store/gameStore'
import Landing from './pages/Landing'
import Lobby from './pages/Lobby'
import WaitingRoom from './pages/WaitingRoom'
import Game from './pages/Game'
import Results from './pages/Results'
import ChartSandbox from './pages/ChartSandbox'

export default function App() {
  const screen = useGameStore(s => s.screen)

  return (
    <div className="h-full">
      {screen === 'landing' && <Landing />}
      {screen === 'lobby'   && <Lobby />}
      {screen === 'waiting' && <WaitingRoom />}
      {screen === 'game'    && <Game />}
      {screen === 'results' && <Results />}
      {screen === 'chart'   && <ChartSandbox />}
    </div>
  )
}
