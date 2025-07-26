const Hapi = require('@hapi/hapi');
const dotenv = require('dotenv');
dotenv.config();

const buketRoutes = require('./routes/buketRoutes');
const authRoutes = require('./routes/authRoutes');
const cartRoutes = require('./routes/cartRoutes');
const materialRoutes = require('./routes/materialRoutes');
const orderRoutes = require('./routes/orderRoutes');

const init = async () => {
  try {
    console.log('🔄 Starting server...');

    const server = Hapi.server({
      port: process.env.PORT || 8080,
      host: '0.0.0.0',
      routes: {
        cors: {
          origin: ['*'],
        },
      },
    });

    // Route default untuk root path
    server.route({
      method: 'GET',
      path: '/',
      handler: (request, h) => {
        return {
          message: 'API Buket ARSHOOP aktif 🚀',
        };
      },
    });

    // Gabungkan semua routes dari file terpisah
    server.route([
      ...buketRoutes,
      ...authRoutes,
      ...cartRoutes,
      ...materialRoutes,
      ...orderRoutes,
    ]);

    await server.start();
    console.log(`✅ Server running at: ${server.info.uri}`);
  } catch (err) {
    console.error('❌ Error saat inisialisasi server:', err);
  }
};

// Jalankan server
init();
