import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signOut,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getDatabase,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';
import { app } from './firebase-config.js';

const database = getDatabase(app);

export const subscribeToActivePlayerCount = ({ onLoading, onCount, onError } = {}) => {
  onLoading?.();

  return onValue(ref(database, 'presence'), (snapshot) => {
    const activeUids = new Set();

    snapshot.forEach((uidSnapshot) => {
      if (uidSnapshot.exists()) activeUids.add(uidSnapshot.key);
    });

    onCount?.(activeUids.size);
  }, (error) => {
    onError?.(error);
  });
};

export const getAnonymousUser = async () => {
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);

  if (auth.currentUser) {
    try {
      await auth.currentUser.getIdToken(true);
      return auth.currentUser;
    } catch (error) {
      // Drop stale auth state left by an older cached deployment and create a
      // fresh anonymous session for the current Firebase configuration.
      await signOut(auth);
    }
  }

  return (await signInAnonymously(auth)).user;
};

export const startGamePresence = async () => {
  const user = await getAnonymousUser();
  const connectionRef = push(ref(database, `presence/${user.uid}`));
  const connectedRef = ref(database, '.info/connected');
  let cleanupConnection;

  const unsubscribeConnection = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return;

    try {
      // Register onDisconnect before writing presence so Firebase removes this
      // connection after tab close, crashes, network loss, or browser shutdown.
      await onDisconnect(connectionRef).remove();
      await set(connectionRef, { connectedAt: serverTimestamp() });
      cleanupConnection = () => remove(connectionRef).catch(() => {});
    } catch (error) {
      console.error('Unable to register game presence:', error);
    }
  });

  return () => {
    unsubscribeConnection();
    cleanupConnection?.();
  };
};
