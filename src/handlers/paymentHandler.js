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
  const payload = request.payload;
  console.log('📩 Midtrans Webhook Received:', payload);

  const { transaction_status, order_id, fraud_status } = payload;

  if (transaction_status === 'settlement') {
    // Simpan ke database Firebase bahwa status order sudah dibayar
    const db = require('../config/firebase');
    await db.collection('orders').doc(order_id).update({
      status: 'paid',
      updatedAt: new Date().toISOString(),
    });

    console.log(`✅ Order ${order_id} marked as PAID`);
  } else if (transaction_status === 'expire' || transaction_status === 'cancel') {
    // Update status jadi gagal
    const db = require('../config/firebase');
    await db.collection('orders').doc(order_id).update({
      status: 'failed',
      updatedAt: new Date().toISOString(),
    });

    console.log(`❌ Order ${order_id} marked as FAILED`);
  }

  return h.response({ received: true }).code(200);
};

module.exports = { chargePaymentHandler, handleMidtransNotification };
