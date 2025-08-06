import paymentHandler from '../handlers/paymentHandler.js';

const paymentRoutes = [
  {
    method: 'POST',
    path: '/payments/charge',
    handler: paymentHandler.chargePaymentHandler,
  },
];

export default paymentRoutes;
