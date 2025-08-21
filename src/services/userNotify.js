// services/userNotify.js
const { db } = require('./firebaseService');
const { sendToTokens } = require('./fcmService');

async function getUserTokens(userId) {
  const snap = await db.collection('user_fcm_tokens').doc(userId).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return Array.isArray(data.tokens) ? data.tokens : [];
}

/**
 * Kirim notifikasi update status order ke user.
 * - DATA untuk app (rich inbox)
 * - NOTIFICATION fallback untuk OS (saat app mati/Doze)
 * - collapseKey = orderId → update menggantikan notif sebelumnya
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
  const extra = Math.max(0, itemNames.length - top3.length);

  const statusTxt = statusTextOverride || ({
    pending:    'Pesanan menunggu konfirmasi',
    processing: 'Pesanan sedang diproses',
    shipping:   'Pesanan sedang dikirim',
    delivered:  'Pesanan sudah diterima',
    done:       'Pesanan selesai',
    completed:  'Pesanan selesai',
    canceled:   'Pesanan dibatalkan',
  }[(order.status || '').toLowerCase()] || 'Status diperbarui');

  const title = 'Status Pesanan Diperbarui';
  const body  = `${order.customer?.name || 'Pesanan'} • ${statusTxt}`;
  const orderId = String(order.orderId);

  const payload = {
    data: {
      type: 'order_status_update',
      orderId,
      customer_name: String(order.customer?.name || ''),
      status: String(order.status || 'pending'),
      status_text: statusTxt,
      items_json: JSON.stringify(top3),
      items_more: String(extra),
      _title: title,
      _body: body,
    },
    android: {
      priority: 'high',
      ttl: 24 * 60 * 60 * 1000,
      collapseKey: orderId,
      notification: {
        channelId: 'order_updates',
        tag: orderId,
      },
    },
    // ✅ fallback agar tetap ada teks kalau app mati
    notification: { title, body },
  };

  return sendToTokens(tokens, payload);
}

module.exports = { notifyUserOrderUpdate };
