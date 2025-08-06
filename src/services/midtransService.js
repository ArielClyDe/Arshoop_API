const axios = require('axios');

const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const BASE_URL = IS_PRODUCTION
  ? 'https://api.midtrans.com/v2/charge'
  : 'https://api.sandbox.midtrans.com/v2/charge';

const chargeMidtrans = async ({ orderId, grossAmount, bank }) => {
  const base64 = Buffer.from(`${SERVER_KEY}:`).toString('base64');

  const payload = {
    payment_type: 'bank_transfer',
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    bank_transfer: {
      bank: bank, // contoh: "bca", "bni"
    }
  };

  const response = await axios.post(BASE_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${base64}`,
    }
  });

  return response.data;
};

module.exports = { chargeMidtrans };
