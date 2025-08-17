// services/fcmService.js
const { admin } = require('./firebaseService');

/**
 * Kirim push ke banyak token sebagai DATA-ONLY message.
 * - Tidak pernah menambahkan notification{title, body} di top-level
 * - Mengatur android.priority=high agar diterima di background
 * - Compatible dengan berbagai versi API Firebase Admin
 */
async function sendToTokens(tokens, payload = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  // pastikan semua data bertipe string
  const dataStr = {};
  for (const [k, v] of Object.entries(payload.data || {})) dataStr[k] = String(v);

  const android = {
    priority: 'high',
    // channelId opsional (berguna jika suatu saat pakai notification payload)
    notification: { channelId: 'order_updates' },
    ...(payload.android || {}),
  };

  const messaging = admin.messaging();

  // 1) API modern: sendEachForMulticast
  if (typeof messaging.sendEachForMulticast === 'function') {
    const res = await messaging.sendEachForMulticast({
      tokens,
      data: dataStr,
      android,
    });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: r.success, error: r.error })),
    };
  }

  // 2) API batch: sendAll
  if (typeof messaging.sendAll === 'function') {
    const messages = tokens.map((t) => ({
      token: t,
      data: dataStr,
      android,
    }));
    const res = await messaging.sendAll(messages, /*dryRun=*/false);
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  // 3) API lama: sendMulticast
  if (typeof messaging.sendMulticast === 'function') {
    const res = await messaging.sendMulticast({
      tokens,
      data: dataStr,
      android,
    });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      responses: res.responses.map(r => ({ success: !r.error, error: r.error })),
    };
  }

  // 4) Fallback universal: kirim satu per satu
  let successCount = 0;
  let failureCount = 0;
  const responses = [];

  for (const t of tokens) {
    try {
      await messaging.send({
        token: t,
        data: dataStr,
        android,
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
