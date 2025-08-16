// handlers/orderNotifyHandler.js
const { db } = require('../services/firebaseService');
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

  if (!status) {
    return h.response({ status: 'fail', message: 'status required' }).code(400);
  }

  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    return h.response({ status: 'fail', message: 'Order not found' }).code(404);
  }

  const order = snap.data();
  await ref.update({ status, updated_at: new Date().toISOString() });

  // ambil token user
  const tokDoc = await db.collection('user_fcm_tokens').doc(order.userId).get();
  const tokens = tokDoc.exists ? (tokDoc.data().tokens || []) : [];

  if (tokens.length) {
    const res = await sendToTokens(tokens, {
      title: 'Status Pesanan Diperbarui',
      body: STATUS_TEXT[status] || `Status: ${status}`,
      data: { type: 'order_status_update', orderId, status },
    });

    // hapus token invalid (not-registered, invalid-argument, dll)
    const invalid = [];
    res.responses?.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')
        ) {
          invalid.push(tokens[idx]);
        }
      }
    });

    if (invalid.length) {
      await db.collection('user_fcm_tokens').doc(order.userId).update({
        tokens: tokens.filter(t => !invalid.includes(t)),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return h.response({ status: 'success' }).code(200);
}

module.exports = { updateOrderStatusHandler };
