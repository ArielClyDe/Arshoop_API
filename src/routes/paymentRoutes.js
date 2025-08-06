// src/routes/paymentRoutes.js
import { chargePaymentHandler } from '../handlers/paymentHandler.js';

const paymentRoutes = [
  {
    method: 'POST',
    path: '/payment/charge',
    handler: chargePaymentHandler,
  },
];

export default paymentRoutes;
