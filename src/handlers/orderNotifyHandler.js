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

// helper kecil kalau mau pakai total harga
function formatRupiah(n) {
  if (typeof n !== 'number') return '';
  return new Intl.NumberFormat('id-ID').format(n);
}

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

  // ambil token user
  const tokDoc = await db.collection('user_fcm_tokens').doc(order.userId).get();
  const tokens = tokDoc.exists ? (tokDoc.data().tokens || []) : [];
  console.log('[NOTIFY] order', orderId, 'user', order.userId, 'tokens=', tokens.length);

  if (tokens.length) {
    // --- rangkai ringkasan item ---
    const items = Array.isArray(order.carts) ? order.carts : [];
    const names = items.map(it => (it?.name || '')).filter(Boolean);
    const head  = names.slice(0, 2).join(', ');
    const more  = Math.max(names.length - 2, 0);
    const itemsStr = names.length === 0
      ? '-'
      : (more > 0 ? `${head} +${more} lainnya` : head);

    // (opsional) total harga
    // const totalStr = order.totalPrice ? ` • Total Rp ${formatRupiah(order.totalPrice)}` : '';

    const title = 'Status Pesanan Diperbarui';
    const body  = `#${orderId} • ${itemsStr} • ${STATUS_TEXT[status] || status}`;

    const res = await sendToTokens(tokens, {
      title,
      body,
      data: {
        type:    'order_status_update',
        orderId: orderId,
        status:  status,
        // tambahan jika mau dipakai di client
        items:   itemsStr,              // ringkasan item
        // total: order.totalPrice?.toString() || '',
      },
    });

    console.log('[NOTIFY] sent:', res.successCount, 'ok,', res.failureCount, 'fail');

    // bersihkan token invalid (kalau ada response per token)
    if (res.responses?.length) {
      const bad = [];
      res.responses.forEach((r, i) => {
        const code = r?.error?.code || r?.error?.errorInfo?.code;
        if (code === 'messaging/registration-token-not-registered') {
          bad.push(tokens[i]);
        }
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
