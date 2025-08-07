const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');
const midtransClient = require('midtrans-client');

// Inisialisasi Snap Midtrans
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

/**
 * Buat order baru (dengan atau tanpa Midtrans)
 */
const createOrderHandler = async (request, h) => {
  try {
    const {
      userId,
      carts,
      alamat,
      ongkir,
      paymentMethod,
      totalPrice,
      deliveryMethod,
    } = request.payload;

    if (!userId || !carts || carts.length === 0 || !paymentMethod || !totalPrice || !deliveryMethod) {
      return h.response({ status: 'fail', message: 'Data tidak lengkap' }).code(400);
    }

    if (deliveryMethod === 'delivery' && (!alamat || !ongkir)) {
      return h.response({ status: 'fail', message: 'Alamat dan ongkir wajib untuk pengiriman' }).code(400);
    }

    const orderId = uuidv4();

    const orderData = {
      orderId,
      userId,
      deliveryMethod,
      alamat: deliveryMethod === 'delivery' ? alamat : null,
      ongkir: deliveryMethod === 'delivery' ? ongkir : 0,
      paymentMethod,
      totalPrice,
      carts,
      status: paymentMethod === 'cod' ? 'pending' : 'waiting_payment',
      createdAt: new Date().toISOString(),
    };

    await db.collection('orders').doc(orderId).set(orderData);

    // Hapus semua cart user
    const cartSnapshot = await db.collection('carts').where('userId', '==', userId).get();
    const batch = db.batch();
    cartSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return h.response({
      status: 'success',
      message: 'Order berhasil dibuat',
      data: { orderId },
    }).code(201);
  } catch (error) {
    console.error('Gagal membuat order:', error);
    return h.response({ status: 'error', message: 'Gagal membuat order' }).code(500);
  }
};

/**
 * Midtrans: Membuat transaksi pembayaran berdasarkan order yang sudah dibuat
 */
const chargePaymentHandler = async (request, h) => {
  try {
    const { orderId, grossAmount, paymentType, bank, userId } = request.payload;

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      customer_details: {
        user_id: userId,
      },
    };

    if (paymentType === 'bank_transfer') {
      parameter.payment_type = 'bank_transfer';
      parameter.bank_transfer = { bank };
    } else if (paymentType === 'qris') {
      parameter.payment_type = 'qris';
    } else if (paymentType === 'gopay') {
      parameter.payment_type = 'gopay';
    } else {
      return h.response({ status: 'fail', message: 'Unsupported payment type' }).code(400);
    }

    const transaction = await snap.createTransaction(parameter);

    return h.response({
      status: 'success',
      message: 'Transaction created',
      data: transaction,
    }).code(200);
  } catch (error) {
    console.error('Midtrans error:', error.message);
    return h.response({
      status: 'error',
      message: 'Failed to create transaction',
    }).code(500);
  }
};

/**
 * Webhook Midtrans: Update status order sesuai status transaksi
 */
const handleMidtransNotification = async (request, h) => {
  try {
    const notification = request.payload;
    console.log('🔔 Midtrans Notification Diterima:', notification);

    const { transaction_status, order_id, fraud_status } = notification;

    const orderRef = db.collection('orders').doc(order_id);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      console.warn(`❗ Order dengan ID ${order_id} tidak ditemukan`);
      return h.response({ message: 'Order tidak ditemukan' }).code(404);
    }

    let newStatus = '';
    switch (transaction_status) {
      case 'settlement':
        newStatus = 'dibayar';
        break;
      case 'pending':
        newStatus = 'menunggu pembayaran';
        break;
      case 'expire':
        newStatus = 'expired';
        break;
      case 'cancel':
        newStatus = 'dibatalkan';
        break;
      case 'deny':
        newStatus = 'gagal';
        break;
      default:
        newStatus = transaction_status;
    }

    await orderRef.update({
      status: newStatus,
      midtrans_status: transaction_status,
      fraud_status,
      updatedAt: new Date().toISOString(),
    });

    console.log(`✅ Order ${order_id} status diupdate ke: ${newStatus}`);
    return h.response({ message: 'Notifikasi diterima dan status diperbarui' }).code(200);
  } catch (error) {
    console.error('❌ Error di handleMidtransNotification:', error.message);
    return h.response({ error: 'Internal Server Error' }).code(500);
  }
};

/**
 * Ambil semua order user
 */
const getAllOrdersHandler = async (request, h) => {
  const { userId } = request.query;
  try {
    const snapshot = await db.collection('orders').where('userId', '==', userId).get();
    const orders = snapshot.docs.map((doc) => ({ orderId: doc.id, ...doc.data() }));
    return h.response({ status: 'success', data: orders }).code(200);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return h.response({ status: 'fail', message: 'Gagal mengambil data order' }).code(500);
  }
};

/**
 * Detail order by ID
 */
const getOrderDetailHandler = async (request, h) => {
  const { orderId } = request.params;
  try {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }
    return h.response({ status: 'success', data: { orderId, ...orderDoc.data() } }).code(200);
  } catch (error) {
    return h.response({ status: 'error', message: 'Gagal mengambil detail order' }).code(500);
  }
};

/**
 * Update status order secara manual (jika dibutuhkan)
 */
const updateOrderStatusHandler = async (request, h) => {
  const { orderId } = request.params;
  const { status } = request.payload;
  try {
    await db.collection('orders').doc(orderId).update({ status });
    return h.response({ status: 'success', message: 'Status berhasil diupdate' }).code(200);
  } catch (error) {
    return h.response({ status: 'error', message: 'Gagal update status' }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  chargePaymentHandler,
  handleMidtransNotification,
  getAllOrdersHandler,
  getOrderDetailHandler,
  updateOrderStatusHandler,
};
