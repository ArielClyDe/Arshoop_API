// src/handlers/paymentHandler.js
const midtransClient = require('midtrans-client');

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

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

    // Tambahkan logika berdasarkan jenis pembayaran
    if (paymentType === 'bank_transfer') {
      parameter.payment_type = 'bank_transfer';
      parameter.bank_transfer = {
        bank, // contoh: bca, bni, bri
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

// Tambahan untuk menerima notifikasi dari Midtrans
const handleMidtransNotification = async (request, h) => {
  try {
    const notification = request.payload;
    console.log('🔔 Midtrans Notification Diterima:', notification);

    const { transaction_status, order_id, fraud_status } = notification;

    const { db } = require('../services/firebaseService');
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



module.exports = { chargePaymentHandler, handleMidtransNotification };
