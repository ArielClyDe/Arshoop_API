const Joi = require('joi');
const materialHandler = require('../handlers/materialHandler');

module.exports = [
  // CREATE material
  {
    method: 'POST',
    path: '/materials',
    options: {
      tags: ['api'],
      description: 'Menambahkan material buket dengan upload gambar ke Cloudinary',
      payload: {
        output: 'stream',
        parse: true,
        allow: 'multipart/form-data',
        multipart: true,
        maxBytes: 5 * 1024 * 1024, // max 5MB
      },
      validate: {
        payload: Joi.object({
          name: Joi.string().required(),
          type: Joi.string().valid('Bunga', 'Snack', 'Photo', 'Boneka', 'Lainnya').required(),
          price: Joi.number().integer().required(),
          image: Joi.any().required(),
          requires_photo: Joi.boolean().optional(), // di handler akan di-set otomatis berdasar type
        }),
        failAction: (request, h, err) =>
          h
            .response({
              status: 'fail',
              message: 'Validasi input gagal',
              error: err.details?.[0]?.message || err.message,
            })
            .code(400)
            .takeover(),
      },
      handler: materialHandler.addMaterialHandler,
    }
  },

  // GET all materials
  {
    method: 'GET',
    path: '/materials',
    options: {
      tags: ['api'],
      description: 'Mengambil semua data material',
      handler: materialHandler.getAllMaterialsHandler,
    }
  },

  // UPDATE material
  {
    method: 'PUT',
    path: '/materials/{materialId}',
    options: {
      tags: ['api'],
      description: 'Update material berdasarkan ID',
      payload: {
        output: 'stream',
        parse: true,
        allow: 'multipart/form-data',
        multipart: true,
        maxBytes: 5 * 1024 * 1024,
      },
      validate: {
        params: Joi.object({
          materialId: Joi.string().required(),
        }),
        payload: Joi.object({
          name: Joi.string().optional(),
          type: Joi.string().valid('Bunga', 'Snack', 'Photo', 'Boneka', 'Lainnya').optional(),
          price: Joi.number().integer().optional(),
          image: Joi.any().optional(),
          requires_photo: Joi.boolean().optional(),
        }),
        failAction: (request, h, err) =>
          h
            .response({
              status: 'fail',
              message: 'Validasi input gagal',
              error: err.details?.[0]?.message || err.message,
            })
            .code(400)
            .takeover(),
      },
      handler: materialHandler.updateMaterialHandler,
    }
  },

  // DELETE material
  {
    method: 'DELETE',
    path: '/materials/{materialId}',
    options: {
      tags: ['api'],
      description: 'Hapus material berdasarkan ID',
      validate: {
        params: Joi.object({
          materialId: Joi.string().required(),
        }),
        failAction: (request, h, err) =>
          h
            .response({
              status: 'fail',
              message: 'Validasi input gagal',
              error: err.details?.[0]?.message || err.message,
            })
            .code(400)
            .takeover(),
      },
      handler: materialHandler.deleteMaterialHandler,
    }
  },

  // UPLOAD multi-foto untuk material "Photo"
  {
    method: 'POST',
    path: '/materials/photos',
    options: {
      tags: ['api'],
      description: 'Upload multi-foto pelanggan untuk material bertipe Photo',
      payload: {
        output: 'stream',
        parse: true,
        allow: 'multipart/form-data',
        multipart: true,
        maxBytes: 20 * 1024 * 1024, // 20MB total
      },
      validate: {
        payload: Joi.object({
          photos: Joi.any().required(), // boleh banyak; kirim field "photos" berulang
        }),
        failAction: (request, h, err) =>
          h
            .response({
              status: 'fail',
              message: 'Validasi input gagal',
              error: err?.details?.[0]?.message || err.message,
            })
            .code(400)
            .takeover(),
      },
      handler: materialHandler.uploadMaterialPhotosHandler,
    },
  },
];
