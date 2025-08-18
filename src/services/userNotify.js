// services/userNotify.js
const { db } = require('./firebaseService');
const { sendToTokens } = require('./fcmService');

/**
 * Ambil semua FCM token milik user
 */
async function getUserTokens(userId) {
  const snap = await db.collection('user_fcm_tokens').doc(userId).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return Array.isArray(data.tokens) ? data.tokens : [];
}

/**
 * Kirim notifikasi update status order ke user (DATA-ONLY)
 * - collapseKey = orderId → update menggantikan notif sebelumnya
 * - kirim field minimal agar Android bisa “hydrate” jika perlu
 */
async function notifyUserOrderUpdate({ order, statusTextOverride } = {}) {
  if (!order || !order.orderId || !order.userId) return { ok:false, reason:'invalid order' };

  const tokens = await getUserTokens(order.userId);
  if (!tokens.length) return { ok:true, reason:'no-tokens' };

  // ringkas nama item (maks 3)
  const itemNames = [];
  try {
    (order.carts || []).forEach((c) => { if (c?.name) itemNames.push(c.name); });
  } catch (_) {}
  const top3 = itemNames.slice(0, 3);
  const extra = Math.max(0, itemNames.length - top3.length, 0);

  const payload = {
    data: {
      type: 'order_status_update',
      orderId: String(order.orderId),
      customer_name: String(order.customer?.name || ''),
      status: String(order.status || 'pending'),
      status_text: statusTextOverride || '',
      items_json: JSON.stringify(top3),
      items_more: String(extra),
      _title: 'Status Pesanan Diperbarui',
      _body: `${order.customer?.name || 'Pesanan'} • ${statusTextOverride || order.status || ''}`,
    },
    android: {
      priority: 'high',
      collapseKey: String(order.orderId),
      notification: {
        channelId: 'order_updates',
        tag: String(order.orderId),
      },
      ttl: 60 * 60 * 1000, // 1 jam
    },
  };

  return sendToTokens(tokens, payload);
}

module.exports = { notifyUserOrderUpdate };
