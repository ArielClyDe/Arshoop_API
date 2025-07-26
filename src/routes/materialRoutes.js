const Joi = require('joi');
const materialHandler = require('../handlers/materialHandler');

module.exports = [
  {
    method: 'POST',
    path: '/materials',
    options: {
      tags: ['api'],
      description: 'Menambahkan material buket',
      validate: {
        payload: Joi.object({
          name: Joi.string().required(),
          type: Joi.string().valid('Bunga', 'Daun', 'Pita', 'Lainnya').required(),
          price: Joi.number().integer().required()
        })
      },
      handler: materialHandler.addMaterialHandler,
    }
  }
];
