import {
  doc,
  getFirestore,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { app } from './firebase-config.js';
import { getAnonymousUser } from './presence.js';

const database = getFirestore(app);
const stateRef = doc(database, 'gameState', 'currentRound');
let latestState = null;

const getBallLetter = (number) => {
  if (number >= 1 && number <= 15) return 'B';
  if (number <= 30) return 'I';
  if (number <= 45) return 'N';
  if (number <= 60) return 'G';
  return 'O';
};

const getBallName = (number) => {
  const names = {
    1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten',
    11: 'Eleven', 12: 'Twelve', 13: 'Thirteen', 14: 'Fourteen', 15: 'Fifteen', 16: 'Sixteen', 17: 'Seventeen', 18: 'Eighteen', 19: 'Nineteen', 20: 'Twenty',
    21: 'Twenty-One', 22: 'Twenty-Two', 23: 'Twenty-Three', 24: 'Twenty-Four', 25: 'Twenty-Five', 26: 'Twenty-Six', 27: 'Twenty-Seven', 28: 'Twenty-Eight', 29: 'Twenty-Nine', 30: 'Thirty',
    31: 'Thirty-One', 32: 'Thirty-Two', 33: 'Thirty-Three', 34: 'Thirty-Four', 35: 'Thirty-Five', 36: 'Thirty-Six', 37: 'Thirty-Seven', 38: 'Thirty-Eight', 39: 'Thirty-Nine', 40: 'Forty',
    41: 'Forty-One', 42: 'Forty-Two', 43: 'Forty-Three', 44: 'Forty-Four', 45: 'Forty-Five', 46: 'Forty-Six', 47: 'Forty-Seven', 48: 'Forty-Eight', 49: 'Forty-Nine', 50: 'Fifty',
    51: 'Fifty-One', 52: 'Fifty-Two', 53: 'Fifty-Three', 54: 'Fifty-Four', 55: 'Fifty-Five', 56: 'Fifty-Six', 57: 'Fifty-Seven', 58: 'Fifty-Eight', 59: 'Fifty-Nine', 60: 'Sixty',
    61: 'Sixty-One', 62: 'Sixty-Two', 63: 'Sixty-Three', 64: 'Sixty-Four', 65: 'Sixty-Five', 66: 'Sixty-Six', 67: 'Sixty-Seven', 68: 'Sixty-Eight', 69: 'Sixty-Nine', 70: 'Seventy',
    71: 'Seventy-One', 72: 'Seventy-Two', 73: 'Seventy-Three', 74: 'Seventy-Four', 75: 'Seventy-Five'
  };
  return names[number] || String(number);
};

const getElements = () => ({
  callerTimer: document.getElementById('callerCountdownTimer'),
  topTimerSecText: document.getElementById('topTimerSecText'),
  topTimerSubText: document.getElementById('topTimerSubText'),
  topTimerStatusLabel: document.getElementById('topTimerStatusLabel'),
  topTimerCircle: document.getElementById('topTimerCircle'),
  callerStatusLabel: document.getElementById('callerStatusLabel'),
  currentBallLetter: document.getElementById('currentBallLetter'),
  currentBallNumber: document.getElementById('currentBallNumber'),
  currentBallLabel: document.getElementById('currentBallLabel'),
  liveBallDisplay: document.getElementById('liveBallDisplay')
});

const getDrawnNumbers = (state) => (Array.isArray(state?.drawnNumbers) ? state.drawnNumbers : [])
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 75);

const getTimestampMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
};

const updateNextBallCountdown = () => {
  const elements = getElements();
  if (elements.topTimerStatusLabel) elements.topTimerStatusLabel.textContent = 'Good Luck!';
  if (elements.callerStatusLabel) elements.callerStatusLabel.textContent = 'Good Luck!';
  if (elements.callerTimer) elements.callerTimer.textContent = 'LIVE';
  if (elements.topTimerSecText) elements.topTimerSecText.textContent = 'ON';
  if (elements.topTimerSubText) elements.topTimerSubText.textContent = 'Game Always On';
  if (elements.topTimerCircle) elements.topTimerCircle.setAttribute('stroke-dasharray', '100, 100');
};

