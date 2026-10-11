import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { addDoc, collection, doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getDatabase, onDisconnect, onValue, push, ref, remove, serverTimestamp as realtimeServerTimestamp, set } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDQTaBbkX8Ual83GLQ75m0zT5HLl6p2M18',
  authDomain: 'bingo-etiqa.firebaseapp.com',
  databaseURL: 'https://bingo-etiqa-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'bingo-etiqa',
  storageBucket: 'bingo-etiqa.firebasestorage.app',
  messagingSenderId: '1121966882522',
  appId: '1:1121966882522:web:e827ed5ca4405cd1714863',
  measurementId: 'G-MQGZNTLNL'
};

let auth;
let database;
let user;
let cardUnsubscribe;
let gameUnsubscribe;
let presenceCountUnsubscribe;
let connectedUnsubscribe;
let presenceConnection;

const getFirebaseApp = () => getApps().length ? getApp() : initializeApp(firebaseConfig);

const ensureFirebaseSession = async () => {
  const app = getFirebaseApp();
  auth ??= getAuth(app);
  database ??= getFirestore(app);
  if (!user) {
    const credentials = await signInAnonymously(auth);
    user = credentials.user;
  }
  return user;
};

const normalizeGameState = (raw) => ({
  ...raw,
  // The player game is always on. Firebase remains the source for the
  // current question and card data, but schedule/status must not pause UI.
  isLive: true,
  question: raw.question ?? raw.currentQuestion ?? raw.prompt ?? raw.calledQuestion ?? null,
  category: raw.category ?? raw.currentCategory ?? null
});

export async function start(dotnet) {
  await ensureFirebaseSession();

  await dotnet.invokeMethodAsync('OnFirebaseIdentity', user.uid);

  const realtime = getDatabase(getFirebaseApp());
  presenceConnection = push(ref(realtime, `presence/${user.uid}`));
  connectedUnsubscribe = onValue(ref(realtime, '.info/connected'), async (snapshot) => {
    if (snapshot.val() !== true) return;
    try {
      await onDisconnect(presenceConnection).remove();
      await set(presenceConnection, { connectedAt: realtimeServerTimestamp() });
    } catch (error) {
      console.error('ETIQAN presence registration failed:', error);
    }
  });
  presenceCountUnsubscribe = onValue(ref(realtime, 'presence'), (snapshot) => {
    const activeUids = new Set();
    snapshot.forEach((uidSnapshot) => {
      if (uidSnapshot.exists()) activeUids.add(uidSnapshot.key);
    });
    dotnet.invokeMethodAsync('OnActivePlayerCount', activeUids.size);
  }, (error) => console.error('ETIQAN presence count failed:', error));

  cardUnsubscribe = onSnapshot(
    doc(database, 'bingoCards', user.uid),
    (snapshot) => dotnet.invokeMethodAsync('OnCardSnapshot', JSON.stringify({
      exists: snapshot.exists(),
      ...(snapshot.data() ?? {})
    })),
    (error) => console.error('ETIQAN card listener failed:', error)
  );

  gameUnsubscribe = onSnapshot(
    doc(database, 'gameState', 'currentRound'),
    (snapshot) => dotnet.invokeMethodAsync('OnGameSnapshot', JSON.stringify({
      exists: snapshot.exists(),
      ...normalizeGameState(snapshot.data() ?? {})
    })),
    (error) => console.error('ETIQAN game listener failed:', error)
  );
}

export async function createPlayerRecord(playerName) {
  const currentUser = await ensureFirebaseSession();
  const player = await addDoc(collection(database, 'players'), {
    uid: currentUser.uid,
    name: playerName,
    source: 'etiqan-dotnet',
    createdAt: serverTimestamp()
  });
  return player.id;
}

export async function lockCard() {
  await ensureFirebaseSession();

  await setDoc(doc(database, 'bingoCards', user.uid), {
    uid: user.uid,
    userID: user.uid,
    numbers: Array(30).fill(''),
    cellCount: 30,
    layout: 'ETIQAN-6x5',
    confirmed: true,
    locked: true,
    lockedAt: new Date().toISOString()
  }, { merge: true });
}

export function stop() {
  cardUnsubscribe?.();
  gameUnsubscribe?.();
  presenceCountUnsubscribe?.();
  connectedUnsubscribe?.();
  if (presenceConnection) remove(presenceConnection).catch(() => {});
  cardUnsubscribe = undefined;
  gameUnsubscribe = undefined;
  presenceCountUnsubscribe = undefined;
  connectedUnsubscribe = undefined;
  presenceConnection = undefined;
}
