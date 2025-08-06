const { createPaymentHandler } = require('../handlers/paymentHandler');

module.exports = [
  {
    method: 'POST',
    path: '/payments',
    handler: createPaymentHandler,
  },
];
