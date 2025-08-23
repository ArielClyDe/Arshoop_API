const jwt = require('jsonwebtoken');

const verifyToken = (request, h) => {
  try {
    const auth = request.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new Error('Missing token');

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // taruh payload di request.auth.credentials
    request.auth = { credentials: payload };
    return h.continue;
  } catch (err) {
    return h.response({ message: 'Unauthorized' }).code(401).takeover();
  }
};

/** izinkan hanya role tertentu (mis. OWNER atau ADMIN) */
const requireRole = (...allowed) => {
  return (request, h) => {
    const cred = request.auth?.credentials;
    if (!cred || !allowed.includes(cred.role)) {
      return h.response({ message: 'Forbidden' }).code(403).takeover();
    }
    return h.continue;
  };
};

module.exports = { verifyToken, requireRole };
