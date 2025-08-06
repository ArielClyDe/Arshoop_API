const { chargeMidtrans } = require('../services/midtransService');
const { db } = require('../config/firebase');

const createPaymentHandler = async (request, h) => {
  try {
    const { orderId, grossAmount, paymentType, bank, userId } = request.payload;

    // Proses ke Midtrans
    const midtransResult = await chargeMidtrans({
      orderId,
      grossAmount,
      paymentType,
      bank,
    });

    // Simpan ke Firestore
    const paymentRef = db.collection('payments').doc(orderId);
    await paymentRef.set({
      orderId,
      userId,
      paymentType,
      bank: bank || null,
      grossAmount,
      midtrans: midtransResult,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    return h.response({
      status: 'success',
      data: midtransResult,
    }).code(201);
  } catch (err) {
    console.error('Payment error:', err.response?.data || err.message);
    return h.response({
      status: 'fail',
      message: 'Gagal memproses pembayaran',
    }).code(500);
  }
};

module.exports = {
  createPaymentHandler,
};
