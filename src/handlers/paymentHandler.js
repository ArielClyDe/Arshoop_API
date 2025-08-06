// src/handlers/paymentHandler.js
import midtransClient from 'midtrans-client';

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

export { chargePaymentHandler };

