const Joi = require('joi');
const cartHandler = require('../handlers/cartHandler');

module.exports = [
  {
    method: 'POST',
    path: '/cart',
    options: {
      description: 'Tambah item ke keranjang',
      tags: ['api'],
      validate: {
  payload: Joi.object({
    userId: Joi.string().required(),
    buketId: Joi.string().required(),
    name: Joi.string().optional(),
    imageUrl: Joi.string().uri().optional(),
    size: Joi.string().valid('small', 'medium', 'large').required(),
    quantity: Joi.number().integer().min(1).required(),
    basePrice: Joi.number().optional(),

    customMaterials: Joi.array().items(
      Joi.object({
        name: Joi.string().optional(),
        price: Joi.number().optional(),
        quantity: Joi.number().integer().min(1).required()
      })
    ).optional(),

    requestDate: Joi.string().optional().allow(null),
    orderNote: Joi.string().optional().allow(''),
    totalPrice: Joi.number().optional()
  })
},
    },
    handler: cartHandler.addToCartHandler,
  },

  {
    method: 'GET',
    path: '/cart/{userId}',
    options: {
      description: 'Ambil semua item keranjang berdasarkan userId',
      tags: ['api'],
      validate: {
        params: Joi.object({
          userId: Joi.string().required(),
        }),
      },
    },
    handler: cartHandler.getCartByUserHandler,
  },

  {
    method: 'DELETE',
    path: '/cart/{cartId}',
    options: {
      description: 'Hapus item dari keranjang berdasarkan cartId',
      tags: ['api'],
      validate: {
        params: Joi.object({
          cartId: Joi.string().required(),
        }),
      },
    },
    handler: cartHandler.deleteCartItemHandler,
  },

  {
    method: 'PUT',
    path: '/cart/{cartId}',
    options: {
      description: 'Update item keranjang berdasarkan cartId',
      tags: ['api'],
      validate: {
        params: Joi.object({
          cartId: Joi.string().required()
        }),
        payload: Joi.object({
          size: Joi.string().valid('small', 'medium', 'large'),
          quantity: Joi.number().integer().min(1),
          customMaterials: Joi.array().items(
            Joi.object({
              materialId: Joi.string().required(),
              quantity: Joi.number().integer().min(1).required()
            })
          )
        }).min(1) // Wajib setidaknya ada satu field yang diubah
      }
    },
    handler: cartHandler.updateCartItemHandler
  }
];
