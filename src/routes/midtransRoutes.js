const { handleCharge } = require('../handlers/midtransHandler');

module.exports = [
  {
    method: 'POST',
    path: '/midtrans/charge',
    handler: handleCharge,
  }
];
