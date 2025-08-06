const { chargePaymentHandler, handleMidtransNotification } = require('../handlers/paymentHandler');

module.exports = [
  {
    method: 'POST',
    path: '/payment/charge',
    handler: chargePaymentHandler,
  },
  {
    method: 'POST',
    path: '/payment/notification',
    handler: handleMidtransNotification,
  },
];

