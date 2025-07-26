const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');

// REGISTER
const registerUser = async (request, h) => {
  const { name, email, password, no_telp, alamat } = request.payload;

  try {
    // Cek apakah email sudah digunakan
    const snapshot = await db.collection('users').where('email', '==', email).get();
    if (!snapshot.empty) {
      return h.response({ message: 'Email sudah terdaftar.' }).code(400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await db.collection('users').doc(userId).set({
      name,
      email,
      password: hashedPassword,
      no_telp,
      alamat,
      role: 'customer',
      created_at: new Date(),
    });

    return h.response({ message: 'Registrasi berhasil.' }).code(201);
  } catch (error) {
    console.error(error);
    return h.response({ message: 'Terjadi kesalahan saat registrasi.' }).code(500);
  }
};

// LOGIN
const loginUser = async (request, h) => {
  const { email, password } = request.payload;

  try {
    const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) {
      return h.response({ message: 'Email tidak ditemukan.' }).code(404);
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    const isValid = await bcrypt.compare(password, userData.password);
    if (!isValid) {
      return h.response({ message: 'Password salah.' }).code(401);
    }

    // Buat token dengan payload data user
    const token = jwt.sign(
      {
        id: userDoc.id,
        email: userData.email,
        name: userData.name,
        role: userData.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    return h.response({
      message: 'Login berhasil.',
      token,
      user: {
        id: userDoc.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
      }
    }).code(200);
  } catch (error) {
    console.error(error);
    return h.response({ message: 'Terjadi kesalahan saat login.' }).code(500);
  }
};

module.exports = { registerUser, loginUser };
