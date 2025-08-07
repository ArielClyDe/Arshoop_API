const {
  createOrderHandler,
  chargePaymentHandler,
  handleMidtransNotification,
  getAllOrdersHandler,
  getOrderDetailHandler,
  updateOrderStatusHandler,
} = require('../handlers/orderPaymentHandler');

module.exports = [
  {
    method: 'POST',
    path: '/orders',
    handler: createOrderHandler,
  },
  {
    method: 'GET',
    path: '/orders',
    handler: getAllOrdersHandler,
  },
  {
    method: 'GET',
    path: '/orders/{orderId}',
    handler: getOrderDetailHandler,
  },
  {
    method: 'PUT',
    path: '/orders/{orderId}/status',
    handler: updateOrderStatusHandler,
  },
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
