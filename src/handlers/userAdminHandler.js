const bcrypt = require('bcrypt');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');

/** Util sederhana */
const isEmail = (s='') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * POST /users/admin/add
 * body: { email, name }
 * - Jika user dgn email ada → update role jadi 'admin'
 * - Else jika ada yang name == name → update doc itu role 'admin'
 * - Else buat akun stub (password random), role 'admin'
 */
const addOrPromoteAdmin = async (request, h) => {
  const { email, name } = request.payload || {};

  if (!email || !isEmail(email)) {
    return h.response({ message: 'Email tidak valid.' }).code(400);
  }
  if (!name || String(name).trim().length < 2) {
    return h.response({ message: 'Nama wajib diisi.' }).code(400);
  }

  try {
    // 1) Cari by email (paling aman & unik)
    const byEmail = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!byEmail.empty) {
      const doc = byEmail.docs[0];
      const before = doc.data();
      // Hindari no-op
      if (before.role === 'admin') {
        return h.response({
          message: 'User sudah admin.',
          user: { id: doc.id, ...before }
        }).code(200);
      }
      await doc.ref.update({ role: 'admin', updated_at: new Date() });
      const afterSnap = await doc.ref.get();
      return h.response({
        message: 'Berhasil mempromosikan user menjadi admin (by email).',
        user: { id: doc.id, ...afterSnap.data() }
      }).code(200);
    }

    // 2) Kalau belum ada by email, cek by nama (sesuai permintaan kamu)
    //    Perhatian: name tidak unik → bisa ada >1. Kita ambil yang paling baru dibuat.
    const byName = await db.collection('users')
      .where('name', '==', name)
      .orderBy('created_at', 'desc')
      .limit(1).get();

    if (!byName.empty) {
      const doc = byName.docs[0];
      await doc.ref.update({
        email,              // sinkronkan email yang baru
        role: 'admin',
        updated_at: new Date()
      });
      const after = (await doc.ref.get()).data();
      return h.response({
        message: 'Berhasil mempromosikan user menjadi admin (by name).',
        user: { id: doc.id, ...after }
      }).code(200);
    }

    // 3) Tidak ada user: buat akun stub (invite)
    const userId = uuidv4();
    const tempPasswordPlain = uuidv4().slice(0, 8); // password sementara 8-char
    const hashed = await bcrypt.hash(tempPasswordPlain, 10);

    const newDoc = {
      name,
      email,
      password: hashed,    // agar bisa login; ganti saat first login
      no_telp: '',
      alamat: '',
      role: 'admin',
      created_at: new Date(),
    };

    await db.collection('users').doc(userId).set(newDoc);

    return h.response({
      message: 'Admin baru dibuat (akun undangan).',
      user: { id: userId, ...newDoc },
      tempPassword: tempPasswordPlain  // kirim via channel aman (email) di produksi!
    }).code(201);

  } catch (err) {
    console.error(err);
    return h.response({ message: 'Terjadi kesalahan saat tambah/promote admin.' }).code(500);
  }
};

/**
 * GET /users
 * List semua user (opsional: ?role=admin|customer)
 */
const listUsers = async (request, h) => {
  try {
    const roleFilter = request.query.role;
    let ref = db.collection('users');
    if (roleFilter) ref = ref.where('role', '==', roleFilter);

    const snap = await ref.orderBy('created_at', 'desc').limit(200).get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return h.response({ data: users }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({ message: 'Gagal mengambil data user.' }).code(500);
  }
};

/**
 * PATCH /users/{id}/role
 * body: { role: 'admin'|'customer'|'staff'|'owner' }
 */
const updateUserRole = async (request, h) => {
  const { id } = request.params;
  const { role } = request.payload || {};

  const allowed = ['customer', 'staff', 'admin', 'owner'];
  if (!allowed.includes(role)) {
    return h.response({ message: 'Role tidak valid.' }).code(400);
  }

  // Opsional: larang user menurunkan peran dirinya sendiri
  const me = request.auth?.credentials;
  if (me?.id === id && me.role !== role) {
    return h.response({ message: 'Tidak dapat mengubah peran diri sendiri.' }).code(400);
  }

  try {
    const ref = db.collection('users').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return h.response({ message: 'User tidak ditemukan.' }).code(404);

    await ref.update({ role, updated_at: new Date() });
    const after = (await ref.get()).data();
    return h.response({ message: 'Role diperbarui.', user: { id, ...after } }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({ message: 'Gagal memperbarui role.' }).code(500);
  }
};

module.exports = { addOrPromoteAdmin, listUsers, updateUserRole };
