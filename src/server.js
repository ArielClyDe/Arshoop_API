const Hapi = require('@hapi/hapi');
const dotenv = require('dotenv');
dotenv.config();

const buketRoutes = require('./routes/buketRoutes');
const authRoutes = require('./routes/authRoutes');
const cartRoutes = require('./routes/cartRoutes');
const materialRoutes = require('./routes/materialRoutes');
const orderRoutes = require('./routes/orderRoutes');
const testRoutes = require('./routes/testRoutes');
const userAdminRoutes = require('./routes/userAdminRoutes');

const fcmRoutes = require('./routes/fcmRoutes');




const init = async () => {
  try {
    console.log('🔄 Starting server...');

    const server = Hapi.server({
      port: process.env.PORT,
      host: '0.0.0.0',
      routes: {
        cors: {
          origin: ['*'],
        },
      },
    });

    server.route([
  {
    method: 'GET',
    path: '/',
    handler: (request, h) => {
      return {
        message: 'API Buket ARSHOOP aktif 🚀',
      };
    },
  },
  ...buketRoutes,
  ...authRoutes,
  ...cartRoutes,
  ...materialRoutes,
  ...orderRoutes,
  ...testRoutes,
  ...userAdminRoutes,
]);

    server.route(fcmRoutes); 
    console.log('[ROUTES] mounted fcmRoutes:', fcmRoutes.length);
setTimeout(() => {
  console.log('[ROUTES] list:');
  server.table().forEach(r => console.log(r.method.toUpperCase(), r.path));
}, 500);
    
    await server.start();
    console.log(`✅ Server running at: ${server.info.uri}`);
    console.log('🔐 Midtrans Key:', process.env.MIDTRANS_SERVER_KEY);
    
  } catch (err) {
    console.error('❌ Error saat inisialisasi server:', err);
  }
  
};
console.log('🌐 PORT dari Railway:', process.env.PORT);
init();
