'use strict';

const Joi = require('joi');
const {
  // Buket
  getBuketDetail,
  createBuketHandler,
  getAllBuketHandler,
  updateBuketHandler,
  deleteBuketHandler,
  updateBuketImageHandler,
  // Reviews
  createReviewHandler,
  listBuketReviewsNoIndex,
} = require('../handlers/buketHandler');

// enum kategori yang diizinkan (lowercase untuk validasi)
const CAT_ENUM_LOWER = ['bunga', 'snack', 'photo', 'boneka', 'custom'];

module.exports = [
  /* =========================
     ========== BUKET =========
     ========================= */

  // GET semua buket
  {
    method: 'GET',
    path: '/buket',
    options: {
      tags: ['api'],
      description: 'Ambil semua buket',
    },
    handler: getAllBuketHandler,
  },

  // GET detail buket
  {
    method: 'GET',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Ambil detail buket',
      validate: {
        params: Joi.object({
          buketId: Joi.string().required(),
        }),
        query: Joi.object({
          size: Joi.string().valid('small', 'medium', 'large').default('small'),
        }),
      },
      failAction: (_r, _h, err) => {
        console.error('VALIDATION ERROR:', err.message);
        throw err;
      },
    },
    handler: getBuketDetail,
  },

  // POST create buket (image wajib utk template, opsional utk custom)
  {
    method: 'POST',
    path: '/buket',
    options: {
      tags: ['api'],
      description: 'Tambah buket baru',
      payload: {
        output: 'stream',
        parse: true,
        allow: 'multipart/form-data',
        multipart: true,
        maxBytes: 5 * 1024 * 1024,
      },
      validate: {
        payload: Joi.object({
          name: Joi.string().required(),

          // type selalu dilowercase agar konsisten
          type: Joi.string().lowercase().valid('template', 'custom').required(),

          // jika type=custom -> category harus 'custom' (case-insensitive)
          // kalau template -> hanya boleh: bunga/snack/photo/boneka (case-insensitive)
          category: Joi.alternatives().conditional('type', {
            is: 'custom',
            then: Joi.string().lowercase().valid('custom').required(),
            otherwise: Joi.string().lowercase().valid(
              'bunga', 'snack', 'photo', 'boneka'
            ).required(),
          }),

          is_customizable: Joi.boolean().required(),
          processing_time: Joi.alternatives().try(Joi.string(), Joi.number()).required(),

          // image: required untuk template, optional untuk custom
          image: Joi.any().meta({ swaggerType: 'file' }).when('type', {
            is: 'template',
            then: Joi.required(),
            otherwise: Joi.optional(),
          }),

          // JSON string untuk materialsBySize
          materialsBySize: Joi.string().required(),

          service_price: Joi.number().required(),
        }),
        failAction: (_r, _h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        },
      },
    },
    handler: createBuketHandler,
  },

  // PUT update buket (body JSON)
  {
    method: 'PUT',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Update data buket',
      validate: {
        params: Joi.object({
          buketId: Joi.string().required(),
        }),
        payload: Joi.object({
          name: Joi.string(),
          size: Joi.string().valid('small', 'medium', 'large', 'multi'),
          // biarkan fleksibel saat update; normalisasi dilakukan di handler bila perlu
          category: Joi.string(),
          image_url: Joi.string().uri(),
          is_customizable: Joi.boolean(),
          processing_time: Joi.alternatives().try(Joi.string(), Joi.number()),
          service_price: Joi.number().integer().min(0),
          type: Joi.string().valid('template', 'custom'),
          materialsBySize: Joi.object({
            small: Joi.array().items(
              Joi.object({
                materialId: Joi.string().required(),
                quantity: Joi.number().integer().min(1).required(),
              })
            ),
            medium: Joi.array().items(
              Joi.object({
                materialId: Joi.string().required(),
                quantity: Joi.number().integer().min(1).required(),
              })
            ),
            large: Joi.array().items(
              Joi.object({
                materialId: Joi.string().required(),
                quantity: Joi.number().integer().min(1).required(),
              })
            ),
          }).optional(),
        }),
      },
      failAction: (_r, _h, err) => {
        console.error('VALIDATION ERROR:', err.message);
        throw err;
      },
    },
    handler: updateBuketHandler,
  },

  // PUT update gambar buket
  {
    method: 'PUT',
    path: '/buket/{buketId}/image',
    options: {
      tags: ['api'],
      description: 'Update gambar buket',
      payload: {
        output: 'stream',
        parse: true,
        allow: 'multipart/form-data',
        multipart: true,
        maxBytes: 5 * 1024 * 1024,
      },
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
        payload: Joi.object({
          image: Joi.any().meta({ swaggerType: 'file' }).required(),
        }),
      },
      failAction: (_r, _h, err) => {
        console.error('VALIDATION ERROR:', err.message);
        throw err;
      },
    },
    handler: updateBuketImageHandler,
  },

  // DELETE buket
  {
    method: 'DELETE',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Hapus buket',
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
      },
      failAction: (_r, _h, err) => {
        console.error('VALIDATION ERROR:', err.message);
        throw err;
      },
    },
    handler: deleteBuketHandler,
  },

  /* =========================
     ========= REVIEWS ========
     ========================= */

  // POST create review
  {
    method: 'POST',
    path: '/buket/{buketId}/reviews',
    options: {
      tags: ['api'],
      description: 'Tambah review buket',
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
        payload: Joi.object({
          user_id: Joi.string().required(),
          reviewer_name: Joi.string().allow('', null),
          rating: Joi.number().integer().min(1).max(5).required(),
          comment: Joi.string().allow('', null),
        }),
      },
      failAction: (_r, _h, err) => {
        console.error('[REVIEWS] VALIDATION ERROR:', err.message);
        throw err;
      },
    },
    handler: createReviewHandler,
  },

  // GET list review (no index; sort di memory)
  {
    method: 'GET',
    path: '/buket/{buketId}/reviews',
    options: {
      tags: ['api'],
      description: 'Ambil review & ringkasan rating (tanpa index, sort di memory)',
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
        query: Joi.object({
          limit: Joi.number().integer().min(1).max(500).default(100),
        }),
      },
      failAction: (_r, _h, err) => {
        console.error('[REVIEWS] VALIDATION ERROR:', err.message);
        throw err;
      },
    },
    handler: listBuketReviewsNoIndex,
  },
];
