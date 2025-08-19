// routes/fcmRoutes.js
const Joi = require('joi');
const { saveFcmTokenHandler, deleteFcmTokenHandler } = require('../handlers/fcmTokenHandler');
const { updateOrderStatusHandler } = require('../handlers/orderNotifyHandler');

const tokenParam = Joi.object({ userId: Joi.string().required() });
const tokenBody  = Joi.object({ token: Joi.string().required() });

module.exports = [
  // ===== Save token (support plural & singular) =====
  {
    method: 'POST',
    path: '/users/{userId}/fcm-tokens',        // plural (yang dipakai app kamu sekarang)
    options: { tags: ['api'], description: 'Simpan / update FCM token user',
      validate: { params: tokenParam, payload: tokenBody } },
    handler: saveFcmTokenHandler,
  },
  {
    method: 'POST',
    path: '/users/{userId}/fcm-token',         // singular (fallback/kompatibel)
    options: { tags: ['api'], description: 'Simpan / update FCM token user (singular)',
      validate: { params: tokenParam, payload: tokenBody } },
    handler: saveFcmTokenHandler,
  },

  // ===== Delete token (support plural & singular) =====
  {
    method: 'DELETE',
    path: '/users/{userId}/fcm-tokens',        // plural
    options: { tags: ['api'], description: 'Hapus FCM token user',
      validate: { params: tokenParam, payload: tokenBody } },
    handler: deleteFcmTokenHandler,
  },
  {
    method: 'DELETE',
    path: '/users/{userId}/fcm-token',         // singular
    options: { tags: ['api'], description: 'Hapus FCM token user (singular)',
      validate: { params: tokenParam, payload: tokenBody } },
    handler: deleteFcmTokenHandler,
  },

  // ===== Update status + push ke user =====
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
            .valid('pending', 'processing', 'shipping', 'delivered', 'done', 'completed', 'canceled')
            .required(),
        }),
      },
    },
    handler: updateOrderStatusHandler,
  },
];
