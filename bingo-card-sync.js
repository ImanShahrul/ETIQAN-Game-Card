import {
  doc,
  getFirestore,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { app } from './firebase-config.js';
import { getAnonymousUser } from './presence.js';

const database = getFirestore(app);

const getCardFromGrid = (grid) => Array.from(grid.querySelectorAll('.bingo-cell')).map((cell) => {
  if (cell.dataset.number) return Number(cell.dataset.number);
  return '';
});

const syncCard = async () => {
  const grid = document.getElementById('bingoGridMatrix');
  if (!grid) return false;

  const numbers = getCardFromGrid(grid);
  if (numbers.length !== 30) {
    console.warn('ETIQAN card was not saved because it does not contain 30 cells.');
    return false;
  }

  const user = await getAnonymousUser();
  window.firebaseAnonymousUid = user.uid;
  const params = new URLSearchParams(window.location.search);
  const playerName = params.get('playerName') || 'Guest';
  const playerId = params.get('playerId') || null;
  const cardData = {
    uid: user.uid,
    userID: user.uid,
    playerId,
    playerName,
    numbers,
    cells: numbers.map((value, index) => ({
      index,
      column: ['E', 'T', 'I', 'Q', 'A', 'N'][index % 6],
      row: Math.floor(index / 6) + 1,
      value
    })),
    layout: 'ETIQAN-6x5',
    columns: ['E', 'T', 'I', 'Q', 'A', 'N'],
    cellCount: 30,
    confirmed: true,
    round: '12',
    createdAt: serverTimestamp()
  };

  // Use the authenticated UID as the document ID. This avoids a collection
  // query during locking and makes the save/update operation deterministic.
  await setDoc(doc(database, 'bingoCards', user.uid), cardData, { merge: true });

  return true;
};

window.syncCurrentBingoCard = syncCard;

let syncTimer;
const scheduleSync = () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncCard().catch((error) => {
      console.error('Unable to sync ETIQAN card:', error);
    });
  }, 250);
};

const grid = document.getElementById('bingoGridMatrix');
if (grid) {
  syncCard().catch((error) => {
    console.error('Unable to sync ETIQAN card:', error);
  });

  new MutationObserver(scheduleSync).observe(grid, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-number', 'data-is-free', 'data-question-id', 'data-question', 'data-tick']
  });
}
