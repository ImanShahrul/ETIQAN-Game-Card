import type { CardCell } from '../types';

interface Props { cell: CardCell; onAnswer: (option: string) => void; onClose: () => void; busy: boolean; }

export function QuestionModal({ cell, onAnswer, onClose, busy }: Props) {
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="question-modal" onClick={event => event.stopPropagation()}>
      <button className="close-button" onClick={onClose}>×</button>
      <small>ANSWER THIS QUESTION</small>
      <span className="cell-code">{['E', 'T', 'I', 'Q', 'A', 'N'][cell.column]}{cell.row + 1}</span>
      <h2>{cell.question.question}</h2>
      <div className="answer-options">
        {(['A', 'B', 'C', 'D'] as const).map(key => {
          const text = key === 'A' ? cell.question.optionA : key === 'B' ? cell.question.optionB : key === 'C' ? cell.question.optionC : cell.question.optionD;
          return text ? <button key={key} disabled={busy} onClick={() => onAnswer(key)}><b>{key}</b><span>{text}</span></button> : null;
        })}
      </div>
    </section>
  </div>;
}
