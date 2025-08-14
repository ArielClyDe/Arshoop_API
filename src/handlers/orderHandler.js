// handlers/orderHandler.js
const { db } = require('../services/firebaseService');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
});

const core = new midtransClient.CoreApi({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
});

// --- utils ---
const allowedStatuses = ['pending','processing','shipping','delivered','done','canceled'];

const normalizeStatus = (s='') => {
  const v = String(s).toLowerCase().trim();
  if (['process','processing','diproses'].includes(v)) return 'processing';
  if (['shipping','shipped','dikirim'].includes(v))   return 'shipping';
  if (['delivered','terkirim'].includes(v))           return 'delivered';
  if (['done','completed','selesai'].includes(v))     return 'done';
  if (['canceled','cancelled','batal'].includes(v))   return 'canceled';
  if (['pending','menunggu'].includes(v))             return 'pending';
  return 'pending';
};

const toIso = (tsOrDate) => {
  if (!tsOrDate) return new Date().toISOString();
  if (tsOrDate.toDate) return tsOrDate.toDate().toISOString();
  const d = new Date(tsOrDate);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

// ========== CREATE ORDER ==========
const createOrderHandler = async (request, h) => {
  try {
    const {
      userId,
      carts,
      alamat,
      ongkir = 0,
      paymentMethod,
      deliveryMethod,
      customer
    } = request.payload || {};

    if (!userId || !Array.isArray(carts) || carts.length === 0) {
      return h.response({ status:'fail', message:'Data order tidak lengkap' }).code(400);
    }

    const normalizedPaymentMethod = String(paymentMethod || '').toLowerCase();
    const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random()*1000)}`;

    // Hitung item details (termasuk custom materials)
    const itemDetails = carts.map((item) => {
      const customMaterialTotal = (item.customMaterials || []).reduce(
        (sum, m) => sum + (Number(m.price||0) * Number(m.quantity||0)), 0);
      return {
        id: item.buketId,
        price: Number(item.basePrice || 0) + customMaterialTotal,
        quantity: Number(item.quantity || 0),
        name: item.name || 'Item',
      };
    });

    if (ongkir) {
      itemDetails.push({ id:'ONGKIR', price:Number(ongkir), quantity:1, name:'Ongkos Kirim' });
    }

    const grossAmount = itemDetails.reduce((sum, it) => sum + (Number(it.price)*Number(it.quantity)), 0);

    const orderData = {
      orderId,
      userId,
      carts,
      alamat: alamat || '',
      ongkir: Number(ongkir || 0),
      totalPrice: grossAmount,
      paymentMethod: normalizedPaymentMethod,
      paymentChannel: normalizedPaymentMethod === 'midtrans' ? null : 'COD',
      deliveryMethod: deliveryMethod || 'delivery',
      status: 'pending',
      paymentStatus: normalizedPaymentMethod === 'midtrans' ? 'pending' : 'waiting_payment',
      createdAt: admin.firestore.Timestamp.now(),
      customer: customer || null, // ⬅️ penting
    };

    let midtransToken = null;
    let midtransRedirectUrl = null;

    if (normalizedPaymentMethod === 'midtrans') {
      const midtransParams = {
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        customer_details: {
          first_name: customer?.name || 'User',
          email: customer?.email || 'user@example.com',
          phone: customer?.phone || '',
          shipping_address: { address: alamat || '' },
        },
        item_details: itemDetails,
      };

      const tx = await snap.createTransaction(midtransParams);
      midtransToken = tx.token;
      midtransRedirectUrl = tx.redirect_url;
    }

    await db.collection('orders').doc(orderId).set({
      ...orderData, midtransToken, midtransRedirectUrl,
    });

    // Hapus cart yang dipakai
    const batch = db.batch();
    for (const cartItem of carts) {
      const cartId = cartItem?.cartId;
      if (!cartId) continue;
      const ref = db.collection('carts').doc(cartId);
      const snap = await ref.get();
      if (snap.exists) batch.delete(ref);
    }
    await batch.commit();

    return h.response({
      status:'success',
      message:'Order berhasil dibuat dan cart dihapus',
      data:{ orderId, midtransToken, midtransRedirectUrl }
    }).code(201);
  } catch (error) {
    console.error('Error createOrderHandler:', error);
    return h.response({ status:'fail', message:error.message }).code(500);
  }
};

// ========== MIDTRANS NOTIFICATION ==========
const midtransNotificationHandler = async (request, h) => {
  try {
    const statusResponse = await core.transaction.notification(request.payload);

    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    // Channel
    let paymentChannel = '';
    if (statusResponse.payment_type === 'bank_transfer' && statusResponse.va_numbers?.length) {
      paymentChannel = statusResponse.va_numbers[0].bank?.toUpperCase() || 'BANK_TRANSFER';
    } else if (statusResponse.payment_type === 'qris') {
      paymentChannel = `QRIS ${statusResponse.acquirer?.toUpperCase() || ''}`.trim();
    } else if (statusResponse.payment_type) {
      paymentChannel = statusResponse.payment_type.toUpperCase();
    }

    // Map status
    let paymentStatus;
    if      (transactionStatus === 'capture')    paymentStatus = (fraudStatus === 'accept') ? 'paid' : 'challenge';
    else if (transactionStatus === 'settlement') paymentStatus = 'paid';
    else if (transactionStatus === 'pending')    paymentStatus = 'pending';
    else if (['deny','cancel','expire'].includes(transactionStatus)) paymentStatus = 'failed';

    const updateData = { paymentStatus, paymentMethod:'midtrans', paymentChannel };
    if (paymentStatus === 'paid') updateData.status = 'processing';

    await db.collection('orders').doc(orderId).update(updateData);
    return h.response({ message: 'Notification processed' }).code(200);
  } catch (err) {
    console.error('Error midtransNotificationHandler:', err);
    return h.response({ error: err.message }).code(500);
  }
};

// ========== ADMIN: GET SEMUA ORDER (optional filter & pagination) ==========
const getAllOrdersAdminHandler = async (request, h) => {
  try {
    const { status, paymentStatus, userId, limit = 25 } = request.query || {};
    let ref = db.collection('orders');

    if (userId)       ref = ref.where('userId', '==', userId);
    if (status)       ref = ref.where('status', '==', normalizeStatus(status));
    if (paymentStatus)ref = ref.where('paymentStatus', '==', String(paymentStatus).toLowerCase());

    // supaya tidak perlu composite index, kita tidak pakai orderBy di query
    const snap = await ref.get();

    const data = snap.docs
      .map((d) => {
        const x = d.data();
        return { id: d.id, ...x, createdAt: toIso(x.createdAt) };
      })
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, Number(limit));

    return h.response({ data }).code(200);
  } catch (err) {
    console.error('Error getAllOrdersAdminHandler:', err);
    return h.response({ message: 'Gagal mengambil data order' }).code(500);
  }
};

// ========== USER: GET ORDER MILIKNYA ==========
const getOrdersByUserHandler = async (request, h) => {
  try {
    const { userId } = request.params;

    const snap = await db.collection('orders')
      .where('userId','==', userId)
      .get();

    const orders = snap.docs
      .map(doc => ({ ...doc.data(), createdAt: toIso(doc.data().createdAt) }))
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    return h.response(orders).code(200);
  } catch (error) {
    console.error('Error getOrdersByUserHandler:', error);
    return h.response({ message: 'Gagal mengambil data order' }).code(500);
  }
};

// ========== DETAIL ORDER ==========
const getOrderDetailHandler = async (request, h) => {
  try {
    const { orderId } = request.params;
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) return h.response({ message:'Order tidak ditemukan' }).code(404);
    const data = doc.data();
    return h.response({ data: { ...data, createdAt: toIso(data.createdAt) } }).code(200);
  } catch (error) {
    console.error('Error getOrderDetailHandler:', error);
    return h.response({ message:'Gagal mengambil detail order' }).code(500);
  }
};

// ========== UPDATE STATUS (path param) ==========
const updateOrderStatusByPathHandler = async (request, h) => {
  try {
    const { orderId } = request.params;
    const { status } = request.payload || {};
    const s = normalizeStatus(status);

    if (!allowedStatuses.includes(s)) {
      return h.response({ status:'fail', message:'Status tidak valid' }).code(400);
    }

    await db.collection('orders').doc(orderId).update({
      status: s,
      updatedAt: new Date().toISOString(),
    });

    return h.response({ status:'success', message:`Status order ${orderId} diperbarui menjadi ${s}` }).code(200);
  } catch (error) {
    console.error('Error updateOrderStatusByPathHandler:', error);
    return h.response({ status:'fail', message:error.message }).code(500);
  }
};

// ========== UPDATE STATUS (legacy body: {orderId, status}) ==========
const updateOrderStatusLegacyHandler = async (request, h) => {
  try {
    const { orderId, status } = request.payload || {};
    if (!orderId) return h.response({ status:'fail', message:'orderId wajib' }).code(400);
    const s = normalizeStatus(status);
    if (!allowedStatuses.includes(s)) {
      return h.response({ status:'fail', message:'Status tidak valid' }).code(400);
    }

    await db.collection('orders').doc(orderId).update({
      status: s,
      updatedAt: new Date().toISOString(),
    });

    return h.response({ status:'success', message:`Status order ${orderId} diperbarui menjadi ${s}` }).code(200);
  } catch (error) {
    console.error('Error updateOrderStatusLegacyHandler:', error);
    return h.response({ status:'fail', message:error.message }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  midtransNotificationHandler,
  getAllOrdersAdminHandler,
  getOrdersByUserHandler,
  getOrderDetailHandler,
  updateOrderStatusByPathHandler,
  updateOrderStatusLegacyHandler,
};
