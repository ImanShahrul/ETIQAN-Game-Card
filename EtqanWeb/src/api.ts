import type { CardCell, PlayerSession, Question, RadarEntry, WinnerSlot } from './types';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api/game').replace(/\/$/, '');
const sessionStorageKey = 'etiqan.sql.session-id';

function getSessionId(): string {
  const existing = window.localStorage.getItem(sessionStorageKey);
  if (existing) return existing;

  const created = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `etiqan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(sessionStorageKey, created);
  return created;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const rawMessage = await response.text();
    let message = rawMessage;
    try {
      const payload = JSON.parse(rawMessage) as { message?: string; title?: string };
      message = payload.message || payload.title || rawMessage;
    } catch {
      // Keep plain-text API errors readable.
    }
    throw new Error(message || `API request failed with status ${response.status}.`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function registerPlayer(name: string): Promise<PlayerSession> {
  const uid = getSessionId();
  return request<PlayerSession>('register-player', {
    method: 'POST',
    body: JSON.stringify({ name, uid })
  });
}

export function getQuestions(): Promise<Question[]> {
  return request<Question[]>('questions');
}

export function generateCard(): Promise<CardCell[]> {
  return request<CardCell[]>('cards/generate', {
    method: 'POST',
    body: JSON.stringify({ uid: getSessionId() })
  });
}

export async function loadSavedCardState(): Promise<CardCell[] | null> {
  try {
    const saved = await request<CardCell[]>(`cards/${encodeURIComponent(getSessionId())}`);
    return saved.length === 36 ? saved : null;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('404') || error.message.trim() === 'Not Found')) return null;
    throw error;
  }
}

export function saveCardState(cells: CardCell[]): Promise<void> {
  return request<void>(`cards/${encodeURIComponent(getSessionId())}`, {
    method: 'PUT',
    body: JSON.stringify({ uid: getSessionId(), cells })
  });
}

export function submitAnswer(cellIndex: number, option: string) {
  return request<{ correct: boolean; cellIndex: number; cells: CardCell[] }>(`cards/${encodeURIComponent(getSessionId())}/answer`, {
    method: 'POST',
    body: JSON.stringify({ uid: getSessionId(), cellIndex, option })
  });
}

export function retryQuestion(cellIndex: number) {
  return request<CardCell[]>(`cards/${encodeURIComponent(getSessionId())}/retry`, {
    method: 'POST',
    body: JSON.stringify({ uid: getSessionId(), cellIndex })
  });
}

export function checkWinningCondition(completedCells: boolean[]) {
  return request<{ hasBingo: boolean; patterns: string[]; bingoCount: number }>('check-winning-condition', {
    method: 'POST',
    body: JSON.stringify({ completedCells })
  });
}

export function saveWinner(playerName: string, winnerType: string, patterns: string[], bingoCount: number, completedCells: boolean[]) {
  return request<{ id: string; winnerType: string; playerName: string }>('winners', {
    method: 'POST',
    body: JSON.stringify({ uid: getSessionId(), playerName, winnerType, patterns, bingoCount, completedCells })
  });
}

export function heartbeat(uid: string): Promise<void> {
  return request<void>(`presence/${encodeURIComponent(uid)}`, { method: 'POST' });
}

export function getGameSidebar(uid: string) {
  return request<{ radar: RadarEntry[]; winnerSlots: WinnerSlot[]; activePlayerCount: number }>(`sidebar/${encodeURIComponent(uid)}`);
}