const autoLockCardAtDrawStart = () => {
  if (String(latestState?.status || '').toLowerCase() !== 'active') return;
  if (window.bingoCardLocked || window.bingoCardLockInProgress) return;
  if (typeof window.syncCurrentBingoCard !== 'function' || typeof window.lockBingoCard !== 'function') {
    setTimeout(autoLockCardAtDrawStart, 250);
    return;
  }

  window.lockBingoCard({ automatic: true }).catch((error) => {
    console.error('Unable to auto-lock Bingo card at draw start:', error);
  });
};

const markCardNumbers = (drawnSet) => {
  document.querySelectorAll('#bingoGridMatrix .bingo-cell').forEach((cell) => {
    const number = Number(cell.dataset.number);
    const isFree = cell.dataset.isFree === 'true' || cell.textContent.trim().toUpperCase() === 'FREE';
    const called = isFree || drawnSet.has(number);
    cell.dataset.tick = String(called);
    if (called) cell.setAttribute('title', 'Automatically marked from the official Firebase draw');
  });
};

const render = (state) => {
  const elements = getElements();
  const drawnNumbers = getDrawnNumbers(state);
  const drawnSet = new Set(drawnNumbers);
  const status = 'active';
  const currentBall = Number(state?.currentBall) || drawnNumbers[drawnNumbers.length - 1] || null;

  latestState = { ...(state || {}), status: 'active' };
  window.firebaseGameState = latestState;
  window.dispatchEvent(new CustomEvent('bingo-game-state', { detail: window.firebaseGameState }));
  if (status === 'active') setTimeout(autoLockCardAtDrawStart, 0);

  const questionLabel = status === 'active' ? 'Good Luck!' : 'Waiting For The Question';
  if (elements.topTimerStatusLabel) elements.topTimerStatusLabel.textContent = questionLabel;
  if (elements.callerStatusLabel) elements.callerStatusLabel.textContent = questionLabel;

  markCardNumbers(drawnSet);
  if (typeof window.syncOfficialDaub === 'function') {
    window.syncOfficialDaub(drawnNumbers, currentBall);
  }
  if (!currentBall) {
    if (elements.callerTimer) elements.callerTimer.textContent = 'LIVE';
    if (elements.topTimerSecText) elements.topTimerSecText.textContent = '--';
    if (elements.topTimerSubText) elements.topTimerSubText.textContent = 'Game Always On';
    if (elements.topTimerCircle) elements.topTimerCircle.setAttribute('stroke-dasharray', '100, 100');
    if (elements.currentBallLetter) elements.currentBallLetter.textContent = 'Ready';
    if (elements.currentBallNumber) elements.currentBallNumber.textContent = '--';
    if (elements.currentBallLabel) elements.currentBallLabel.textContent = 'Waiting for the next question';
    return;
  }

  const letter = getBallLetter(currentBall);
  if (elements.callerTimer) elements.callerTimer.textContent = 'LIVE';
  if (elements.topTimerSecText) elements.topTimerSecText.textContent = String(drawnNumbers.length).padStart(2, '0');
  if (elements.topTimerSubText) elements.topTimerSubText.textContent = 'Good Luck!';
  if (elements.topTimerCircle) elements.topTimerCircle.setAttribute('stroke-dasharray', `${Math.round((drawnNumbers.length / 75) * 100)}, 100`);
  if (elements.currentBallLetter) elements.currentBallLetter.textContent = `Letter ${letter}`;
  if (elements.currentBallNumber) elements.currentBallNumber.textContent = currentBall;
  if (elements.currentBallLabel) elements.currentBallLabel.textContent = `${letter}-${currentBall} • ${letter} ${getBallName(currentBall)}`;
  updateNextBallCountdown();
  if (elements.liveBallDisplay) {
    elements.liveBallDisplay.animate(
      [{ transform: 'scale(1)', opacity: '1' }, { transform: 'scale(1.08)', opacity: '0.9' }, { transform: 'scale(1)', opacity: '1' }],
      { duration: 600, easing: 'ease-out' }
    );
  }
};

const start = async () => {
  try {
    await getAnonymousUser();
    onSnapshot(stateRef, (snapshot) => render(snapshot.exists() ? snapshot.data() : null), (error) => {
      console.error('Unable to load official game state:', error);
    });
  } catch (error) {
    console.error('Unable to initialise official draw:', error);
  }
};

start();
updateNextBallCountdown();
