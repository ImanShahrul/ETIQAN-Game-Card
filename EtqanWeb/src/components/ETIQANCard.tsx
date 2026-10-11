import { useEffect, useMemo, useRef, useState } from 'react';
import { checkWinningCondition, generateCard, loadSavedCardState, retryQuestion, saveWinner, submitAnswer } from '../api';
import { QuestionModal } from './QuestionModal';
import { WinnerModal } from './WinnerModal';
import type { CardCell, EtqanLetter } from '../types';

const letters: EtqanLetter[] = ['E', 'T', 'I', 'Q', 'A', 'N'];

interface Props { playerName: string; onCardState?: (completed: number, ready: boolean, patterns: number) => void; }
type WinnerType = 'bingo' | 'ultimate' | 'grand';
interface WinnerPopupState { winnerType: WinnerType; patterns: string[]; bingoCount: number; }

export function ETIQANCard({ playerName, onCardState }: Props) {
  const [cells, setCells] = useState<CardCell[]>([]);
  const [selected, setSelected] = useState<CardCell | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [winStatus, setWinStatus] = useState('');
  const [winnerPopup, setWinnerPopup] = useState<WinnerPopupState | null>(null);
  const reportedWinners = useRef(new Set<string>());

  useEffect(() => {
    if (cells.length) return;
    let cancelled = false;
    void loadSavedCardState().then(saved => {
      if (cancelled) return;
      if (saved) { setCells(saved); return; }
      void generateCard().then(card => { if (!cancelled) setCells(card); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not generate the ETIQAN card.'));
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load the saved ETIQAN card.'));
    return () => { cancelled = true; };
  }, [cells.length]);

  const completed = cells.filter(cell => cell.isTicked).length;
  const winningPatterns = useMemo(() => {
    if (!cells.length) return 0;
    const lines = [
      ...Array.from({ length: 6 }, (_, row) => cells.filter(cell => cell.row === row)),
      ...Array.from({ length: 6 }, (_, column) => cells.filter(cell => cell.column === column)),
      cells.filter(cell => cell.row === cell.column),
      cells.filter(cell => cell.row + cell.column === 5)
    ];
    return lines.filter(line => line.length === 6 && line.every(cell => cell.isTicked)).length;
  }, [cells]);

  useEffect(() => {
    onCardState?.(completed, cells.length === 36, winningPatterns);
  }, [completed, cells.length, onCardState, winningPatterns]);

  async function selectCell(cell: CardCell) {
    if (cell.isTicked || !cell.question.question) return;
    if (cell.needsRetry) {
      try {
        const next = await retryQuestion(cell.index);
        setCells(next); setSelected(next[cell.index]);
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load a replacement question.'); }
      return;
    }
    setFeedback(''); setError(''); setSelected(cell);
  }

  async function answer(option: string) {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const response = await submitAnswer(selected.index, option);
      setCells(response.cells); setSelected(null); setFeedback(response.correct ? 'Correct answer — this box is completed.' : 'Wrong answer — the box is red. Tap to retry for a new question.');
      if (response.correct) {
        const completedCells = response.cells.map(cell => cell.isTicked);
        const winning = await checkWinningCondition(completedCells);
        if (winning.hasBingo) {
          const winnerType = completedCells.every(Boolean) ? 'grand' : winning.bingoCount >= 3 ? 'ultimate' : 'bingo';
          const winnerKey = winnerType;
          setWinStatus(`Congratulations! ${winning.patterns.join(', ')} completed.`);
          if (!reportedWinners.current.has(winnerKey)) {
            setWinnerPopup({ winnerType, patterns: winning.patterns, bingoCount: winning.bingoCount });
            await saveWinner(playerName, winnerType, winning.patterns, winning.bingoCount, completedCells);
            reportedWinners.current.add(winnerKey);
          }
        }
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your answer.'); }
    finally { setBusy(false); }
  }

  return <section className="game-card-panel">
    <div className="card-heading"><div><small>YOUR ETIQAN CARD</small><h1>Answer questions to complete your line</h1></div><span className="ready-chip">SQL Server connected</span></div>
    <div className="letter-headings">{letters.map(letter => <b key={letter}>{letter}</b>)}</div>
    <div className="etiqan-grid">{cells.map(cell => <button key={cell.index} className={`etiqan-cell ${cell.isTicked ? 'ticked' : ''} ${cell.isWrong ? 'wrong' : ''}`} onClick={() => void selectCell(cell)}>
      <small>{cell.question.category || 'ETIQAN QUESTION'}</small><strong>{cell.question.question}</strong>
      {cell.isTicked && <em>✓ Correct</em>}{cell.isWrong && <><em>✕ Wrong answer</em><em>Tap to retry</em></>}
    </button>)}</div>
    <div className="progress"><span>{completed} of 36 completed</span><b>{completed ? `${Math.round(completed / 36 * 100)}%` : 'Card loading'}</b><i style={{ width: `${completed / 36 * 100}%` }} /></div>
    {feedback && <div className="feedback">{feedback}</div>}{error && <div className="error-message">{error}</div>}
    {winningPatterns > 0 && <div className="win-status">{winStatus || `Congratulations — ${winningPatterns} Bingo pattern${winningPatterns === 1 ? '' : 's'} completed.`}</div>}
    {selected && <QuestionModal cell={selected} onAnswer={answer} onClose={() => setSelected(null)} busy={busy} />}
    {winnerPopup && <WinnerModal winnerType={winnerPopup.winnerType} patterns={winnerPopup.patterns} bingoCount={winnerPopup.bingoCount} onClose={() => setWinnerPopup(null)} />}
  </section>;
}
