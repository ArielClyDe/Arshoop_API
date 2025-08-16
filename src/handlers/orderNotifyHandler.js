// handlers/orderNotifyHandler.js
const { db, admin } = require('../services/firebaseService'); // ⬅️ tambahkan admin di import
const { sendToTokens } = require('../services/fcmService');

const STATUS_TEXT = {
  pending: 'Pesanan menunggu konfirmasi',
  processing: 'Pesanan sedang diproses',
  shipping: 'Pesanan sedang dikirim',
  delivered: 'Pesanan sudah diterima',
  done: 'Pesanan selesai',
  completed: 'Pesanan selesai',
};

async function updateOrderStatusHandler(request, h) {
  const { orderId } = request.params;
  const { status } = request.payload || {};

  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return h.response({ status: 'fail', message: 'Order not found' }).code(404);

  const order = snap.data();
  await ref.update({ status, updated_at: new Date().toISOString() });

  const tokDoc = await db.collection('user_fcm_tokens').doc(order.userId).get();
  const tokens = tokDoc.exists ? (tokDoc.data().tokens || []) : [];
  console.log('[NOTIFY] order', orderId, 'user', order.userId, 'tokens=', tokens.length);

  if (tokens.length) {
    const res = await sendToTokens(tokens, {
      title: 'Status Pesanan Diperbarui',
      body: STATUS_TEXT[status] || `Status: ${status}`,
      data: { type: 'order_status_update', orderId, status },
    });
    console.log('[NOTIFY] sent:', res.successCount, 'ok,', res.failureCount, 'fail');

    // Bersihkan token invalid (jika ada)
    if (res.responses?.length) {
      const badTokens = [];
      res.responses.forEach((r, i) => {
        const code = r?.error?.code || r?.error?.errorInfo?.code;
        if (code === 'messaging/registration-token-not-registered') {
          badTokens.push(tokens[i]);
        }
      });
      if (badTokens.length) {
        await db.collection('user_fcm_tokens').doc(order.userId).set({
          tokens: admin.firestore.FieldValue.arrayRemove(...badTokens),
          updated_at: new Date().toISOString(),
        }, { merge: true });
        console.log('[NOTIFY] removed invalid tokens:', badTokens.length);
      }
    }
  }

  return h.response({ status: 'success' }).code(200);
}

module.exports = { updateOrderStatusHandler };
