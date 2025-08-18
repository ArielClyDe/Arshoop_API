// services/fcmService.js
const { admin } = require('./firebaseService');

/**
 * Kirim push DATA-ONLY (tanpa notification{}), cepat & konsisten.
 * - android.priority = 'high'
 * - android.ttl = 0 (jangan ditunda)
 */
async function sendToTokens(tokens, payload = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const dataStr = {};
  for (const [k, v] of Object.entries(payload.data || {})) dataStr[k] = String(v);

  const android = {
    priority: 'high',
    ttl: 0,
    notification: { channelId: 'order_updates' },
    ...(payload.android || {}),
  };

  const messaging = admin.messaging();

  if (typeof messaging.sendEachForMulticast === 'function') {
    const res = await messaging.sendEachForMulticast({ tokens, data: dataStr, android });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: r.success, error: r.error })),
    };
  }

  if (typeof messaging.sendAll === 'function') {
    const messages = tokens.map((t) => ({ token: t, data: dataStr, android }));
    const res = await messaging.sendAll(messages, false);
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  if (typeof messaging.sendMulticast === 'function') {
    const res = await messaging.sendMulticast({ tokens, data: dataStr, android });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  // Fallback: kirim satu-satu
  let successCount = 0, failureCount = 0;
  const responses = [];
  for (const t of tokens) {
    try {
      await messaging.send({ token: t, data: dataStr, android }, false);
      successCount++; responses.push({ success: true, error: null });
    } catch (err) {
      failureCount++; responses.push({ success: false, error: err });
    }
  }
  return { successCount, failureCount, responses };
}

module.exports = { sendToTokens };
