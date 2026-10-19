(() => {
  const pending = new Map();
  const remembered = new Set();
  let context = null;
  let activated = false;
  let speaking = false;
  let generation = 0;
  let activeUtterance = null;
  const clean = (value) => String(value ?? '').trim();
  const supported = () => Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  const storageKey = (suffix) => `dynamax:spoken-alerts:${context?.recipientKey || ''}:${suffix}`;
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } };
  const enabled = () => Boolean(context && supported() && read(storageKey('enabled')) !== 'no');

  function alertKey(row) {
    const event = row.Type === 'Presence confirmation' && row.DueDate
      ? `presence:${row.DueDate}` : clean(row.NotificationId);
    return event ? `${context?.recipientKey}:${row.BranchId || context?.branchId}:${event}` : '';
  }

  function eligible(row) {
    if (!context || row.Read || row.Archived || context.quietHoursActive || !enabled()) return false;
    if (row.BranchId && context.branchId && row.BranchId !== context.branchId) return false;
    if (row.ExpiresAt && Date.parse(row.ExpiresAt) <= Date.now()) return false;
    if (row.Type === 'Presence confirmation') return true;
    const age = Date.now() - Date.parse(row.CreatedAt);
    return row.Category === 'Requisitions' && Number.isFinite(age) && age >= -60000 && age <= 10 * 60000;
  }

  function seen(key) {
    let saved = [];
    try { saved = JSON.parse(read(storageKey('seen')) || '[]'); } catch { /* Ignore corrupt optional history. */ }
    return remembered.has(key) || (Array.isArray(saved) && saved.includes(key));
  }

  function remember(key) {
    remembered.add(key);
    let saved = [];
    try { saved = JSON.parse(read(storageKey('seen')) || '[]'); } catch { /* Ignore corrupt optional history. */ }
    write(storageKey('seen'), JSON.stringify([...new Set([...(Array.isArray(saved) ? saved : []), key])].slice(-100)));
  }

  async function drain() {
    if (speaking || !activated || document.visibilityState !== 'visible' || !enabled()) return;
    const item = pending.entries().next().value;
    if (!item) return;
    const [key, row] = item;
    pending.delete(key);
    if (!eligible(row) || seen(key)) { void drain(); return; }
    speaking = true;
    const runGeneration = generation;
    const speak = () => new Promise((resolve) => {
      if (runGeneration !== generation || !eligible(row) || seen(key) || document.visibilityState !== 'visible') { resolve(); return; }
      // Camera instructions take priority; never cancel an in-progress face challenge.
      if (window.speechSynthesis.speaking || document.querySelector('[data-student-face-dialog][open]')) {
        pending.set(key, row);
        resolve();
        return;
      }
      const utterance = new window.SpeechSynthesisUtterance(`${clean(row.Title)}. ${clean(row.Message)}`.slice(0, 700));
      activeUtterance = utterance;
      utterance.lang = navigator.language || 'en';
      utterance.rate = 0.95;
      utterance.onstart = () => { if (runGeneration === generation) remember(key); };
      utterance.onend = resolve;
      utterance.onerror = () => {
        if (runGeneration === generation && !seen(key)) pending.set(key, row);
        activated = false; // Retry on the next user gesture, not in a speech-error loop.
        resolve();
      };
      try { window.speechSynthesis.speak(utterance); } catch { activated = false; resolve(); }
    });
    try {
      if (navigator.locks?.request) await navigator.locks.request('dynamax-spoken-notification', speak);
      else await speak();
    } finally {
      activeUtterance = null;
      speaking = false;
      window.setTimeout(() => { void drain(); }, 1000);
    }
  }

  function configure(next) {
    const changed = context?.recipientKey !== next?.recipientKey || context?.branchId !== next?.branchId;
    if (changed) {
      generation += 1;
      pending.clear();
      if (activeUtterance) window.speechSynthesis.cancel();
    }
    context = next?.recipientKey ? { ...next } : null;
  }

  function announce(row) {
    if (!eligible(row)) return false;
    const key = alertKey(row);
    if (!key || seen(key)) return false;
    pending.set(key, row);
    if (pending.size > 20) pending.delete(pending.keys().next().value);
    void drain();
    return true;
  }

  const activate = () => { activated = true; void drain(); };
  document.addEventListener('pointerdown', activate);
  document.addEventListener('keydown', activate);
  document.addEventListener('visibilitychange', () => { void drain(); });
  window.DynamaxSpokenNotifications = {
    configure, announce, enabled, supported,
    setEnabled(value) {
      if (!context) return;
      write(storageKey('enabled'), value ? 'yes' : 'no');
      if (!value) {
        pending.clear();
        if (activeUtterance) window.speechSynthesis.cancel();
      }
      else activate();
    },
    test() {
      activate();
      announce({ NotificationId: `voice-test:${Date.now()}`, Category: 'Requisitions', CreatedAt: new Date().toISOString(),
        Title: 'Spoken notifications are enabled', Message: 'New requisition and presence alerts will be read aloud while this app is open.' });
    }
  };
})();
