const Joi = require('joi');
const orderHandler = require('../handlers/orderHandler');

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
      handler: orderHandler.createOrderHandler,
    },
  },
  {
    method: 'GET',
    path: '/orders/{userId}',
    options: {
      tags: ['api'],
      description: 'Menampilkan semua order milik user',
      handler: orderHandler.getAllOrdersHandler, // ✅ PERBAIKAN DI SINI
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
      handler: orderHandler.getOrderDetailHandler, // ✅ PERBAIKAN DI SINI
    },
  },
];
