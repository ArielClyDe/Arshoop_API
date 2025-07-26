const Hapi = require('@hapi/hapi');
const dotenv = require('dotenv');
dotenv.config();

const buketRoutes = require('./routes/buketRoutes');
const authRoutes = require('./routes/authRoutes');
const cartRoutes = require('./routes/cartRoutes');
const materialRoutes = require('./routes/materialRoutes');
const orderRoutes = require('./routes/orderRoutes');

const init = async () => {
  const server = Hapi.server({
    port: 5000,
    host: 'localhost',
    routes: {
      cors: {
        origin: ['*'], // Memungkinkan akses dari semua origin (untuk pengujian)
      },
    },
  });

  // Tambahkan route default (opsional, agar akses ke "/" tidak 404)
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
    ...orderRoutes
  ]);

  // Mulai server
  await server.start();
  console.log(`✅ Server running at: ${server.info.uri}`);
};

// Jalankan server
init();
