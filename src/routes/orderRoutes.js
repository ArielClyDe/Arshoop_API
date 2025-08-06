const Joi = require('joi');
const orderHandler = require('../handlers/orderHandler');
const paymentHandler = require('../handlers/paymentHandler');

module.exports = [
  {
    method: 'POST',
    path: '/orders',
    options: {
      tags: ['api'],
      description: 'Membuat order dari 1 cart atau seluruh cart milik user',
      validate: {
        payload: Joi.object({
          userId: Joi.string().required(),
          cartId: Joi.string().optional(),
          address: Joi.string().required(),         // ✅ Tambahan: alamat pengiriman
          shippingCost: Joi.number().required(),    // ✅ Tambahan: ongkir
        }),
      },
      handler: orderHandler.createOrderHandler,
    },
  },
  {
    method: 'GET',
    path: '/orders/{userId}',
    options: {
      tags: ['api'],
      description: 'Menampilkan semua order milik user',
      handler: orderHandler.getOrdersByUserHandler,
    },
  },
  {
    method: 'PATCH',
    path: '/orders/{orderId}/status',
    options: {
      tags: ['api'],
      description: 'Update status order (pending, processing, completed, cancelled)',
      validate: {
        payload: Joi.object({
          status: Joi.string()
            .valid('pending', 'processing', 'completed', 'cancelled')
            .required(),
        }),
      },
      handler: orderHandler.updateOrderStatusHandler,
    },
  },
  {
    method: 'GET',
    path: '/orders/detail/{orderId}',
    options: {
      tags: ['api'],
      description: 'Menampilkan detail satu order',
      handler: orderHandler.getOrderByIdHandler,
    },
  },

  // 🔁 Midtrans: Buat transaksi pembayaran
  {
    method: 'POST',
    path: '/payments/charge',
    options: {
      tags: ['api'],
      description: 'Melakukan pembayaran melalui Midtrans (QRIS, VA, e-wallet)',
      validate: {
        payload: Joi.object({
          orderId: Joi.string().required(),
          userId: Joi.string().required(),
          grossAmount: Joi.number().required(),
          paymentType: Joi.string().valid('bank_transfer', 'qris', 'echannel', 'gopay').required(),
          bank: Joi.string().optional(), // untuk VA
        }),
      },
      handler: paymentHandler.chargePaymentHandler,
    },
  },

  // 🛎️ Midtrans: Notification Handler (webhook)
  {
    method: 'POST',
    path: '/payments/notification',
    options: {
      tags: ['api'],
      description: 'Notifikasi status pembayaran dari Midtrans',
      handler: paymentHandler.handleNotificationHandler,
    },
  },
];
