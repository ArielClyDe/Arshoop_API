// src/handlers/paymentHandler.js

const midtransClient = require('midtrans-client');
const db = require('../config/firebase');

// Inisialisasi Snap Midtrans
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Endpoint untuk membuat pembayaran
const chargePaymentHandler = async (request, h) => {
  const { orderId, grossAmount, paymentType, bank, userId } = request.payload;

  try {
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      customer_details: {
        first_name: userId,
      },
      enabled_payments: ['bank_transfer', 'gopay', 'qris', 'shopeepay'],
      bank_transfer: paymentType === 'bank_transfer' ? { bank } : undefined,
    };

    const transaction = await snap.createTransaction(parameter);
    return h.response({
      status: 'success',
      token: transaction.token,
      redirect_url: transaction.redirect_url,
    });
  } catch (error) {
    console.error('❌ Midtrans charge error:', error);
    return h.response({ status: 'error', message: error.message }).code(500);
  }
};

// Endpoint untuk menerima notifikasi dari Midtrans
const handleMidtransNotification = async (request, h) => {
  try {
    const notification = request.payload;
    console.log('🔔 Midtrans Notification Diterima:', notification);

    const { transaction_status, order_id } = notification;

    const orderRef = db.collection('orders').doc(order_id);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      console.log(`⚠️ Order ID ${order_id} tidak ditemukan di Firestore`);
      return h.response({ message: 'Order not found' }).code(404);
    }

    let status = 'pending';
    if (transaction_status === 'settlement') {
      status = 'paid';
    } else if (['deny', 'cancel', 'expire'].includes(transaction_status)) {
      status = 'failed';
    }

    await orderRef.update({
      status,
      updatedAt: new Date().toISOString(),
    });

    return h.response({ message: 'Notifikasi diproses' }).code(200);
  } catch (error) {
    console.error('❌ Gagal memproses notifikasi:', error);
    return h.response({ error: 'Internal server error' }).code(500);
  }
};

module.exports = { chargePaymentHandler, handleMidtransNotification };
