// midtransRoutes.js
const paymentHandler = require('../handlers/midtransHandler');

module.exports = [
  {
    method: 'POST',
    path: '/midtrans/charge',
    handler: paymentHandler.chargePaymentHandler,
  }
];
