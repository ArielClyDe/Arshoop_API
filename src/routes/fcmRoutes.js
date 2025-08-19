// routes/fcmRoutes.js
const Joi = require('joi');
const { saveFcmTokenHandler, deleteFcmTokenHandler } = require('../handlers/fcmTokenHandler');
const { updateOrderStatusHandler } = require('../handlers/orderNotifyHandler');

const tokenParam = Joi.object({ userId: Joi.string().required() });
const tokenBody  = Joi.object({ token: Joi.string().required() });

module.exports = [
  // Save token
  { method: 'POST', path: '/users/{userId}/fcm-tokens',
    options: { tags:['api'], description:'Save token', validate:{ params: tokenParam, payload: tokenBody } },
    handler: saveFcmTokenHandler },
  { method: 'POST', path: '/users/{userId}/fcm-token',
    options: { tags:['api'], description:'Save token (singular)', validate:{ params: tokenParam, payload: tokenBody } },
    handler: saveFcmTokenHandler },

  // Delete token
  { method: 'DELETE', path: '/users/{userId}/fcm-tokens',
    options: { tags:['api'], description:'Delete token', validate:{ params: tokenParam, payload: tokenBody } },
    handler: deleteFcmTokenHandler },
  { method: 'DELETE', path: '/users/{userId}/fcm-token',
    options: { tags:['api'], description:'Delete token (singular)', validate:{ params: tokenParam, payload: tokenBody } },
    handler: deleteFcmTokenHandler },

  // Update status + push
  { method: 'POST', path: '/orders/{orderId}/status',
    options: { tags:['api'], description:'Update status + notify',
      validate:{ params: Joi.object({ orderId: Joi.string().required() }),
                 payload: Joi.object({ status: Joi.string().valid('pending','processing','shipping','delivered','done','completed','canceled').required() }) } },
    handler: updateOrderStatusHandler },
];
