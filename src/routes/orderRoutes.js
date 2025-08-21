// routes/orders.js
const {
  createOrderHandler,
  midtransNotificationHandler,
  getAllOrdersAdminHandler,
  getOrdersByUserHandler,
  getOrderDetailHandler,
  updateOrderStatusByPathHandler,
  updateOrderStatusLegacyHandler,
  downloadOrderPhotosZip,  
} = require('../handlers/orderHandler');

// NOTE: untuk sekarang tanpa auth. Nanti tinggal tambah pre: [requireAdmin]/[requireUser]
module.exports = [
  // Buat order
  { method: 'POST', path: '/orders', handler: createOrderHandler },

  // Webhook Midtrans
  { method: 'POST', path: '/midtrans/notification', handler: midtransNotificationHandler },

  // Admin: semua order (support ?status=&paymentStatus=&userId=&limit=)
  { method: 'GET', path: '/orders', handler: getAllOrdersAdminHandler },

  // User: list order miliknya
  { method: 'GET', path: '/orders/{userId}', handler: getOrdersByUserHandler },

  // Detail
  { method: 'GET', path: '/orders/detail/{orderId}', handler: getOrderDetailHandler },

  // Update status (path param)
  { method: 'PATCH', path: '/orders/{orderId}/status', handler: updateOrderStatusByPathHandler },

  // Update status (legacy body)
  { method: 'PATCH', path: '/orders/status', handler: updateOrderStatusLegacyHandler },

  // ⬇️⬇️ baru: download ZIP semua foto pada order
  { method: 'GET', path: '/orders/{orderId}/photos.zip', handler: downloadOrderPhotosZip },
  
  { method: 'PATCH', path: '/orders/{orderId}/payment-status', handler: updatePaymentStatusHandler },
];
