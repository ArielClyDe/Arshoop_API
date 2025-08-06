const { chargeMidtrans } = require('../services/midtransService');

const handleCharge = async (request, h) => {
  try {
    const { orderId, grossAmount, paymentType, bank } = request.payload;

    let options = {};

    // Tentukan opsi berdasarkan paymentType
    switch (paymentType) {
      case 'bank_transfer':
        options.bank_transfer = { bank }; // e.g. 'bca'
        break;
      case 'echannel':
        options.echannel = {
          bill_info1: 'Pembayaran',
          bill_info2: 'ARSHOOP',
        };
        break;
      case 'qris':
        break; // tidak butuh opsi tambahan
      case 'gopay':
        break;
      default:
        return h.response({ status: 'fail', message: 'Payment type tidak valid' }).code(400);
    }

    const result = await chargeMidtrans({ orderId, grossAmount, paymentType, options });

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
