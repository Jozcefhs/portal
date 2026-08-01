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
    return navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }

  async function firebaseMessaging(config) {
    if (messagingInstance) return messagingInstance;
    const [{ initializeApp, getApps }, messagingModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js')
    ]);
    const app = getApps()[0] || initializeApp({
      apiKey: config.apiKey,
      projectId: config.projectId,
      appId: config.appId,
      messagingSenderId: config.messagingSenderId
    });
    const messaging = messagingModule.getMessaging(app);
    messagingModule.onMessage(messaging, (payload) => {
      window.dispatchEvent(new CustomEvent('dynamax:foreground-notification', { detail: payload }));
    });
    messagingInstance = { messaging, module: messagingModule };
    return messagingInstance;
  }

  async function enable(config, save) {
    if (!config?.enabled) throw new Error('Browser push is not configured for this deployment.');
    if (!('Notification' in window)) throw new Error('This browser does not support notifications.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted. You can change it in browser site settings.');
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
      deviceName: `${navigator.platform || 'Browser'} · ${navigator.userAgentData?.brands?.[0]?.brand || 'Web'}`,
      platform: navigator.userAgentData?.platform || navigator.platform || 'Web'
    };
    await save(subscription);
    return subscription;
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
