const { registerUser, loginUser } = require('../handlers/authHandler');

const authRoutes = [
  {
    method: 'POST',
    path: '/register',
    handler: registerUser,
  },
  {
    method: 'POST',
    path: '/login',
    handler: loginUser,
  }
];

module.exports = authRoutes;
