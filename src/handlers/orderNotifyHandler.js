// handlers/orderNotifyHandler.js
const { admin, db } = require('../services/firebaseService');
const { sendToTokens } = require('../services/fcmService');

const STATUS_TEXT = {
  pending:   'Pesanan menunggu konfirmasi',
  processing:'Pesanan sedang diproses',
  shipping:  'Pesanan sedang dikirim',
  delivered: 'Pesanan sudah diterima',
  done:      'Pesanan selesai',
  completed: 'Pesanan selesai',
  canceled:  'Pesanan dibatalkan',
};

async function updateOrderStatusHandler(request, h) {
  const { orderId } = request.params;
  const { status }  = request.payload || {};

  const ref  = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    return h.response({ status: 'fail', message: 'Order not found' }).code(404);
  }

  const order = snap.data();
  await ref.update({ status, updated_at: new Date().toISOString() });

  // ambil token milik user
  const tokDoc = await db.collection('user_fcm_tokens').doc(order.userId).get();
  const tokens = tokDoc.exists ? (tokDoc.data().tokens || []) : [];
  console.log('[NOTIFY] order', orderId, 'user', order.userId, 'tokens=', tokens.length);

  if (tokens.length) {
    const carts = Array.isArray(order.carts) ? order.carts : [];

    // Ambil semua nama buket (potong agar payload FCM tidak kebesaran)
    const MAX_ITEMS = 5;          // tampilkan maksimal 5 baris
    const MAX_NAME_LEN = 40;      // maksimal 40 char per nama agar ringkas
    const namesAll = carts
      .map(it => (it?.name || '').trim())
      .filter(Boolean)
      .map(s => (s.length > MAX_NAME_LEN ? s.slice(0, MAX_NAME_LEN) + '…' : s));

    const namesTop = namesAll.slice(0, MAX_ITEMS);
    const more = Math.max(namesAll.length - namesTop.length, 0);

    const customerName = order?.customer?.name || ''; // jangan kirim userId

    const res = await sendToTokens(tokens, {
      title: 'Status Pesanan Diperbarui',
      body:  STATUS_TEXT[status] || `Status: ${status}`, // collapsed default
      data: {
        type: 'order_status_update',
        orderId,
        status,
        status_text: STATUS_TEXT[status] || status,
        customer_name: customerName,
        // JSON array string berisi list nama buket (untuk InboxStyle)
        items_json: JSON.stringify(namesTop),
        items_more: String(more), // sisa item jika > MAX_ITEMS
      },
    });

    console.log('[NOTIFY] sent:', res.successCount, 'ok,', res.failureCount, 'fail');

    // bersihkan token invalid jika tersedia respon per-token
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
