// services/fcmService.js
const { admin } = require('./firebaseService');   // ⬅️ pakai admin dari sini

async function sendToTokens(tokens, { title, body, data = {} } = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0 };
  }

  // pastikan semua value string (syarat FCM)
  const dataStr = {};
  for (const [k, v] of Object.entries(data)) dataStr[k] = String(v);

  // build batch messages
  const messages = tokens.map((t) => ({
    token: t,
    notification: title || body ? { title, body } : undefined,
    data: dataStr,
    android: {
      priority: 'high',
      notification: { channelId: 'order_updates' },
    },
  }));

  // ✅ kompatibel lintas versi admin SDK
  const res = await admin.messaging().sendAll(messages, /*dryRun*/ false);
  return res; // memiliki { successCount, failureCount, responses[] }
}

module.exports = { sendToTokens };
