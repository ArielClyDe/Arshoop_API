const { createOrderHandler, midtransNotificationHandler } = require('../handlers/orderHandler');

server.route([
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
]);
