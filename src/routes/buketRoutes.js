'use strict';

const Joi = require('joi');
const {
  getBuketDetail,
  createBuketHandler,
  getAllBuketHandler,
  updateBuketHandler,
  deleteBuketHandler,
  updateBuketImageHandler,
  createReviewHandler,
  listBuketReviewsNoIndex,   // << pakai no-index
  // [ADD]
  upsertCustomBuketHandler,
  updateCustomImageHandler,
} = require('../handlers/buketHandler');

module.exports = [
  // GET semua buket
  {
    method: 'GET',
    path: '/buket',
    options: { tags: ['api'], description: 'Ambil semua buket' },
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
        params: Joi.object({ buketId: Joi.string().required() }),
        query: Joi.object({ size: Joi.string().valid('small', 'medium', 'large').default('small') }),
      },
    },
    handler: getBuketDetail,
  },

  // POST create buket
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
          category: Joi.string().required(),
          is_customizable: Joi.boolean().required(),
          processing_time: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
          type: Joi.string().valid('template', 'custom').required(),
          image: Joi.any().meta({ swaggerType: 'file' }).required(),
          materialsBySize: Joi.string().required(), // JSON string
          service_price: Joi.number().required(),
        }),
        failAction: (_r, _h, err) => { console.error('VALIDATION ERROR:', err.message); throw err; },
      },
    },
    handler: createBuketHandler,
  },

  // PUT update buket
  {
    method: 'PUT',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Update data buket',
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
        payload: Joi.object({
          name: Joi.string(),
          size: Joi.string().valid('small', 'medium', 'large', 'multi'),
          category: Joi.string(),
          image_url: Joi.string().uri(),
          is_customizable: Joi.boolean(),
          processing_time: Joi.alternatives().try(Joi.string(), Joi.number()),
          service_price: Joi.number().integer().min(0),
          type: Joi.string().valid('template', 'custom'),
          materialsBySize: Joi.object({
            small: Joi.array().items(Joi.object({ materialId: Joi.string().required(), quantity: Joi.number().integer().min(1).required() })),
            medium: Joi.array().items(Joi.object({ materialId: Joi.string().required(), quantity: Joi.number().integer().min(1).required() })),
            large: Joi.array().items(Joi.object({ materialId: Joi.string().required(), quantity: Joi.number().integer().min(1).required() })),
          }).optional(),
        }),
        failAction: (_r, _h, err) => { console.error('VALIDATION ERROR:', err.message); throw err; },
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
        payload: Joi.object({ image: Joi.any().meta({ swaggerType: 'file' }).required() }),
        failAction: (_r, _h, err) => { console.error('VALIDATION ERROR:', err.message); throw err; },
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
      validate: { params: Joi.object({ buketId: Joi.string().required() }) },
    },
    handler: deleteBuketHandler,
  },

  /* ===== REVIEWS ===== */

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
          user_id: Joi.string().required(),       // wajib untuk anti-duplicate
          reviewer_name: Joi.string().allow('', null),
          rating: Joi.number().integer().min(1).max(5).required(),
          comment: Joi.string().allow('', null),
        }),
        failAction: (_r, _h, err) => { console.error('[REVIEWS] VALIDATION ERROR:', err.message); throw err; },
      },
    },
    handler: createReviewHandler,
  },

  // GET list review (NO INDEX)
  {
    method: 'GET',
    path: '/buket/{buketId}/reviews',
    options: {
      tags: ['api'],
      description: 'Ambil review & ringkasan rating (tanpa index, sort di memory)',
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
        query: Joi.object({ limit: Joi.number().integer().min(1).max(500).default(100) }),
      },
    },
    handler: listBuketReviewsNoIndex,
  },

    // === [ADD] Upsert buket CUSTOM (dokumen id: 'CUSTOM')
  {
    method: 'PUT',
    path: '/buket/custom',
    options: {
      tags: ['api'],
      description: 'Upsert dokumen buket khusus CUSTOM (id tetap "CUSTOM")',
      validate: {
        payload: Joi.object({
          name: Joi.string().optional(),
          image_url: Joi.string().uri().optional(),
          base_price_by_size: Joi.object({
            small: Joi.number().integer().min(0).optional(),
            medium: Joi.number().integer().min(0).optional(),
            large: Joi.number().integer().min(0).optional(),
          }).optional(),
          service_price: Joi.number().integer().min(0).optional(),
          processing_time: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
          requires_photo: Joi.boolean().optional(),     // default false
          is_customizable: Joi.boolean().optional(),    // default true
          category: Joi.string().optional(),            // default 'Custom'
        }),
        failAction: (_r, _h, err) => { console.error('[CUSTOM] VALIDATION ERROR:', err.message); throw err; },
      },
    },
    handler: upsertCustomBuketHandler,
  },

  // === [ADD] Update gambar khusus CUSTOM
  {
    method: 'PUT',
    path: '/buket/custom/image',
    options: {
      tags: ['api'],
      description: 'Update gambar untuk buket CUSTOM',
      payload: {
        output: 'stream',
        parse: true,
        allow: 'multipart/form-data',
        multipart: true,
        maxBytes: 5 * 1024 * 1024,
      },
      validate: {
        payload: Joi.object({
          image: Joi.any().meta({ swaggerType: 'file' }).required(),
        }),
        failAction: (_r, _h, err) => { console.error('[CUSTOM] VALIDATION ERROR:', err.message); throw err; },
      },
    },
    handler: updateCustomImageHandler,
  },

];
