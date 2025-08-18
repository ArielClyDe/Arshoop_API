// services/adminNotify.js
const { admin, db } = require('./firebaseService');
const { sendToTokens } = require('./fcmService');

// status pembayaran yang dianggap sukses
const PAID_OK = new Set(['paid', 'settlement', 'capture_accept', 'capture-accept']);

async function getAdminUserIds() {
  const ROLE_VALUES = ['admin', 'Admin', 'ADMIN'];
  try {
    const qs = await db.collection('users').where('role', 'in', ROLE_VALUES).get();
    const ids = qs.docs.map(d => d.id);
    if (ids.length) return ids;
  } catch {
    const snap = await db.collection('users').get();
    const ids = snap.docs
      .filter(d => ROLE_VALUES.includes(String(d.data().role || '').trim()))
      .map(d => d.id);
    if (ids.length) return ids;
  }
  const envList = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return envList;
}

async function getTokensForUsers(userIds = []) {
  if (!userIds.length) return [];
  const refs = userIds.map(uid => db.collection('user_fcm_tokens').doc(uid));
  const snaps = await db.getAll(...refs);
  const all = [];
  snaps.forEach(s => {
    if (!s.exists) return;
    const arr = s.data()?.tokens || [];
    arr.forEach(t => t && all.push(String(t)));
  });
  return Array.from(new Set(all));
}

/**
 * Kirim notif admin untuk order yang SUDAH BAYAR.
 * Panggil fungsi ini sesudah webhook Midtrans konfirmasi "paid", atau dari createOrder hanya untuk COD.
 */
async function notifyAdminsNewOrder(order) {
  const pay = String(order?.paymentStatus || order?.midtransStatus || '').toLowerCase();
  if (!PAID_OK.has(pay)) {
    console.log('[ADMIN NOTIFY] skip (payment not paid yet):', pay);
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  const adminIds = await getAdminUserIds();
  if (!adminIds.length) return { successCount: 0, failureCount: 0, responses: [] };

  const targetAdminIds = adminIds.filter(uid => uid !== order.userId);
  const tokens = await getTokensForUsers(targetAdminIds);
  console.log('[ADMIN NOTIFY] admins=', targetAdminIds.length, 'tokens=', tokens.length);
  if (!tokens.length) return { successCount: 0, failureCount: 0, responses: [] };

  const carts = Array.isArray(order.carts) ? order.carts : [];
  const MAX_ITEMS = 5, MAX_NAME_LEN = 40;
  const namesAll = carts
    .map(it => (it?.name || '').trim())
    .filter(Boolean)
    .map(s => (s.length > MAX_NAME_LEN ? s.slice(0, MAX_NAME_LEN) + '…' : s));
  const namesTop = namesAll.slice(0, MAX_ITEMS);
  const more = Math.max(namesAll.length - namesTop.length, 0);

  const customerName = order?.customer?.name || order?.userId || '';
  const totalPrice   = String(order?.totalPrice ?? '');

  const payload = {
    data: {
      type: 'admin_order_new',
      orderId: order.orderId,
      customer_name: customerName,
      total_price: totalPrice,
      items_json: JSON.stringify(namesTop),
      items_more: String(more),
      _title: `Pesanan Baru #${order.orderId}`,
      _body:  `${customerName || 'Pelanggan'} • Total Rp ${totalPrice}`,
    },
    android: { priority: 'high', ttl: 0 },
  };

  const res = await sendToTokens(tokens, payload);
  console.log('[ADMIN NOTIFY] sent:', res.successCount, 'ok,', res.failureCount, 'fail');

  if (res.responses?.length) {
    const bad = [];
    res.responses.forEach((r, i) => {
      const code = r?.error?.code || r?.error?.errorInfo?.code;
      if (code === 'messaging/registration-token-not-registered') bad.push(tokens[i]);
    });
    if (bad.length) {
      await Promise.all(targetAdminIds.map(uid =>
        db.collection('user_fcm_tokens').doc(uid).set({
          tokens: admin.firestore.FieldValue.arrayRemove(...bad),
          updated_at: new Date().toISOString(),
        }, { merge: true })
      ));
      console.log('[ADMIN NOTIFY] removed invalid tokens:', bad.length);
    }
  }

  return res;
}

module.exports = { notifyAdminsNewOrder };
