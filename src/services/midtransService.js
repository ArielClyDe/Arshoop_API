const axios = require('axios');

const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';

const BASE_URL = IS_PRODUCTION
  ? 'https://api.midtrans.com/v2/charge'
  : 'https://api.sandbox.midtrans.com/v2/charge';

const chargeMidtrans = async ({ orderId, grossAmount, paymentType, bank }) => {
  const base64 = Buffer.from(`${SERVER_KEY}:`).toString('base64');

  let payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    payment_type: paymentType,
  };

  // Payment Type Logic
  if (paymentType === 'bank_transfer') {
    payload.bank_transfer = {
      bank: bank || 'bca', // default: bca
    };
  }

  if (paymentType === 'gopay') {
    payload.gopay = {
      enable_callback: true,
      callback_url: 'https://yourdomain.com/redirect', // opsional
    };
  }

  if (paymentType === 'qris') {
    payload.qris = {};
  }

  if (paymentType === 'echannel') {
    payload.echannel = {
      bill_info1: 'Payment:',
      bill_info2: 'Buket ARSHOOP',
    };
  }

  const response = await axios.post(BASE_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${base64}`,
    },
  });

  return response.data;
};

module.exports = { chargeMidtrans };
