'use strict';

const Joi = require('joi');
const cartHandler = require('../handlers/cartHandler');

module.exports = [
  /* =========================
   * POST /cart  (Add to cart)
   * ========================= */
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

          // ⬇️ Izinkan kosong/null untuk kasus custom (tidak wajib ada foto buket)
          imageUrl: Joi.string().uri().allow('', null).optional(),

          size: Joi.string().valid('small', 'medium', 'large').required(),
          quantity: Joi.number().integer().min(1).required(),

          basePrice: Joi.number().integer().min(0).optional(),

          customMaterials: Joi.array().items(
            Joi.object({
              materialId: Joi.string().required(),
              name: Joi.string().optional(),
              price: Joi.number().integer().min(0).optional(),
              quantity: Joi.number().integer().min(1).required(),
            })
          ).optional(),

          requestDate: Joi.string().optional().allow(null, ''),
          orderNote: Joi.string().optional().allow(''),
          totalPrice: Joi.number().integer().min(0).optional(),

          // daftar URL foto user (opsional)
          photoUrls: Joi.array().items(Joi.string().uri()).default([]),
        }),
        failAction: (_r, _h, err) => {
          console.error('[CART] validation(POST):', err.message);
          throw err;
        },
      },
    },
    handler: cartHandler.addToCartHandler,
  },

  /* ==========================================
   * GET /cart/{userId}  (List cart by userId)
   * ========================================== */
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
        failAction: (_r, _h, err) => {
          console.error('[CART] validation(GET):', err.message);
          throw err;
        },
      },
    },
    handler: cartHandler.getCartByUserHandler,
  },

  /* =======================================
   * DELETE /cart/{cartId}  (Remove an item)
   * ======================================= */
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
        failAction: (_r, _h, err) => {
          console.error('[CART] validation(DELETE):', err.message);
          throw err;
        },
      },
    },
    handler: cartHandler.deleteCartItemHandler,
  },

  /* ==========================================
   * PUT /cart/{cartId}  (Update existing item)
   * ========================================== */
  {
    method: 'PUT',
    path: '/cart/{cartId}',
    options: {
      description: 'Update item keranjang berdasarkan cartId',
      tags: ['api'],
      validate: {
        params: Joi.object({ cartId: Joi.string().required() }),
        payload: Joi.object({
          size: Joi.string().valid('small', 'medium', 'large'),
          quantity: Joi.number().integer().min(1),

          customMaterials: Joi.array().items(
            Joi.object({
              materialId: Joi.string().required(),
              quantity: Joi.number().integer().min(1).required(),
              name: Joi.string().optional(),
              price: Joi.number().integer().min(0).optional(),
            })
          ),

          requestDate: Joi.string().optional().allow(null, ''),
          orderNote: Joi.string().optional().allow(''),
          totalPrice: Joi.number().integer().min(0),

          // ⬇️ jika ingin bisa update gambar cart, boleh ikutkan field ini:
          imageUrl: Joi.string().uri().allow('', null),

          // jika dikirim: REPLACE daftar foto user untuk item ini
          photoUrls: Joi.array().items(Joi.string().uri()),
        }).min(1),
        failAction: (_r, _h, err) => {
          console.error('[CART] validation(PUT):', err.message);
          throw err;
        },
      },
    },
    handler: cartHandler.updateCartItemHandler,
  },
];
