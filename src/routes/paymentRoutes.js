import paymentHandler from '../handlers/paymentHandler.js';

const paymentRoutes = [
  {
    method: 'POST',
    path: '/payments/charge',
    handler: paymentHandler.chargePaymentHandler,
  },
];

// ✅ BENAR
module.exports = {
  chargePaymentHandler,
};
