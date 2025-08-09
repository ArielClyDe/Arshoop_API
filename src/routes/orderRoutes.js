const Hapi = require('@hapi/hapi');
const {
    createOrderHandler,
    midtransNotificationHandler,
    updateOrderStatusHandler
} = require('../handlers/orderHandler');

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
    },
    {
        method: 'PATCH', // bisa pakai PUT juga, tapi PATCH lebih umum untuk update sebagian
        path: '/orders/status',
        handler: updateOrderStatusHandler,

    }
];
