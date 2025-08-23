const { addOrPromoteAdmin, listUsers, updateUserRole } = require('../handlers/userAdminHandler');
const { verifyToken, requireRole } = require('../middlewares/auth');

const userAdminRoutes = [
  {
    method: 'POST',
    path: '/users/admin/add',
    options: {
      pre: [
        { method: verifyToken },
        // Hanya owner atau admin yang boleh kelola
        { method: requireRole('owner', 'admin') },
      ],
      handler: addOrPromoteAdmin
    },
  },
  {
    method: 'GET',
    path: '/users',
    options: {
      pre: [
        { method: verifyToken },
        { method: requireRole('owner', 'admin') },
      ],
      handler: listUsers
    },
  },
  {
    method: 'PATCH',
    path: '/users/{id}/role',
    options: {
      pre: [
        { method: verifyToken },
        { method: requireRole('owner', 'admin') },
      ],
      handler: updateUserRole
    },
  },
];

module.exports = userAdminRoutes;
