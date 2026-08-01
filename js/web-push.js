(() => {
  const DEVICE_KEY = 'dynamax-notification-device-id';
  let messagingInstance = null;

  function deviceId() {
    let value = localStorage.getItem(DEVICE_KEY);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, value);
    }
    return value;
  }

  async function serviceWorker() {
    if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    return navigator.serviceWorker.ready;
  }

  async function firebaseMessaging(config) {
    if (messagingInstance?.projectId === config.projectId) return messagingInstance;
    const [{ initializeApp, getApps }, messagingModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js')
    ]);
    if (!(await messagingModule.isSupported())) throw new Error('This browser cannot receive web push notifications.');
    const appName = `dynamax-messaging-${String(config.projectId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const app = getApps().find((item) => item.name === appName) || initializeApp({
      apiKey: config.apiKey,
      projectId: config.projectId,
      appId: config.appId,
      messagingSenderId: config.messagingSenderId
    }, appName);
    const messaging = messagingModule.getMessaging(app);
    messagingModule.onMessage(messaging, (payload) => {
      window.dispatchEvent(new CustomEvent('dynamax:foreground-notification', { detail: payload }));
    });
    messagingInstance = { messaging, module: messagingModule, projectId: config.projectId };
    return messagingInstance;
  }

  function readableError(error) {
    const code = String(error?.code || '').toLowerCase();
    if (code.includes('permission-blocked') || code.includes('permission-default')) {
      return 'Push notifications are blocked. Allow notifications for this site in browser settings, then try again.';
    }
    if (code.includes('unsupported-browser')) return 'This browser cannot receive web push notifications.';
    if (code.includes('failed-service-worker-registration')) return 'Push setup could not start on this browser. Reload the page and try again.';
    if (code.includes('token-subscribe-failed') || code.includes('token-update-failed')) return 'This device could not connect to the push service. Check your internet connection and try again.';
    return String(error?.message || 'Push setup failed. Reload the page and try again.');
  }

  async function enable(config, save) {
    if (!config?.enabled) throw new Error('Browser push is not configured for this deployment.');
    if (!('Notification' in window)) throw new Error('This browser does not support notifications.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted. You can change it in browser site settings.');
    try {
      const registration = await serviceWorker();
      const current = await firebaseMessaging(config);
      const token = await current.module.getToken(current.messaging, {
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: registration
      });
      if (!token) throw new Error('The browser did not return a push subscription token.');
      const subscription = {
        deviceId: deviceId(),
        token,
        deviceName: `${navigator.platform || 'Browser'} - ${navigator.userAgentData?.brands?.[0]?.brand || 'Web'}`,
        platform: navigator.userAgentData?.platform || navigator.platform || 'Web'
      };
      await save(subscription);
      return subscription;
    } catch (error) {
      throw new Error(readableError(error));
    }
  }

  async function disable(remove) {
    const id = deviceId();
    if (messagingInstance) await messagingInstance.module.deleteToken(messagingInstance.messaging).catch(() => false);
    await remove(id);
    return id;
  }

  window.DynamaxWebPush = {
    deviceId,
    enable,
    disable,
    permission: () => ('Notification' in window ? Notification.permission : 'unsupported')
  };
})();
