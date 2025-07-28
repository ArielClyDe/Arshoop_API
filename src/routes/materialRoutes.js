const Joi = require('joi');
const materialHandler = require('../handlers/materialHandler');

module.exports = [
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
          type: Joi.string().valid('Bunga', 'snack', 'Photo', 'boneka', 'Lainnya').required(),
          price: Joi.number().integer().required(),
          image: Joi.any().required(),
        }),
        failAction: (request, h, err) => {
          return h
            .response({
              status: 'fail',
              message: 'Validasi input gagal',
              error: err.details[0].message,
            })
            .code(400)
            .takeover();
        },
      },
      handler: materialHandler.addMaterialHandler,
    }
  }
];
