const Joi = require('joi');
const {
  getBuketDetail,
  createBuketHandler,
  getAllBuketHandler,
  updateBuketHandler,
  deleteBuketHandler
} = require('../handlers/buketHandler');

module.exports = [
  // Ambil semua buket
  {
    method: 'GET',
    path: '/buket',
    options: {
      tags: ['api'],
      description: 'Ambil semua buket'
    },
    handler: getAllBuketHandler
  },


    // Ambil detail buket berdasarkan ID dan ukuran
  {
    method: 'GET',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Ambil detail buket berdasarkan ID dan ukuran',
      validate: {
        params: Joi.object({
          buketId: Joi.string().required()
        }),
        query: Joi.object({
          size: Joi.string().valid('small', 'medium', 'large').default('small')
        })
      }
    },
    handler: getBuketDetail
  },

  // Tambah buket baru sekaligus upload gambar dan bahan
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
          materialsBySize: Joi.string().required(), // dikirim sebagai string JSON
          service_price: Joi.number().required(),
        }),
        failAction: (request, h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        }
      }
    },
    handler: createBuketHandler
  },

  // Update buket berdasarkan ID
  {
    method: 'PUT',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Update data buket',
      validate: {
        params: Joi.object({
          buketId: Joi.string().required()
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
            small: Joi.array().items(Joi.object({
              materialId: Joi.string().required(),
              quantity: Joi.number().integer().min(1).required()
            })),
            medium: Joi.array().items(Joi.object({
              materialId: Joi.string().required(),
              quantity: Joi.number().integer().min(1).required()
            })),
            large: Joi.array().items(Joi.object({
              materialId: Joi.string().required(),
              quantity: Joi.number().integer().min(1).required()
            }))
          }).optional()
        }),
        failAction: (request, h, err) => {
          console.error('VALIDATION ERROR:', err.message);
          throw err;
        }
      }
    },
    handler: updateBuketHandler
  },

  // Hapus buket berdasarkan ID
  {
    method: 'DELETE',
    path: '/buket/{buketId}',
    options: {
      tags: ['api'],
      description: 'Hapus buket berdasarkan ID',
      validate: {
        params: Joi.object({
          buketId: Joi.string().required()
        })
      }
    },
    handler: deleteBuketHandler
  }
  
];

