const { chargePaymentHandler, handleMidtransNotification } = require('../handlers/paymentHandler');

module.exports = [
  {
    method: 'POST',
    path: '/midtrans/charge',
    handler: chargePaymentHandler,
  },
  {
    method: 'POST',
    path: '/midtrans/notification',
    handler: handleMidtransNotification,
  },
];


module.exports = paymentRoutes;
