import {
  collection,
  doc,
  getFirestore,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { app } from './firebase-config.js';
import { getAnonymousUser } from './presence.js';

const database = getFirestore(app);
const ROUND_STATE_ID = 'currentRound';
const DEFAULT_ROUND = '12';
const MAX_ROWS = 5;
const ETIQAN_COLUMNS = ['E', 'T', 'I', 'Q', 'A', 'N'];
const ETIQAN_ROWS = 5;

const numberFromValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const token = value.trim().toUpperCase();
  if (!token) return null;
  if (token === 'FREE') return 0;

  const match = token.match(/^(?:B|I|N|G|O)?[-\s]?(\d{1,2})$/);
  if (!match) return null;

  const number = Number(match[1]);
  const letter = token.charAt(0);
  const range = {
    B: [1, 15],
    I: [16, 30],
    N: [31, 45],
    G: [46, 60],
    O: [61, 75]
  }[letter];

  if (range && number >= range[0] && number <= range[1]) {
    return number;
  }

  if (range && number >= 1 && number <= 15) {
    return range[0] + number - 1;
  }

  return number >= 1 && number <= 75 ? number : null;
};

const formatBall = (value) => {
  const number = numberFromValue(value);
  if (!number) return '--';
  return `#${String(number).padStart(2, '0')}`;
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).filter((key) => value[key]);
  return [];
};

const timestampValue = (value) => {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime() || 0;
  return 0;
};

const playerKey = (id, data) => String(data.uid || data.userID || data.playerId || id);

const maskedPlayerId = (id, data) => {
  const source = String(data.playerId || data.uid || data.userID || id).replace(/[^A-Za-z0-9]/g, '');
  return `MY-**${source.slice(-3).toUpperCase().padStart(3, '0')}`;
};

const getCardNumbers = (data) => {
  const values = data.numbers || data.cardNumbers || data.card || [];
  return toArray(values).map(numberFromValue).filter((number) => number !== null);
};

const getDrawnNumbers = (state) => new Set(
  toArray(state?.drawnNumbers || state?.calledNumbers)
    .map(numberFromValue)
    .filter((number) => number !== null)
);

const getLines = (numbers) => {
  if (numbers.length === ETIQAN_ROWS * ETIQAN_COLUMNS.length) {
    const lines = [];
    for (let row = 0; row < ETIQAN_ROWS; row += 1) {
      lines.push(numbers.slice(row * ETIQAN_COLUMNS.length, row * ETIQAN_COLUMNS.length + ETIQAN_COLUMNS.length));
    }
    for (let column = 0; column < ETIQAN_COLUMNS.length; column += 1) {
      lines.push(Array.from({ length: ETIQAN_ROWS }, (_, row) => numbers[row * ETIQAN_COLUMNS.length + column]));
    }
    return lines;
  }

  // Older seed documents are ignored until a complete 30-cell ETIQAN card is saved.
  return [];
};

const calculateCardProgress = (data, drawnNumbers) => {
  const numbers = getCardNumbers(data);
  // A real Winners Radar result requires a complete 6x5 ETIQAN card.
  if (numbers.length !== ETIQAN_ROWS * ETIQAN_COLUMNS.length) return null;

  const lines = getLines(numbers);
  if (!lines.length) return null;

  const progress = lines.map((line) => {
    const remaining = line.filter((number) => {
      return !drawnNumbers.has(number);
    });

    return {
      remaining,
      missingCount: remaining.length
    };
  }).sort((first, second) => first.missingCount - second.missingCount);

  return progress[0];
};

const getElements = (root) => ({
  summary: root.querySelector('[data-radar-summary]'),
  list: root.querySelector('[data-radar-list]')
});

const showState = (root, message) => {
  const { summary, list } = getElements(root);
  if (summary) summary.textContent = message;
  if (list) list.innerHTML = `<p class="font-body-sm text-body-sm text-on-surface-variant">${message}</p>`;
};

