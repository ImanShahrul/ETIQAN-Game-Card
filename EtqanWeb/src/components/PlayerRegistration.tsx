import { useState, type FormEvent } from 'react';
import { registerPlayer } from '../api';
import type { PlayerSession } from '../types';

interface Props { onRegistered: (session: PlayerSession) => void; }

export function PlayerRegistration({ onRegistered }: Props) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) { setError('Please enter a player name.'); return; }
    setBusy(true); setError('');
    try { onRegistered(await registerPlayer(cleanName)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create player session.'); }
    finally { setBusy(false); }
  }

  return <main className="registration-page">
    <header className="registration-topbar">
      <div className="registration-brand"><div className="registration-logo">eTiQa<i /></div><span /><div><strong>Etiqa ETIQAN Challenge</strong><small>ETIQA INSURANCE &amp; TAKAFUL</small></div></div>
      <div className="round-status"><i /> <b>LIVE ROUND IN PROGRESS</b><span>&bull; Round 12 of 12</span></div>
      <div className="policyholder-status">&#9812; Active policyholders</div>
    </header>
    <section className="registration-card">
      <div className="challenge-badge"><span>LIVE</span> WEEKLY ETIQAN EXPERIENCE</div>
      <small>ETIQA HIBAH &amp; WELLNESS SEASON</small>
      <h1>Do You Want to Play ETIQAN?</h1>
      <p>Answer questions, complete your ETIQAN line, and claim your rewards.</p>
      <div className="ball-row"><b><strong>E</strong><small>GENERAL</small></b><b><strong>T</strong><small>ETIQA</small></b><b><strong>I</strong><small>INSURANCE</small></b><b><strong>Q</strong><small>IQ / LOGIC</small></b><b><strong>A</strong><small>AWARENESS</small></b><b><strong>N</strong><small>TECHNOLOGY</small></b></div>
      <div className="challenge-facts"><div><strong>36</strong><small>QUESTIONS</small></div><div><strong>6</strong><small>ETIQAN CATEGORIES</small></div><div><strong>RM</strong><small>WEEKLY REWARDS</small></div></div>
      <div className="registration-actions">
        <button className="primary-button" onClick={() => { setOpen(true); setError(''); }}>Yes, Play Now!</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { setBusy(true); void registerPlayer('Guest').then(onRegistered).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not create guest session.')).finally(() => setBusy(false)); }}>Play as Guest</button>
      </div>
      <small className="secure-session">&#128274; Secure player session allocated to your name</small>
    </section>
    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <form className="modal" onSubmit={submit} onClick={event => event.stopPropagation()}>
        <button type="button" className="close-button" onClick={() => setOpen(false)}>×</button>
        <small>WEEKLY CHALLENGE</small><h2>Who is Playing Today?</h2>
        <label htmlFor="player-name">Player / Policyholder Name</label>
        <input id="player-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Ahmad Razak" autoFocus />
        {error && <div className="error-message">{error}</div>}
        <button className="primary-button" disabled={busy}>{busy ? 'Opening…' : 'Continue to Game →'}</button>
      </form>
    </div>}
  </main>;
}
