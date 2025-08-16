// routes/fcmRoutes.js
const Joi = require('joi');
const { saveFcmTokenHandler, deleteFcmTokenHandler } = require('../handlers/fcmTokenHandler');
const { updateOrderStatusHandler } = require('../handlers/orderNotifyHandler');

module.exports = [
  {
    method: 'POST',
    path: '/users/{userId}/fcm-tokens',
    options: {
      tags: ['api'],
      description: 'Simpan / update FCM token user',
      validate: {
        params: Joi.object({ userId: Joi.string().required() }),
        payload: Joi.object({ token: Joi.string().required() }),
      },
    },
    handler: saveFcmTokenHandler,
  },
  {
    method: 'DELETE',
    path: '/users/{userId}/fcm-tokens',
    options: {
      tags: ['api'],
      description: 'Hapus FCM token user',
      validate: {
        params: Joi.object({ userId: Joi.string().required() }),
        payload: Joi.object({ token: Joi.string().required() }),
      },
    },
    handler: deleteFcmTokenHandler,
  },
  {
    method: 'POST',
    path: '/orders/{orderId}/status',
    options: {
      tags: ['api'],
      description: 'Update status order + kirim push notifikasi',
      validate: {
        params: Joi.object({ orderId: Joi.string().required() }),
        payload: Joi.object({
          status: Joi.string()
            .valid('pending', 'processing', 'shipping', 'delivered', 'done', 'completed')
            .required(),
        }),
      },
    },
    handler: updateOrderStatusHandler,
  },
];
