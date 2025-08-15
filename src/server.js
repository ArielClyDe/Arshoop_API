/* eslint-disable no-console */
const Hapi = require('@hapi/hapi');
const dotenv = require('dotenv');
dotenv.config();

const Jwt = require('@hapi/jwt'); // auth plugin

// Routes
const buketRoutes = require('./routes/buketRoutes');
const authRoutes = require('./routes/authRoutes');
const cartRoutes = require('./routes/cartRoutes');
const materialRoutes = require('./routes/materialRoutes');
const orderRoutes = require('./routes/orderRoutes');
const testRoutes = require('./routes/testRoutes');

const init = async () => {
  try {
    console.log('🔄 Starting server...');

    const server = Hapi.server({
      port: process.env.PORT || 3000,
      host: '0.0.0.0',
      routes: {
        cors: {
          origin: ['*'],
          additionalHeaders: ['Authorization', 'x-user-id'], // token & fallback testing
        },
      },
    });

    // ===== Auth: JWT strategy 'default' =====
    await server.register(Jwt);

    server.auth.strategy('default', 'jwt', {
      keys: process.env.JWT_SECRET,
      verify: {
        aud: false, iss: false, sub: false,
        nbf: true, exp: true,
        maxAgeSec: 30 * 24 * 60 * 60, // 30 hari
      },
      validate: (artifacts) => {
        const p = artifacts.decoded.payload || {};
        const userId = p.userId || p.uid || p.sub;
        if (!userId) return { isValid: false };
        return { isValid: true, credentials: { userId, role: p.role || 'user' } };
      },
    });

    // default auth untuk semua route; route public akan override dengan auth:false
    server.auth.default('default');

    // Route root (public)
    server.route({
      method: 'GET',
      path: '/',
      options: { auth: false },
      handler: () => ({ message: 'API Buket ARSHOOP aktif 🚀' }),
    });

    // Register routes
    server.route([
      ...buketRoutes,
      ...authRoutes,
      ...cartRoutes,
      ...materialRoutes,
      ...orderRoutes,
      ...testRoutes,
    ]);

    await server.start();
    console.log(`✅ Server running at: ${server.info.uri}`);
    console.log('🔐 JWT strategy: default');
    console.log('🔐 Midtrans Key:', process.env.MIDTRANS_SERVER_KEY || '(not set)');
  } catch (err) {
    console.error('❌ Error saat inisialisasi server:', err);
    process.exit(1);
  }
};

console.log('🌐 PORT dari env:', process.env.PORT);
init();