const renderRadar = (root, state, cardSnapshot) => {
  const { summary, list } = getElements(root);
  if (!state) {
    showState(root, 'Shared game state unavailable');
    return;
  }

  const drawnNumbers = getDrawnNumbers(state);
  const cards = new Map();

  cardSnapshot.forEach((cardSnapshotItem) => {
    const data = cardSnapshotItem.data();
    const key = playerKey(cardSnapshotItem.id, data);
    const previous = cards.get(key);
    if (!previous || timestampValue(data.updatedAt || data.createdAt) >= previous.timestamp) {
      cards.set(key, {
        id: cardSnapshotItem.id,
        data,
        timestamp: timestampValue(data.updatedAt || data.createdAt)
      });
    }
  });

  const candidates = Array.from(cards.values())
    .map(({ id, data }) => {
      const progress = calculateCardProgress(data, drawnNumbers);
      if (!progress) return null;

      return {
        id,
        data,
        ...progress,
        maskedId: maskedPlayerId(id, data)
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.missingCount - second.missingCount || first.maskedId.localeCompare(second.maskedId));

  const oneAwayCount = candidates.filter((candidate) => candidate.missingCount === 1).length;
  const round = state?.round || DEFAULT_ROUND;

  if (String(state.status || '').toLowerCase() === 'waiting' && drawnNumbers.size === 0) {
    if (summary) summary.textContent = `${candidates.length} card${candidates.length === 1 ? '' : 's'} tracked • Draw waiting`;
    if (list) list.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant">Waiting for the official draw to start.</p>';
    root.dataset.round = String(round);
    return;
  }

  if (summary) {
    summary.textContent = candidates.length
      ? `${candidates.length} card${candidates.length === 1 ? '' : 's'} tracked • ${oneAwayCount} one away`
      : 'No valid cards tracked yet';
  }

  if (!list) return;
  if (!candidates.length) {
    list.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant">Waiting for confirmed ETIQAN cards.</p>';
    return;
  }

  list.innerHTML = candidates.slice(0, MAX_ROWS).map((candidate) => {
    const isWinner = candidate.missingCount === 0;
    const missing = candidate.remaining.length
      ? `Needs ${candidate.remaining.slice(0, 3).map(formatBall).join(', ')}`
      : 'ETIQAN COMPLETE';
    const isCurrentPlayer = candidate.data.uid && candidate.data.uid === window.firebaseAnonymousUid;
    const label = isCurrentPlayer ? `${candidate.maskedId} (You)` : candidate.maskedId;

    return `
      <div class="flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm pb-1">
        <span class="flex items-center gap-1 font-mono text-xs">
          <span class="w-1.5 h-1.5 rounded-full ${isWinner ? 'bg-tertiary' : 'bg-primary'}"></span>${label}
        </span>
        <span class="font-label-caps text-label-caps ${isWinner ? 'text-tertiary' : 'text-primary'}">${missing}</span>
      </div>`;
  }).join('');

  root.dataset.round = String(round);
};

const startRadar = async (root) => {
  showState(root, 'Loading radar...');

  try {
    const user = await getAnonymousUser();
    window.firebaseAnonymousUid = user.uid;
    let currentState = null;
    let currentCards = [];

    const redraw = () => renderRadar(root, currentState, currentCards);
    const unsubscribeState = onSnapshot(doc(database, 'gameState', ROUND_STATE_ID), (snapshot) => {
      currentState = snapshot.exists() ? snapshot.data() : null;
      redraw();
    }, (error) => {
      console.error('Unable to load shared game state:', error);
      showState(root, 'Game state unavailable');
    });

    const unsubscribeCards = onSnapshot(collection(database, 'bingoCards'), (snapshot) => {
      currentCards = snapshot.docs;
      redraw();
    }, (error) => {
      console.error('Unable to load ETIQAN cards:', error);
      showState(root, 'ETIQAN cards unavailable');
    });

    root.addEventListener('radar:disconnect', () => {
      unsubscribeState();
      unsubscribeCards();
    }, { once: true });
  } catch (error) {
    console.error('Unable to start Winners Radar:', error);
    showState(root, 'Radar unavailable');
  }
};

document.querySelectorAll('[data-winners-radar]').forEach(startRadar);
