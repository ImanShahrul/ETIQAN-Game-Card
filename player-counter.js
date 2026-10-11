import { startGamePresence, subscribeToActivePlayerCount } from './presence.js';

const countElements = () => document.querySelectorAll('[data-active-player-count]');

const setCountState = (state) => {
  countElements().forEach((element) => {
    element.textContent = state;
  });
};

const renderActivePlayerCount = (count) => {
  countElements().forEach((element) => {
    if (element.dataset.activePlayerCountFormat === 'number') {
      element.textContent = count.toLocaleString();
      return;
    }

    element.textContent = `${count.toLocaleString()} Active ${count === 1 ? 'Player' : 'Players'}`;
  });
};

const start = () => {
  subscribeToActivePlayerCount({
    onLoading: () => setCountState('Loading...'),
    onCount: renderActivePlayerCount,
    onError: (error) => {
      console.error('Unable to load connected player count:', error);
      setCountState('Unavailable');
    }
  });

  if (document.querySelector('[data-game-presence]')) {
    startGamePresence().catch((error) => {
      console.error('Unable to start game presence:', error);
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
