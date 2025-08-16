// services/fcmService.js
const { admin } = require('./firebaseService');

/**
 * Kirim push ke banyak token dengan cara paling kompatibel:
 * - Coba API batch modern (sendEachForMulticast / sendAll / sendMulticast) bila ada
 * - Fallback universal: loop .send() per-token
 */
async function sendToTokens(tokens, { title, body, data = {} } = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  // pastikan semua value string
  const dataStr = {};
  for (const [k, v] of Object.entries(data)) dataStr[k] = String(v);

  const messaging = admin.messaging();

  // ==== 1) API baru: sendEachForMulticast ====
  if (typeof messaging.sendEachForMulticast === 'function') {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: title || body ? { title, body } : undefined,
      data: dataStr,
      android: { priority: 'high', notification: { channelId: 'order_updates' } },
    });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: r.success, error: r.error })),
    };
  }

  // ==== 2) API batch lama: sendAll ====
  if (typeof messaging.sendAll === 'function') {
    const messages = tokens.map((t) => ({
      token: t,
      notification: title || body ? { title, body } : undefined,
      data: dataStr,
      android: { priority: 'high', notification: { channelId: 'order_updates' } },
    }));
    const res = await messaging.sendAll(messages, /*dryRun=*/false);
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  // ==== 3) API batch lama: sendMulticast ====
  if (typeof messaging.sendMulticast === 'function') {
    const res = await messaging.sendMulticast({
      tokens,
      notification: title || body ? { title, body } : undefined,
      data: dataStr,
      android: { priority: 'high', notification: { channelId: 'order_updates' } },
    });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  // ==== 4) Fallback universal: kirim satu per satu pakai send() ====
  let successCount = 0;
  let failureCount = 0;
  const responses = [];

  for (const t of tokens) {
    try {
      await messaging.send({
        token: t,
        notification: title || body ? { title, body } : undefined,
        data: dataStr,
        android: { priority: 'high', notification: { channelId: 'order_updates' } },
      }, /*dryRun=*/false);
      successCount++;
      responses.push({ success: true, error: null });
    } catch (err) {
      failureCount++;
      responses.push({ success: false, error: err });
    }
  }

  return { successCount, failureCount, responses };
}

module.exports = { sendToTokens };
