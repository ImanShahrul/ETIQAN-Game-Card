import {
  doc,
  getFirestore,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { app } from './firebase-config.js';
import { getAnonymousUser } from './presence.js';

const database = getFirestore(app);
const ETIQAN_COLUMNS = ['E', 'T', 'I', 'Q', 'A', 'N'];
const ETIQAN_ROWS = 5;
const ETIQAN_COLUMNS_COUNT = ETIQAN_COLUMNS.length;

const numberFromValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const token = value.trim().toUpperCase();
  if (!token || token === 'FREE') return 0;
  const match = token.match(/^(?:B|I|N|G|O)?[-\s]?(\d{1,2})$/);
  if (!match) return null;

  const number = Number(match[1]);
  return number >= 1 && number <= 75 ? number : null;
};

const formatBall = (number) => {
  if (!number) return '--';
  return `#${String(number).padStart(2, '0')}`;
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).filter((key) => value[key]);
  return [];
};

const getCells = () => Array.from(document.querySelectorAll('#bingoGridMatrix .bingo-cell')).map((cell) => ({
  number: cell.dataset.isFree === 'true' ? 0 : numberFromValue(cell.dataset.number),
  isFree: cell.dataset.isFree === 'true',
  isTicked: cell.dataset.tick === 'true',
  hasQuestion: Boolean(cell.dataset.questionId || cell.dataset.question)
}));

const getPatterns = (cells) => {
  if (cells.length !== ETIQAN_ROWS * ETIQAN_COLUMNS_COUNT) return [];

  const patterns = [];
  for (let row = 0; row < ETIQAN_ROWS; row += 1) {
    patterns.push({ name: `Row ${row + 1}`, cells: cells.slice(row * ETIQAN_COLUMNS_COUNT, row * ETIQAN_COLUMNS_COUNT + ETIQAN_COLUMNS_COUNT) });
  }

  for (let column = 0; column < ETIQAN_COLUMNS_COUNT; column += 1) {
    patterns.push({
      name: `Column ${ETIQAN_COLUMNS[column]}`,
      cells: Array.from({ length: ETIQAN_ROWS }, (_, row) => cells[row * ETIQAN_COLUMNS_COUNT + column])
    });
  }

  return patterns;
};

const getDrawnNumbers = (state) => new Set(
  toArray(state?.drawnNumbers || state?.calledNumbers)
    .map(numberFromValue)
    .filter((number) => number !== null)
);

const getElements = () => ({
  label: document.getElementById('patternProgressLabel'),
  status: document.getElementById('patternProgressStatus'),
  bar: document.getElementById('patternProgressBar'),
  description: document.getElementById('gameStateDescription'),
  liveStatus: document.getElementById('gameStateLiveStatus')
});

const render = (state) => {
  const elements = getElements();
  const patterns = getPatterns(getCells());
  const drawnNumbers = getDrawnNumbers(state);

  if (!patterns.length) {
    if (elements.label) elements.label.textContent = 'Pattern Progress: Loading your card...';
    if (elements.status) elements.status.textContent = 'Card loading';
    if (elements.bar) elements.bar.style.width = '0%';
    return;
  }

  const configuredCells = getCells().filter((cell) => cell.isFree || cell.number !== null || cell.hasQuestion);
  if (!configuredCells.length) {
    if (elements.label) elements.label.textContent = 'ETIQAN Progress: Questions pending';
    if (elements.status) elements.status.textContent = 'Awaiting question set';
    if (elements.bar) elements.bar.style.width = '0%';
    if (elements.liveStatus) elements.liveStatus.textContent = 'Card structure ready';
    if (elements.description) elements.description.textContent = 'The 30 ETIQAN boxes are ready. Questions will be loaded from Firebase.';
    return;
  }

  const progress = patterns.map((pattern) => {
    const incompleteCells = pattern.cells
      .filter((cell) => !cell.isFree && !cell.isTicked && !(cell.number !== null && drawnNumbers.has(cell.number)));
    const missing = incompleteCells
      .map((cell) => cell.number)
      .filter((number) => number !== null);

    return {
      ...pattern,
      missing,
      missingCells: incompleteCells,
      completed: pattern.cells.length - incompleteCells.length
    };
  }).sort((first, second) => second.completed - first.completed || first.name.localeCompare(second.name));

  const best = progress[0];
  const waiting = !state || (String(state.status || '').toLowerCase() === 'waiting' && drawnNumbers.size === 0);
  const percent = waiting ? 0 : Math.round((best.completed / best.cells.length) * 100);
  const missingLabel = best.missing.slice(0, 5).map(formatBall).join(', ');
  const missingCount = best.missingCells.length;
  const missingDescription = missingLabel || `${missingCount} box${missingCount === 1 ? '' : 'es'}`;

  if (elements.label) {
    elements.label.textContent = waiting
      ? 'ETIQAN Progress: Waiting for official draw'
      : `ETIQAN Progress: ${best.name} is ${best.completed} of ${best.cells.length} Completed`;
  }

  if (elements.status) {
    elements.status.textContent = waiting
      ? 'Draw waiting'
      : missingCount === 0
        ? 'ETIQAN COMPLETE!'
        : `${missingCount} Box${missingCount === 1 ? '' : 'es'} Away!`;
  }

  if (elements.bar) elements.bar.style.width = `${percent}%`;

  if (elements.liveStatus) {
    elements.liveStatus.textContent = waiting
      ? 'Waiting for official draw'
      : `Official draw • Ball ${state.currentBall || best.completed}`;
  }

  if (elements.description) {
    elements.description.textContent = waiting
      ? 'Your pattern progress will update when the official draw begins.'
      : missingCount === 0
        ? `You completed ${best.name}. ETIQAN pattern verified.`
        : `You are ${missingCount} box${missingCount === 1 ? '' : 'es'} away on ${best.name}${missingDescription ? ` (Needs: ${missingDescription}).` : '.'}`;
  }
};

const start = async () => {
  try {
    await getAnonymousUser();
    const stateRef = doc(database, 'gameState', 'currentRound');
    let latestState = null;
    const redraw = () => render(latestState);

    onSnapshot(stateRef, (snapshot) => {
      latestState = snapshot.exists() ? snapshot.data() : null;
      redraw();
    }, (error) => {
      console.error('Unable to load pattern game state:', error);
      render(null);
    });

    window.addEventListener('bingo-card-locked', redraw);

    const grid = document.getElementById('bingoGridMatrix');
    if (grid) {
      let timer;
      const scheduleRedraw = () => {
        clearTimeout(timer);
        timer = setTimeout(redraw, 50);
      };
      new MutationObserver(scheduleRedraw).observe(grid, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-number', 'data-is-free', 'data-question-id', 'data-question', 'data-tick']
      });
    }
  } catch (error) {
    console.error('Unable to start pattern progress:', error);
    render(null);
  }
};

start();
