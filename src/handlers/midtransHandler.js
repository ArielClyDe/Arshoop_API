const { chargeMidtrans } = require('../services/midtransService');

const handleCharge = async (request, h) => {
  try {
    const { orderId, grossAmount, bank } = request.payload;

    const result = await chargeMidtrans({ orderId, grossAmount, bank });

    return h.response(result).code(200);
  } catch (err) {
    console.error('Midtrans Error:', err.response?.data || err.message);
    return h.response({
      status: 'fail',
      message: 'Gagal membuat transaksi Midtrans',
    }).code(500);
  }
};

module.exports = { handleCharge };
