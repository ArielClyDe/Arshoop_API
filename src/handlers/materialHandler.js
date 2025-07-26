const firebaseService = require('../services/firebaseService');

const addMaterialHandler = async (request, h) => {
  const { name, type, price } = request.payload;

  try {
    const newDocRef = await firebaseService.addMaterial({}); // sementara kosong untuk dapatkan ID
    const materialId = newDocRef.id;

    const newMaterial = { materialId, name, type, price };
    await newDocRef.set(newMaterial); // set data lengkap

    return h.response({
      status: 'success',
      message: 'Material berhasil ditambahkan',
      data: { materialId }
    }).code(201);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal menyimpan material'
    }).code(500);
  }
};

module.exports = { addMaterialHandler };
