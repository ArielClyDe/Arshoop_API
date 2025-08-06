// src/routes/paymentRoutes.js
const { chargePaymentHandler } = require('../handlers/paymentHandler');

const paymentRoutes = [
  {
    method: 'POST',
    path: '/payment/charge',
    handler: chargePaymentHandler,
  },
];

module.exports = paymentRoutes;
