type WinnerType = 'bingo' | 'ultimate' | 'grand';

interface Props {
  winnerType: WinnerType;
  patterns: string[];
  bingoCount: number;
  onClose: () => void;
}

const content: Record<WinnerType, { title: string; message: string; prize: string; badge: string }> = {
  bingo: {
    title: 'Bingo Winner!',
    message: 'Congratulations! You have completed a Bingo pattern.',
    prize: 'You are now qualified for the Top 10 Bingo Winners: RM10 prize.',
    badge: 'BINGO'
  },
  ultimate: {
    title: 'Ultimate Winner!',
    message: 'Congratulations! You have completed 3 Bingo patterns.',
    prize: 'You are now qualified for the 5 Ultimate Winner places.',
    badge: 'ULTIMATE'
  },
  grand: {
    title: 'Grand Ultimate Winner!',
    message: 'Congratulations! You have completed all ETIQAN questions.',
    prize: 'Your prize is an RM100 voucher.',
    badge: 'GRAND ULTIMATE'
  }
};

export function WinnerModal({ winnerType, patterns, bingoCount, onClose }: Props) {
  const details = content[winnerType];

  return <div className="modal-backdrop winner-backdrop" onClick={onClose}>
    <section className={`winner-modal ${winnerType}-winner`} onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="winner-title">
      <button className="close-button" onClick={onClose} aria-label="Close winner announcement">×</button>
      <div className="winner-badge" aria-hidden="true">&#127942;</div>
      <small className="winner-kicker">ETIQAN CHALLENGE</small>
      <div className="winner-level">{details.badge}</div>
      <h2 id="winner-title">{details.title}</h2>
      <p>{details.message}</p>
      <strong className="winner-prize">{details.prize}</strong>
      <small className="winner-patterns">{bingoCount} pattern{bingoCount === 1 ? '' : 's'} completed: {patterns.join(', ')}</small>
      <button className="primary-button winner-continue" onClick={onClose}>Continue Playing</button>
    </section>
  </div>;
}
