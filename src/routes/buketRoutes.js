// routes/buketRoutes.js
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
  listReviewsHandler,
  updateReviewHandler,
  deleteReviewHandler,
} = require('../handlers/buketHandler');

module.exports = [
  /* ------------------------------- BUKET ------------------------------- */
  {
    method: 'GET',
    path: '/buket',
    options: {
      tags: ['api'],
      description: 'Ambil semua buket',
    },
    handler: getAllBuketHandler,
  },

  {
    method: 'GET',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Ambil detail buket berdasarkan ID dan ukuran',
      validate: {
        params: Joi.object({
          buketId: Joi.string().required(),
        }),
        query: Joi.object({
          size: Joi.string().valid('small', 'medium', 'large').default('small'),
        }),
      },
    },
    handler: getBuketDetail,
  },

  {
    method: 'POST',
    path: '/buket',
    options: {
      tags: ['api'],
      description: 'Tambah buket baru dengan bahan dan gambar',
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
          requires_photo: Joi.boolean().required(),
          type: Joi.string().valid('template', 'custom').required(),
          image: Joi.any().meta({ swaggerType: 'file' }).required(),
          materialsBySize: Joi.string().required(), // kirim sebagai string JSON
          service_price: Joi.number().required(),
        }),
        failAction: (request, h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        },
      },
    },
    handler: createBuketHandler,
  },

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
          category: Joi.string(),
          image_url: Joi.string().uri(),
          is_customizable: Joi.boolean(),
          processing_time: Joi.alternatives().try(Joi.string(), Joi.number()),
          requires_photo: Joi.boolean(),
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
        failAction: (request, h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        },
      },
    },
    handler: updateBuketHandler,
  },

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
        params: Joi.object({
          buketId: Joi.string().required(),
        }),
        payload: Joi.object({
          image: Joi.any().meta({ swaggerType: 'file' }).required(),
        }),
        failAction: (request, h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        },
      },
    },
    handler: updateBuketImageHandler,
  },

  {
    method: 'DELETE',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Hapus buket berdasarkan ID',
      validate: {
        params: Joi.object({
          buketId: Joi.string().required(),
        }),
      },
    },
    handler: deleteBuketHandler,
  },

  /* ------------------------------ REVIEWS ------------------------------ */
  // List reviews (public)
  {
    method: 'GET',
    path: '/buket/{buketId}/reviews',
    options: {
      tags: ['api'],
      description: 'Ambil daftar review buket (paginate)',
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
        query: Joi.object({
          limit: Joi.number().integer().min(1).max(50).default(10),
          after: Joi.string().optional(), // reviewId terakhir untuk pagination
        }),
      },
    },
    handler: listReviewsHandler,
  },

  // Create review (auth required)
  {
    method: 'POST',
    path: '/buket/{buketId}/reviews',
    options: {
      tags: ['api'],
      description: 'Buat review untuk buket (hanya setelah order completed)',
      auth: { mode: 'required', strategy: 'default' }, // sesuaikan dengan strategi JWT kamu
      validate: {
        params: Joi.object({ buketId: Joi.string().required() }),
        payload: Joi.object({
          rating: Joi.number().integer().min(1).max(5).required(),
          comment: Joi.string().allow('').max(1000).optional(),
        }),
        failAction: (request, h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        },
      },
    },
    handler: createReviewHandler,
  },

  // Update review sendiri (auth required)
  {
    method: 'PUT',
    path: '/buket/{buketId}/reviews/{reviewId}',
    options: {
      tags: ['api'],
      description: 'Update review milik sendiri',
      auth: { mode: 'required', strategy: 'default' },
      validate: {
        params: Joi.object({
          buketId: Joi.string().required(),
          reviewId: Joi.string().required(),
        }),
        payload: Joi.object({
          rating: Joi.number().integer().min(1).max(5).optional(),
          comment: Joi.string().allow('').max(1000).optional(),
        }).or('rating', 'comment'),
        failAction: (request, h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        },
      },
    },
    handler: updateReviewHandler,
  },

  // Delete review sendiri (auth required)
  {
    method: 'DELETE',
    path: '/buket/{buketId}/reviews/{reviewId}',
    options: {
      tags: ['api'],
      description: 'Hapus review milik sendiri',
      auth: { mode: 'required', strategy: 'default' },
      validate: {
        params: Joi.object({
          buketId: Joi.string().required(),
          reviewId: Joi.string().required(),
        }),
      },
    },
    handler: deleteReviewHandler,
  },
];
