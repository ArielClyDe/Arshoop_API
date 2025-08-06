import midtransClient from 'midtrans-client';

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const chargePaymentHandler = async (request, h) => {
  const { orderId, grossAmount, paymentType, bank, userId } = request.payload;

  try {
    let payload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      customer_details: {
        user_id: userId,
      },
    };

    if (paymentType === 'bank_transfer') {
      payload.payment_type = 'bank_transfer';
      payload.bank_transfer = {
        bank: bank,
      };
    } else if (paymentType === 'echannel') {
      payload.payment_type = 'echannel';
      payload.echannel = {
        bill_info1: 'Payment For',
        bill_info2: 'Arshoop',
      };
    } else {
      payload.payment_type = paymentType;
    }

    const chargeResponse = await snap.createTransaction(payload);
    return h.response({
      status: 'success',
      data: chargeResponse,
    }).code(201);
  } catch (err) {
    console.error('Payment error:', err);
    return h.response({
      status: 'fail',
      message: err.message,
    }).code(500);
  }
};

module.exports = {
  handleCharge: chargePaymentHandler,
};
