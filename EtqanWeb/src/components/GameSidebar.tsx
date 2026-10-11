import type { RadarEntry, WinnerSlot } from '../types';

interface Props {
  radar: RadarEntry[];
  winnerSlots: WinnerSlot[];
  completed: number;
  bingoPatterns: number;
}

function slotsFor(allSlots: WinnerSlot[], winnerType: WinnerSlot['winnerType'], count: number): WinnerSlot[] {
  return Array.from({ length: count }, (_, index) => allSlots.find(slot => slot.winnerType === winnerType && slot.slot === index + 1) ?? {
    slot: index + 1,
    playerName: null,
    winnerType,
    prize: winnerType === 'grand' ? 'RM100 Voucher' : winnerType === 'bingo' ? 'RM10 prize each' : 'Ultimate Winner'
  });
}

function WinnerSlotGroup({ title, detail, slots, className }: { title: string; detail: string; slots: WinnerSlot[]; className: string }) {
  return <div className={`winner-group ${className}`}>
    <div className="winner-group-heading"><span className="winner-group-count">{slots.length}</span><div><b>{title}</b><small>{detail}</small></div></div>
    <div className="winner-slot-list">
      {slots.map(slot => <div className={`winner-slot ${slot.playerName ? 'filled' : ''}`} key={`${slot.winnerType}-${slot.slot}`}><span>{slot.slot}</span><strong>{slot.playerName || 'Awaiting winner'}</strong></div>)}
    </div>
  </div>;
}

export function GameSidebar({ radar, winnerSlots, completed, bingoPatterns }: Props) {
  const rewardStatus = completed === 36
    ? 'Grand Ultimate — 1 winner'
    : bingoPatterns >= 3
      ? `Ultimate — ${bingoPatterns} Bingo patterns completed`
      : bingoPatterns > 0
        ? 'Bingo — Top 10 places'
        : 'Not qualified yet';
  const bingoSlots = slotsFor(winnerSlots, 'bingo', 10);
  const ultimateSlots = slotsFor(winnerSlots, 'ultimate', 5);
  const grandSlots = slotsFor(winnerSlots, 'grand', 1);

  return <aside className="game-right-column">
    <section className="game-panel radar-panel">
      <div className="right-title"><h2>Winners Radar</h2><span>Live</span></div>
      <div className="radar-summary">◉ Monitoring confirmed ETIQAN cards</div>
      {radar.length === 0
        ? <div className="radar-empty">Waiting for confirmed ETIQAN cards</div>
        : radar.map(entry => <div className="radar-row" key={entry.id}><span>• {entry.id}</span><b>{entry.distanceLabel}</b></div>)}
    </section>

    <section className="game-panel winner-slot-panel">
      <div className="right-title"><h2>Winner Slot</h2><span>Round 12</span></div>
      <p className="winner-slot-note">One participant can receive one prize only.</p>
      <WinnerSlotGroup title="Grand Ultimate Winner" detail="RM100 Voucher" slots={grandSlots} className="grand-group" />
      <WinnerSlotGroup title="Ultimate Winners" detail="5 winners • complete 3 patterns" slots={ultimateSlots} className="ultimate-group" />
      <WinnerSlotGroup title="Top 10 Bingo Winners" detail="RM10 prize each" slots={bingoSlots} className="bingo-group" />
    </section>

    <section className="game-panel prize-panel">
      <div className="right-title"><h2>Weekly Prize Allocation</h2><span>🏅</span></div>
      <div className="prize-tier bingo-tier"><div className="prize-tier-icon">10</div><div><b>Top 10 Bingo Winners</b><small>RM10 prize each</small></div><span className="prize-tier-rule">1 row, column or cross</span></div>
      <div className="prize-tier ultimate-tier"><div className="prize-tier-icon">5</div><div><b>Ultimate Winners</b><small>5 winners</small></div><span className="prize-tier-rule">Complete any 3 Bingo patterns</span></div>
      <div className="prize-tier grand-tier"><div className="prize-tier-icon">1</div><div><b>Grand Ultimate Winner</b><small>RM100 Voucher</small></div><span className="prize-tier-rule">Complete all questions</span></div>
      <div className="prize-status"><b>YOUR REWARD STATUS</b><span>{rewardStatus}</span></div>
    </section>
  </aside>;
}
