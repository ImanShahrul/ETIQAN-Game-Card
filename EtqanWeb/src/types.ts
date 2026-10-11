export type EtqanLetter = 'E' | 'T' | 'I' | 'Q' | 'A' | 'N';

export interface Question {
  id: string;
  letter: EtqanLetter;
  row?: number | null;
  index?: number | null;
  order?: number | null;
  question: string;
  category: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: string;
  correctAnswer: string;
}

export interface CardCell {
  index: number;
  row: number;
  column: number;
  question: Question;
  usedQuestionIds: string[];
  isTicked: boolean;
  isWrong: boolean;
  needsRetry: boolean;
}

export interface PlayerSession {
  id: string;
  uid: string;
  name: string;
}

export interface RadarEntry {
  id: string;
  isCurrentPlayer: boolean;
  completedBoxes: number;
  distanceLabel: string;
  missingBoxes: number;
}

export interface PreviousWinner {
  playerName: string;
  winnerType: string;
  prize: string;
}

export interface WinnerSlot {
  slot: number;
  playerName: string | null;
  winnerType: 'bingo' | 'ultimate' | 'grand';
  prize: string;
}
