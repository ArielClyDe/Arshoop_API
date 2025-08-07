// src/routes/orderPaymentRoutes.js
const Joi = require('joi');
const orderPaymentHandler = require('../handlers/orderPaymentHandler');

module.exports = [
  // Order Routes
  {
    method: 'POST',
    path: '/orders',
    options: {
      tags: ['api'],
      description: 'Membuat order dari 1 cart atau seluruh cart milik user',
      validate: {
        payload: Joi.object({
          userId: Joi.string().required(),
          carts: Joi.array().items(Joi.object()).min(1).required(),
          deliveryMethod: Joi.string().valid('pickup', 'delivery').required(),
          alamat: Joi.string().when('deliveryMethod', {
            is: 'delivery',
            then: Joi.required(),
            otherwise: Joi.allow(null),
          }),
          ongkir: Joi.number().when('deliveryMethod', {
            is: 'delivery',
            then: Joi.required(),
            otherwise: Joi.valid(0),
          }),
          paymentMethod: Joi.string().valid('cod', 'transfer').required(),
          totalPrice: Joi.number().required(),
        }),
      },
      handler: orderPaymentHandler.createOrderHandler,
    },
  },
  {
    method: 'GET',
    path: '/orders/{userId}',
    options: {
      tags: ['api'],
      description: 'Menampilkan semua order milik user',
      handler: orderPaymentHandler.getAllOrdersHandler,
    },
  },
  {
    method: 'GET',
    path: '/orders/detail/{orderId}',
    options: {
      tags: ['api'],
      description: 'Menampilkan detail satu order',
      handler: orderPaymentHandler.getOrderDetailHandler,
    },
  },
  {
    method: 'PATCH',
    path: '/orders/{orderId}/status',
    options: {
      tags: ['api'],
      description: 'Update status order',
      validate: {
        payload: Joi.object({
          status: Joi.string()
            .valid('pending', 'processing', 'completed', 'cancelled')
            .required(),
        }),
      },
      handler: orderPaymentHandler.updateOrderStatusHandler,
    },
  },
  
  // Payment Routes
  {
    method: 'POST',
    path: '/payment/charge',
    options: {
      tags: ['api', 'payment'],
      description: 'Memproses pembayaran untuk order yang sudah dibuat',
      validate: {
        payload: Joi.object({
          orderId: Joi.string().required(),
          paymentType: Joi.string().valid('bank_transfer', 'qris', 'gopay').required(),
          bank: Joi.string().when('paymentType', {
            is: 'bank_transfer',
            then: Joi.string().valid('bca', 'bni', 'bri', 'mandiri').required(),
            otherwise: Joi.optional(),
          }),
        }),
      },
      handler: orderPaymentHandler.chargePaymentHandler,
    },
  },
  {
    method: 'POST',
    path: '/payment/notification',
    options: {
      tags: ['api', 'payment'],
      description: 'Endpoint untuk menerima notifikasi dari Midtrans',
      handler: orderPaymentHandler.handleMidtransNotification,
    },
  },
];