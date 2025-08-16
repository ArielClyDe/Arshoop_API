// services/fcmService.js
const { admin } = require('./firebaseService');

/**
 * Kirim notifikasi ke banyak token.
 * - title/body diisi → notifikasi muncul saat app background
 * - data wajib string
 */
async function sendToTokens(tokens, { title, body, data = {} } = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const dataStr = {};
  Object.entries(data).forEach(([k, v]) => (dataStr[k] = String(v)));

  const res = await admin.messaging().sendMulticast({
    tokens,
    notification: title || body ? { title, body } : undefined,
    data: dataStr,
    android: {
      priority: 'high',
      notification: { channelId: 'order_updates' }, // match channel di Android
    },
  });

  return res;
}

module.exports = { sendToTokens };
