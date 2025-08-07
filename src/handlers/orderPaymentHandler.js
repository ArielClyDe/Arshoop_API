// src/handlers/orderPaymentHandler.js
const midtransClient = require('midtrans-client');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');

// Inisialisasi Midtrans Snap
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// ORDER HANDLERS
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

    // Validasi dasar
    if (!userId || !carts || carts.length === 0 || !paymentMethod || !totalPrice || !deliveryMethod) {
      return h.response({ status: 'fail', message: 'Data tidak lengkap' }).code(400);
    }

    // Validasi khusus jika delivery
    if (deliveryMethod === 'delivery' && (!alamat || !ongkir)) {
      return h.response({ status: 'fail', message: 'Alamat dan ongkir wajib untuk pengiriman' }).code(400);
    }

    const orderId = `ORDER-${uuidv4()}`; // Format khusus untuk Midtrans

    const orderData = {
      orderId,
      userId,
      deliveryMethod,
      alamat: deliveryMethod === 'delivery' ? alamat : null,
      ongkir: deliveryMethod === 'delivery' ? ongkir : 0,
      paymentMethod,
      totalPrice,
      carts,
      status: paymentMethod === 'cod' ? 'pending' : 'menunggu pembayaran', // Status disesuaikan dengan Midtrans
      createdAt: new Date().toISOString(),
      midtrans_status: paymentMethod === 'cod' ? null : 'pending', // Untuk tracking status Midtrans
    };

    await db.collection('orders').doc(orderId).set(orderData);

    // Hapus semua cart user
    const cartSnapshot = await db.collection('carts').where('userId', '==', userId).get();
    const batch = db.batch();
    cartSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Jika pembayaran transfer, langsung proses ke Midtrans
    if (paymentMethod === 'transfer') {
      const parameter = {
        transaction_details: {
          order_id: orderId,
          gross_amount: totalPrice,
        },
        customer_details: {
          user_id: userId,
        },
        payment_type: 'bank_transfer',
        bank_transfer: {
          bank: 'bca', // Default bank, bisa diganti dengan input user
        },
      };

      const transaction = await snap.createTransaction(parameter);
      
      return h.response({
        status: 'success',
        message: 'Order dan pembayaran berhasil dibuat',
        data: {
          orderId,
          paymentData: transaction,
        },
      }).code(201);
    }

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

const getOrderDetailHandler = async (request, h) => {
  const { orderId } = request.params;
  try {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }
    const orderData = orderDoc.data();
    return h.response({ status: 'success', data: { orderId, ...orderData } }).code(200);
  } catch (error) {
    return h.response({ status: 'error', message: 'Gagal mengambil detail order' }).code(500);
  }
};

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

// PAYMENT HANDLERS
const chargePaymentHandler = async (request, h) => {
  try {
    const { orderId, paymentType, bank } = request.payload;

    // Dapatkan data order terlebih dahulu
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return h.response({
        status: 'fail',
        message: 'Order tidak ditemukan',
      }).code(404);
    }

    const orderData = orderDoc.data();

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: orderData.totalPrice,
      },
      customer_details: {
        user_id: orderData.userId,
      },
    };

    // Tambahkan logika berdasarkan jenis pembayaran
    if (paymentType === 'bank_transfer') {
      parameter.payment_type = 'bank_transfer';
      parameter.bank_transfer = {
        bank: bank || 'bca', // default ke BCA jika tidak ditentukan
      };
    } else if (paymentType === 'qris') {
      parameter.payment_type = 'qris';
    } else if (paymentType === 'gopay') {
      parameter.payment_type = 'gopay';
    } else {
      return h.response({
        status: 'fail',
        message: 'Unsupported payment type',
      }).code(400);
    }

    const transaction = await snap.createTransaction(parameter);

    // Update order dengan status pembayaran
    await db.collection('orders').doc(orderId).update({
      paymentMethod: paymentType,
      midtrans_status: 'pending',
      updatedAt: new Date().toISOString(),
    });

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

    // Konversi status midtrans → status aplikasi
    let newStatus = '';
    if (transaction_status === 'settlement') {
      newStatus = 'dibayar';
    } else if (transaction_status === 'pending') {
      newStatus = 'menunggu pembayaran';
    } else if (transaction_status === 'expire') {
      newStatus = 'expired';
    } else if (transaction_status === 'cancel') {
      newStatus = 'dibatalkan';
    } else if (transaction_status === 'deny') {
      newStatus = 'gagal';
    } else {
      newStatus = transaction_status; // fallback
    }

    // Update order
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

module.exports = {
  // Order handlers
  createOrderHandler,
  getAllOrdersHandler,
  getOrderDetailHandler,
  updateOrderStatusHandler,
  
  // Payment handlers
  chargePaymentHandler,
  handleMidtransNotification,
};