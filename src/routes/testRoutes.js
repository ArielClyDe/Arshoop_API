// src/routes/testRoutes.js
const { testFirebaseHandler } = require('../handlers/testHAndler');

module.exports = [
  {
    method: 'GET',
    path: '/test-firebase',
    handler: testFirebaseHandler,
  },
];
