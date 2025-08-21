// handlers/orderNotifyHandler.js
const { admin, db } = require('../services/firebaseService');
const { sendToTokens } = require('../services/fcmService');

const STATUS_TEXT = {
  pending:    'Pesanan menunggu konfirmasi',
  processing: 'Pesanan sedang diproses',
  shipping:   'Pesanan sedang dikirim',
  delivered:  'Pesanan sudah diterima',
  done:       'Pesanan selesai',
  completed:  'Pesanan selesai',
  canceled:   'Pesanan dibatalkan',
};

function normStatus(s = '') {
  const v = String(s).toLowerCase().trim();
  if (['process','processing','diproses'].includes(v)) return 'processing';
  if (['shipping','shipped','dikirim'].includes(v))   return 'shipping';
  if (['delivered','terkirim'].includes(v))           return 'delivered';
  if (['done','completed','selesai'].includes(v))     return 'done';
  if (['canceled','cancelled','batal'].includes(v))   return 'canceled';
  if (['pending','menunggu'].includes(v))             return 'pending';
  return 'pending';
}

async function updateOrderStatusHandler(request, h) {
  const { orderId } = request.params;
  const s0 = request?.payload?.status || 'pending';
  const status = normStatus(s0);

  const ref  = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    return h.response({ status: 'fail', message: 'Order not found' }).code(404);
  }

  const order = snap.data() || {};
  await ref.update({ status, updated_at: new Date().toISOString() });

  // ambil token milik user
  const tokDoc = await db.collection('user_fcm_tokens').doc(order.userId).get();
  const tokens = tokDoc.exists ? (tokDoc.data().tokens || []) : [];
  console.log('[NOTIFY] order', orderId, 'user', order.userId, 'tokens=', tokens.length);

  if (tokens.length) {
    const carts = Array.isArray(order.carts) ? order.carts : [];

    const MAX_ITEMS = 5;
    const MAX_NAME_LEN = 40;
    const namesAll = carts
      .map(it => (it?.name || '').trim())
      .filter(Boolean)
      .map(s => (s.length > MAX_NAME_LEN ? s.slice(0, MAX_NAME_LEN) + '…' : s));
    const namesTop = namesAll.slice(0, MAX_ITEMS);
    const more = Math.max(namesAll.length - namesTop.length, 0);

    const customerName = order?.customer?.name || '';

    const title = 'Status Pesanan Diperbarui';
    const body  = `${customerName || 'Pesanan'} • ${STATUS_TEXT[status] || `Status: ${status}`}`;

    const payload = {
      data: {
        type: 'order_status_update',
        orderId,
        status,
        status_text: STATUS_TEXT[status] || status,
        customer_name: customerName,
        items_json: JSON.stringify(namesTop),
        items_more: String(more),

        // dipakai client sbg judul & collapsed text
        _title: title,
        _body:  body,
      },
      // ✅ penting utk bg delivery & menimpa notif lama
      android: {
        priority: 'high',
        ttl: 24 * 60 * 60 * 1000, // 24 jam
        collapseKey: String(orderId),
        notification: { channelId: 'order_updates', tag: String(orderId) },
      },
      // ✅ Fallback agar tidak blank saat app mati
      notification: { title, body },
    };

    const res = await sendToTokens(tokens, payload);
    console.log('[NOTIFY] sent:', res.successCount, 'ok,', res.failureCount, 'fail');

    // bersihkan token invalid jika ada
    if (res.responses?.length) {
      const bad = [];
      res.responses.forEach((r, i) => {
        const code = r?.error?.code || r?.error?.errorInfo?.code;
        if (code === 'messaging/registration-token-not-registered') bad.push(tokens[i]);
      });
      if (bad.length) {
        await db.collection('user_fcm_tokens').doc(order.userId).set({
          tokens: admin.firestore.FieldValue.arrayRemove(...bad),
          updated_at: new Date().toISOString(),
        }, { merge: true });
        console.log('[NOTIFY] removed invalid tokens:', bad.length);
      }
    }
  }

  return h.response({ status: 'success' }).code(200);
}

module.exports = { updateOrderStatusHandler };
