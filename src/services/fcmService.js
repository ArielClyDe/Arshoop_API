// services/fcmService.js
const { admin, db } = require('./firebaseService'); // db opsional kalau mau bersihin token invalid

/**
 * Kirim push ke banyak token, kompatibel lintas versi firebase-admin:
 * - v11+: sendAll
 * - v9/10: sendMulticast
 * - v8 (jadul): sendToDevice
 */
async function sendToTokens(tokens, { title, body, data = {} } = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  // pastikan data string
  const dataStr = {};
  for (const [k, v] of Object.entries(data)) dataStr[k] = String(v);

  const messaging = admin.messaging();

  // --- 1) admin v11+ ---
  if (typeof messaging.sendAll === 'function') {
    const messages = tokens.map((t) => ({
      token: t,
      notification: title || body ? { title, body } : undefined,
      data: dataStr,
      android: {
        priority: 'high',
        notification: { channelId: 'order_updates' },
      },
    }));
    return await messaging.sendAll(messages, false);
  }

  // --- 2) admin v9/10 ---
  if (typeof messaging.sendMulticast === 'function') {
    return await messaging.sendMulticast({
      tokens,
      notification: title || body ? { title, body } : undefined,
      data: dataStr,
      android: {
        priority: 'high',
        notification: { channelId: 'order_updates' },
      },
    });
  }

  // --- 3) admin v8 (fallback) ---
  // Catatan: channelId tidak bisa diatur di sendToDevice (pakai FCM legacy),
  // tapi notifikasi tetap keluar saat background.
  const payload = {
    notification: title || body ? { title, body } : undefined,
    data: dataStr,
  };
  const options = { priority: 'high' };
  const res = await messaging.sendToDevice(tokens, payload, options);
  // Normalisasi supaya mirip hasil sendAll/sendMulticast
  return {
    successCount: res.successCount,
    failureCount: res.failureCount,
    responses: (res.results || []).map((r) => ({ success: !r.error, error: r.error })),
  };
}

module.exports = { sendToTokens };
