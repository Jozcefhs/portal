/* Idle time follows user input, never background API calls. Tokens stay in memory. */
(function (root) {
  const IDLE_MS = 2 * 60 * 60 * 1000;
  const RENEW_INTERVAL_MS = 60 * 1000;
  function tokenTiming(token) {
    try {
      const part = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      const value = JSON.parse(root.atob(part + '='.repeat((4 - part.length % 4) % 4)));
      if (value.purpose !== 'staff-session' || !value.exp) return null;
      return { id: value.sid || '', expiresAt: value.exp * 1000,
        lastActivityAt: (value.activityAt || value.exp - IDLE_MS / 1000) * 1000,
        serverNow: (value.iat || value.activityAt || value.exp - IDLE_MS / 1000) * 1000 };
    } catch (_) { return null; }
  }
  function create({ renew, onToken, onExpire, now = () => Date.now(),
    setTimer = (fn, ms) => root.setTimeout(fn, ms), clearTimer = id => root.clearTimeout(id) }) {
    let state = null, generation = 0, timer = null, inFlight = null;
    let channel = null;
    try { channel = root.BroadcastChannel ? new root.BroadcastChannel('dynamax-staff-idle-session') : null; } catch (_) { /* optional */ }
    function broadcast(message) {
      if (state?.id) channel?.postMessage({ ...message, id: state.id, username: state.username });
    }
    function stop() {
      generation++;
      state = null;
      inFlight = null;
      clearTimer(timer);
      timer = null;
    }
    function expire(message = 'You have been signed out after two hours without activity. Please sign in again.') {
      if (!state) return;
      stop();
      onExpire(message);
    }
    function applyTiming(timing, token = '') {
      if (!state || !timing || !Number.isFinite(timing.expiresAt) || !Number.isFinite(timing.serverNow)
        || !Number.isFinite(timing.lastActivityAt)) return false;
      const clock = now();
      const activity = clock - Math.max(0, timing.serverNow - timing.lastActivityAt);
      const expiry = clock + Math.max(0, timing.expiresAt - timing.serverNow);
      // A slow reply from another tab must not replace a newer credential.
      if (state.serverExpiry && timing.expiresAt < state.serverExpiry) return false;
      state.id = timing.id || state.id;
      state.serverExpiry = timing.expiresAt;
      state.expiresAt = expiry;
      state.acknowledged = Math.max(state.acknowledged, activity);
      state.lastActivity = Math.max(state.lastActivity, activity);
      if (token) onToken(token);
      return true;
    }
    function start({ username, session, sessionToken = '' }) {
      stop();
      const timing = session || tokenTiming(sessionToken);
      if (!timing) return;
      state = { username: String(username || '').toLowerCase(), id: timing.id || '',
        lastActivity: 0, acknowledged: 0, nextRenewAt: now() + RENEW_INTERVAL_MS, serverExpiry: 0 };
      if (!applyTiming(timing, sessionToken)) { stop(); return; }
      schedule();
    }
    function alive() {
      if (!state) return false;
      if (now() >= state.lastActivity + IDLE_MS) { expire(); return false; }
      if (now() >= state.expiresAt) {
        // An expired credential is never revived, even when an offline tab
        // remembers input that the server could not receive.
        expire('Your staff session could not be renewed before it expired. Please sign in again.');
        return false;
      }
      return true;
    }
    function schedule() {
      clearTimer(timer);
      if (!state) return;
      const deadline = Math.min(state.lastActivity + IDLE_MS, state.expiresAt);
      const pending = state.lastActivity > state.acknowledged + 1000;
      const next = pending && !inFlight ? Math.min(deadline, state.nextRenewAt) : deadline;
      timer = setTimer(() => { if (alive()) { void flush(); schedule(); } }, Math.max(1, next - now()));
    }
    function activity(event) {
      if (!event?.isTrusted || !alive()) return;
      state.lastActivity = now();
      broadcast({ type: 'activity', at: state.lastActivity });
      // Renew promptly if the prior credential is near expiry.
      if (state.expiresAt - now() < RENEW_INTERVAL_MS) state.nextRenewAt = now();
      void flush();
      schedule();
    }
    async function flush() {
      if (!alive() || inFlight || state.lastActivity <= state.acknowledged + 1000 || now() < state.nextRenewAt) return;
      const run = generation, sentActivity = state.lastActivity;
      state.nextRenewAt = now() + RENEW_INTERVAL_MS;
      const operation = (async () => {
        try {
          const result = await Promise.resolve().then(() => renew(Math.max(0, now() - sentActivity)));
          if (run !== generation || !state) return;
          if (result.status === 401 || result.status === 403) {
            expire(result.message || 'Your staff session has expired. Please sign in again.');
          } else if (result.ok && applyTiming(result.session, result.sessionToken)) {
            state.acknowledged = Math.max(state.acknowledged, sentActivity);
            broadcast({ type: 'renewed', session: result.session, sessionToken: result.sessionToken });
          }
        } catch (_) {
          // A transient failure is retried only for actual, unacknowledged
          // input. It must not itself become a new activity timestamp.
        } finally {
          if (run === generation) { inFlight = null; schedule(); }
        }
      })();
      inFlight = operation;
      return operation;
    }
    function check() {
      if (alive()) { void flush(); schedule(); }
    }
    if (channel) channel.onmessage = ({ data }) => {
      if (!state || data?.id !== state.id || data?.username !== state.username) return;
      if (data.type === 'activity' && Number.isFinite(data.at) && data.at <= now() && data.at > state.lastActivity) {
        if (!alive()) return;
        state.lastActivity = data.at;
      } else if (data.type === 'renewed') {
        applyTiming(data.session, data.sessionToken);
      }
      schedule();
    };
    return { start, stop, activity, check, flush };
  }
  root.DynamaxStaffIdleSession = { create, tokenTiming, IDLE_MS };
}(typeof window === 'undefined' ? globalThis : window));
