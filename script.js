import { addDoc, collection, getFirestore, limit, onSnapshot, orderBy, query, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { app } from './firebase-config.js';
import { getAnonymousUser } from './presence.js';

const db = getFirestore(app);

const getWinnerName = (winner) => winner.playerName || winner.name || winner['player name'] || 'Winner';

let bingoWinnerSnapshot = [];
let grandPrizeWinnerSnapshot = [];

const updateWinnerAllocation = () => {
  const bingoWinners = bingoWinnerSnapshot
    .sort((first, second) => (second.wonAt?.toMillis?.() || 0) - (first.wonAt?.toMillis?.() || 0));
  const grandPrizeWinner = grandPrizeWinnerSnapshot
    .sort((first, second) => (second.wonAt?.toMillis?.() || 0) - (first.wonAt?.toMillis?.() || 0))[0];

  const grandPrizeWinnerName = document.getElementById('grandPrizeWinnerName');
  if (grandPrizeWinnerName) {
    grandPrizeWinnerName.textContent = grandPrizeWinner ? getWinnerName(grandPrizeWinner) : 'Awaiting final draw';
  }

  document.querySelectorAll('[data-bingo-winner-name]').forEach((slot, index) => {
    slot.textContent = bingoWinners[index] ? getWinnerName(bingoWinners[index]) : 'Awaiting winner';
  });
};

if (document.getElementById('grandPrizeWinnerName')) {
  onSnapshot(collection(db, 'bingoWinners'), (snapshot) => {
    bingoWinnerSnapshot = snapshot.docs.map((winnerDoc) => winnerDoc.data());
    updateWinnerAllocation();
  }, (error) => {
    console.error('Unable to load Bingo winners:', error);
  });

  onSnapshot(collection(db, 'ultimatePrizeWinner'), (snapshot) => {
    grandPrizeWinnerSnapshot = snapshot.docs.map((winnerDoc) => winnerDoc.data());
    updateWinnerAllocation();
  }, (error) => {
    console.error('Unable to load ultimate prize winner:', error);
  });
}

const winnerRecordCreated = new Set();

window.recordWinner = async ({ winnerType, currentBall, cardNumbers }) => {
  if (winnerRecordCreated.has(winnerType)) return;

  const params = new URLSearchParams(window.location.search);
  let playerId = params.get('playerId');
  const playerName = params.get('playerName') || 'Guest';
  const user = await getAnonymousUser();
  if (!playerId) {
    try {
      const playerRecord = await addDoc(collection(db, 'players'), {
        name: playerName,
        uid: user.uid,
        createdAt: serverTimestamp(),
        source: 'game-session'
      });
      playerId = playerRecord.id;
    } catch (error) {
      console.error('Unable to create player record for winner:', error);
      return;
    }
  }

  winnerRecordCreated.add(winnerType);
  const winnerData = {
    uid: user.uid,
    playerId,
    playerName,
    currentBall: currentBall ?? null,
    cardNumbers,
    round: 12,
    prize: winnerType === 'grand-prize-winner' ? 'RM100 Voucher' : 'RM10,000 CASH',
    wonAt: serverTimestamp()
  };

  try {
    const winnerCollection = winnerType === 'grand-prize-winner'
      ? 'ultimatePrizeWinner'
      : 'bingoWinners';
    await addDoc(collection(db, winnerCollection), winnerData);
  } catch (error) {
    winnerRecordCreated.delete(winnerType);
    console.error('Unable to save winner record:', error);
  }
};

const previousWinnerQuery = query(
  collection(db, 'previousWinners'),
  orderBy('claimedAt', 'desc'),
  limit(1)
);

const previousWinnerName = document.getElementById('previousWinnerName');
const previousWinnerDetails = document.getElementById('previousWinnerDetails');
const previousWinnerInitials = document.getElementById('previousWinnerInitials');

if (previousWinnerName && previousWinnerDetails && previousWinnerInitials) {
  onSnapshot(previousWinnerQuery, (snapshot) => {
    const winner = snapshot.docs[0]?.data();
    if (!winner) {
      previousWinnerName.textContent = 'No previous winner recorded';
      previousWinnerDetails.textContent = 'Awaiting the first completed draw';
      previousWinnerInitials.textContent = '--';
      return;
    }

    const name = winner.name || 'Previous winner';
    const ball = winner.ball ? ` on Ball #${winner.ball}` : '';
    const prize = winner.prize ? ` (${winner.prize})` : '';

    previousWinnerName.textContent = name;
    previousWinnerDetails.textContent = winner.details || `Claimed last week${ball}${prize}`;
    previousWinnerInitials.textContent = name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }, (error) => {
    console.error('Unable to load previous winner:', error);
  });
}

