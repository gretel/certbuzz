import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Dozent } from './pages/Dozent';
import { GameSession } from './pages/GameSession';
import { Leaderboard } from './pages/Leaderboard';
import { BuzzerArena } from './pages/BuzzerArena';
import { useSocket } from './hooks/useSocket';
import { ConnectionStatusBanner } from './components/shared/ConnectionStatus';

function App() {
  useSocket(); // Initialize socket connection

  return (
    <BrowserRouter>
      <ConnectionStatusBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dozent" element={<Dozent />} />
        <Route path="/session/:code" element={<GameSession />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/arena/:code" element={<BuzzerArena />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
