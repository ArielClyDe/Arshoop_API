// services/fcmService.js
const { admin } = require('./firebaseService');

/**
 * Kirim push ke banyak token.
 * - Tetap kirim DATA (agar app bisa render rich)
 * - Tambahkan fallback NOTIFICATION (title/body) supaya sistem tetap bisa tampilkan teks jika app mati/Doze
 * - android.priority=high agar cepat
 * - collapseKey & tag silakan set dari payload.android/notification di pemanggil
 */
async function sendToTokens(tokens, payload = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  // ✅ pastikan semua data bertipe string
  const dataStr = {};
  for (const [k, v] of Object.entries(payload.data || {})) dataStr[k] = String(v);

  // ✅ android config dasar
  const android = {
    priority: 'high',
    ttl: typeof payload?.android?.ttl === 'number' ? payload.android.ttl : 24 * 60 * 60 * 1000, // 24 jam
    notification: {
      channelId: (payload?.android?.notification?.channelId) || 'order_updates',
      tag: payload?.android?.notification?.tag,
    },
    collapseKey: payload?.android?.collapseKey,
    ...payload.android,
    notification: {
      channelId: (payload?.android?.notification?.channelId) || 'order_updates',
      tag: payload?.android?.notification?.tag,
      ...payload?.android?.notification,
    },
  };

  // ✅ Fallback notification (jaga-jaga kalau app mati)
  // Jika pemanggil sudah kirim payload.notification → pakai itu.
  // Kalau belum, coba auto-isi dari data._title/_body. Jika tetap kosong, beri default.
  let notification = payload.notification;
  const dataTitle = (payload.data && (payload.data._title || payload.data.title)) || '';
  const dataBody  = (payload.data && (payload.data._body  || payload.data.body )) || '';
  if (!notification || (!notification.title && !notification.body)) {
    notification = {
      title: String(dataTitle || 'Pembaruan Pesanan'),
      body:  String(dataBody  || 'Status pesanan diperbarui.'),
    };
  }

  const messaging = admin.messaging();

  // Helper builder
  const baseMsg = { data: dataStr, android, notification };

  // 1) API modern
  if (typeof messaging.sendEachForMulticast === 'function') {
    const res = await messaging.sendEachForMulticast({ tokens, ...baseMsg });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: r.success, error: r.error })),
    };
  }

  // 2) API batch
  if (typeof messaging.sendAll === 'function') {
    const messages = tokens.map(t => ({ token: t, ...baseMsg }));
    const res = await messaging.sendAll(messages, /*dryRun=*/false);
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  // 3) API lama
  if (typeof messaging.sendMulticast === 'function') {
    const res = await messaging.sendMulticast({ tokens, ...baseMsg });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  // 4) Fallback satu-satu
  let successCount = 0, failureCount = 0; const responses = [];
  for (const t of tokens) {
    try {
      await messaging.send({ token: t, ...baseMsg }, /*dryRun=*/false);
      successCount++; responses.push({ success: true, error: null });
    } catch (err) {
      failureCount++; responses.push({ success: false, error: err });
    }
  }
  return { successCount, failureCount, responses };
}

module.exports = { sendToTokens };
