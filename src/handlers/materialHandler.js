const cloudinary = require('../services/cloudinaryService');
const streamifier = require('streamifier');
const firebaseService = require('../services/firebaseService');

const addMaterialHandler = async (request, h) => {
  const { name, type, price } = request.payload;
  const image = request.payload.image;

  let buffer;
  try {
    buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (chunk) => chunks.push(chunk));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal membaca gambar', error: err.message }).code(400);
  }

  let uploadResult;
  try {
    const uploadStream = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'materials', resource_type: 'image' },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });

    uploadResult = await uploadStream();
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal upload gambar ke Cloudinary', error: err.message }).code(500);
  }

  try {
    const newDocRef = firebaseService.db.collection('materials').doc();
    const materialId = newDocRef.id;
    const newMaterial = {
      materialId,
      name,
      type,
      price: parseInt(price),
      image_url: uploadResult.secure_url,
      image_public_id: uploadResult.public_id,
      createdAt: new Date().toISOString(),
    };

    await newDocRef.set(newMaterial);

    return h.response({ status: 'success', message: 'Material berhasil ditambahkan', data: newMaterial }).code(201);
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal simpan ke Firestore', error: err.message }).code(500);
  }
};

const getAllMaterialsHandler = async (request, h) => {
  try {
    const snapshot = await firebaseService.db.collection('materials').get();
    const materials = snapshot.docs.map((doc) => doc.data());

    return h.response({ status: 'success', data: materials }).code(200);
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal mengambil data materials', error: err.message }).code(500);
  }
};

const deleteMaterialHandler = async (request, h) => {
  const { materialId } = request.params;

  try {
    const docRef = firebaseService.db.collection('materials').doc(materialId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return h.response({ status: 'fail', message: 'Material tidak ditemukan' }).code(404);
    }

    const { image_public_id } = docSnap.data();

    if (image_public_id) {
      await cloudinary.uploader.destroy(image_public_id);
    }

    await docRef.delete();

    return h.response({ status: 'success', message: 'Material berhasil dihapus' }).code(200);
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal menghapus material', error: err.message }).code(500);
  }
};

const updateMaterialHandler = async (request, h) => {
  const { materialId } = request.params;
  const { name, price } = request.payload;
  const image = request.payload.image;

  try {
    const docRef = firebaseService.db.collection('materials').doc(materialId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return h.response({ status: 'fail', message: 'Material tidak ditemukan' }).code(404);
    }

    const existingData = docSnap.data();
    let updatedFields = {
      name: name ?? existingData.name,
      price: price !== undefined ? parseInt(price) : existingData.price,
    };

    if (image) {
      // Upload gambar baru
      let buffer = await new Promise((resolve, reject) => {
        const chunks = [];
        image.on('data', (chunk) => chunks.push(chunk));
        image.on('end', () => resolve(Buffer.concat(chunks)));
        image.on('error', reject);
      });

      // Hapus gambar lama
      if (existingData.image_public_id) {
        await cloudinary.uploader.destroy(existingData.image_public_id);
      }

      // Upload baru
      const uploadStream = () =>
        new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'materials', resource_type: 'image' },
            (error, result) => (error ? reject(error) : resolve(result))
          );
          streamifier.createReadStream(buffer).pipe(stream);
        });

      const result = await uploadStream();
      updatedFields.image_url = result.secure_url;
      updatedFields.image_public_id = result.public_id;
    }

    await docRef.update(updatedFields);

    return h.response({ status: 'success', message: 'Material berhasil diupdate', data: updatedFields }).code(200);
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal update material', error: err.message }).code(500);
  }
};

module.exports = {
  addMaterialHandler,
  getAllMaterialsHandler,
  deleteMaterialHandler,
  updateMaterialHandler,
};
