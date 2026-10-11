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
let questionUnsubscribe;
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
  category: raw.category ?? raw.currentCategory ?? null,
  questions: Array.isArray(raw.questions) ? raw.questions : (Array.isArray(raw.questionBank) ? raw.questionBank : [])
});

const toNumberOrNull = (...values) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};

const normalizeQuestion = (snapshot) => {
  const raw = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    letter: raw.letter ?? raw.column ?? raw.etqanLetter ?? raw.etqan ?? '',
    row: toNumberOrNull(raw.row, raw.position, raw.slot),
    index: toNumberOrNull(raw.index),
    order: toNumberOrNull(raw.order, raw.sortOrder, raw.sequence),
    question: raw.question ?? raw.questionText ?? raw.text ?? raw.prompt ?? raw.title ?? '',
    category: raw.category ?? raw.topic ?? '',
    optionA: raw.optionA ?? raw.answerA ?? '',
    optionB: raw.optionB ?? raw.answerB ?? '',
    optionC: raw.optionC ?? raw.answerC ?? '',
    correctOption: raw.correctOption ?? raw.answer ?? '',
    correctAnswer: raw.correctAnswer ?? raw.correctText ?? ''
  };
};

export async function start(dotnet) {
  await ensureFirebaseSession();

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

  questionUnsubscribe = onSnapshot(
    collection(database, 'questions'),
    (snapshot) => dotnet.invokeMethodAsync(
      'OnQuestionSnapshot',
      JSON.stringify(snapshot.docs.map(normalizeQuestion))
    ),
    (error) => dotnet.invokeMethodAsync('OnQuestionError', error.message)
      .catch(() => console.error('ETIQAN question listener failed:', error))
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

export async function saveAnswer(index, isCorrect, cells) {
  await ensureFirebaseSession();
  await setDoc(doc(database, 'bingoCards', user.uid), {
    uid: user.uid,
    userID: user.uid,
    numbers: cells.map((cell) => cell.index),
    cells,
    lastAnswer: {
      index,
      isCorrect,
      answeredAt: new Date().toISOString()
    }
  }, { merge: true });
}

export async function saveCardState(cells) {
  await ensureFirebaseSession();
  await setDoc(doc(database, 'bingoCards', user.uid), {
    uid: user.uid,
    userID: user.uid,
    numbers: cells.map((cell) => cell.index),
    cells
  }, { merge: true });
}

export function speakQuestion(text) {
  if (!('speechSynthesis' in window)) {
    throw new Error('Text-to-speech is not supported by this browser.');
  }

  const question = String(text ?? '').trim();
  if (!question) return Promise.resolve();

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(question);
  utterance.lang = /\b(apa|yang|dan|dengan|untuk|adalah|ini|itu|mana)\b/i.test(question) ? 'ms-MY' : 'en-US';
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;

  return new Promise((resolve, reject) => {
    utterance.onend = resolve;
    utterance.onerror = () => reject(new Error('The browser could not play the speech.'));
    window.speechSynthesis.speak(utterance);
  });
}

export function stop() {
  cardUnsubscribe?.();
  questionUnsubscribe?.();
  gameUnsubscribe?.();
  presenceCountUnsubscribe?.();
  connectedUnsubscribe?.();
  if (presenceConnection) remove(presenceConnection).catch(() => {});
  cardUnsubscribe = undefined;
  questionUnsubscribe = undefined;
  gameUnsubscribe = undefined;
  presenceCountUnsubscribe = undefined;
  connectedUnsubscribe = undefined;
  presenceConnection = undefined;
}
