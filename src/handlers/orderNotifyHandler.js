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

  // Ambil token user
  const tokDoc = await db.collection('user_fcm_tokens').doc(order.userId).get();
  const tokens = tokDoc.exists ? (tokDoc.data().tokens || []) : [];
  console.log('[NOTIFY] order', orderId, 'user', order.userId, 'tokens=', tokens.length);

  if (tokens.length) {
    const carts = Array.isArray(order.carts) ? order.carts : [];
    const firstName = carts[0]?.name || '';                      // nama buket pertama
    const customerName = (order.customer && order.customer.name)  // NAMA pelanggan
      ? order.customer.name
      : '';                                                      // jika tak ada, kosongkan (jangan pakai userId)

    const res = await sendToTokens(tokens, {
      title: 'Status Pesanan Diperbarui',
      body: STATUS_TEXT[status] || `Status: ${status}`, // hanya untuk collapsed default
      data: {
        type: 'order_status_update',
        orderId,
        status,
        status_text: STATUS_TEXT[status] || status,
        customer_name: customerName,
        buket_name: firstName,
      },
    });

    console.log('[NOTIFY] sent:', res.successCount, 'ok,', res.failureCount, 'fail');

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
