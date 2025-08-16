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
  // NOTE: kalau adminmu pakai "canceled", tambahkan juga di sini & di Joi route!
};

async function updateOrderStatusHandler(request, h) {
  const { orderId } = request.params;
  const { status } = request.payload || {};

  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return h.response({ status:'fail', message:'Order not found' }).code(404);

  const order = snap.data();
  await ref.update({ status, updated_at: new Date().toISOString() });

  const tokDoc = await db.collection('user_fcm_tokens').doc(order.userId).get();
  const tokens = tokDoc.exists ? (tokDoc.data().tokens || []) : [];
  console.log('[NOTIFY] order', orderId, 'user', order.userId, 'tokens=', tokens.length);

  if (tokens.length) {
    const fcmRes = await sendToTokens(tokens, {
      title: 'Status Pesanan Diperbarui',
      body: STATUS_TEXT[status] || `Status: ${status}`,
      data: { type: 'order_status_update', orderId, status },
    });
    console.log('[NOTIFY] sent:', fcmRes.successCount, 'ok,', fcmRes.failureCount, 'fail');
  }
  return h.response({ status: 'success' }).code(200);
}

module.exports = { updateOrderStatusHandler };
