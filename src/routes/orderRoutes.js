// orderRoutes.js
const { createOrderHandler, midtransNotificationHandler } = require('../handlers/orderHandler');

module.exports = [
    {
        method: 'POST',
        path: '/orders',
        handler: createOrderHandler
    },
    {
        method: 'POST',
        path: '/midtrans/notification',
        handler: midtransNotificationHandler
    }
];