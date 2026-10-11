import { useCallback, useEffect, useState } from 'react';
import { getGameSidebar, heartbeat } from './api';
import { ETIQANCard } from './components/ETIQANCard';
import { CallerStage } from './components/CallerStage';
import { GameSidebar } from './components/GameSidebar';
import { PlayerRegistration } from './components/PlayerRegistration';
import type { PlayerSession, RadarEntry, WinnerSlot } from './types';
import './styles.css';

export default function App() {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [activePlayers, setActivePlayers] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [cardReady, setCardReady] = useState(false);
  const [bingoPatterns, setBingoPatterns] = useState(0);
  const [radar, setRadar] = useState<RadarEntry[]>([]);
  const [winnerSlots, setWinnerSlots] = useState<WinnerSlot[]>([]);

  useEffect(() => {
    if (!session) return;
    void heartbeat(session.uid);
    const timer = window.setInterval(() => void heartbeat(session.uid), 60_000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const refreshSidebar = async () => {
      try {
        const sidebar = await getGameSidebar(session.uid);
        if (!cancelled) {
          setRadar(sidebar.radar);
          setWinnerSlots(sidebar.winnerSlots);
          setActivePlayers(sidebar.activePlayerCount);
        }
      } catch {
        if (!cancelled) {
          setRadar([]);
          setWinnerSlots([]);
          setActivePlayers(0);
        }
      }
    };
    void refreshSidebar();
    const timer = window.setInterval(() => void refreshSidebar(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session]);

  const onCardState = useCallback((completedCells: number, ready: boolean, patterns: number) => {
    setCompleted(completedCells);
    setCardReady(ready);
    setBingoPatterns(patterns);
  }, []);

  if (!session) return <PlayerRegistration onRegistered={setSession} />;

  return <div className="game-page">
    <header className="game-topbar">
      <div className="brand-block">
        <div className="etiqa-logo" aria-label="Etiqa">eTiQa<i /></div>
        <span className="brand-divider" />
        <div className="brand-copy"><strong>Etiqa ETIQAN Challenge</strong><small>ETIQA INSURANCE &amp; TAKAFUL</small></div>
      </div>
      <nav className="game-nav" aria-label="Main navigation">
        <a href="#overview">Campaign Overview</a>
        <a href="#card">My ETIQAN Card</a>
        <a className="active" href="#game">Live Weekly Game</a>
      </nav>
      <div className="participant-block"><span className="participant-chip">Active Participant</span><strong>{session.name}</strong></div>
    </header>

    <section className="broadcast-bar" id="game">
      <div className="broadcast-copy"><span className="live-kicker"><i /> LIVE BROADCAST</span><strong>Etiqa Weekly ETIQAN Challenge <b>•</b> Round 12</strong><small>Official game state is synchronised through SQL Server</small></div>
      <div className="broadcast-metrics">
        <span className="connected-metric"><b>CONNECTED</b><strong>{activePlayers} Active Player{activePlayers === 1 ? '' : 's'}</strong></span>
        <span><b>Always On</b><small>Game status</small></span>
        <span><b>{completed} / 36</b><small>Card progress</small></span>
        <span><b>{cardReady ? 'Ready' : 'Loading'}</b><small>Card status</small></span>
      </div>
    </section>

    <main className="game-layout" id="card">
      <CallerStage />
      <ETIQANCard playerName={session.name} onCardState={onCardState} />
      <GameSidebar radar={radar} winnerSlots={winnerSlots} completed={completed} bingoPatterns={bingoPatterns} />
    </main>
  </div>;
}
