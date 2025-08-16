const cloudinary = require('../services/cloudinaryService');
const streamifier = require('streamifier');
const firebaseService = require('../services/firebaseService');

/* =========================
   CREATE material
   ========================= */
const addMaterialHandler = async (request, h) => {
  const { name, type, price } = request.payload;
  const image = request.payload.image;

  // --- Baca file upload utama (gambar material) ---
  let buffer;
  try {
    buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (chunk) => chunks.push(chunk));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });
  } catch (err) {
    return h
      .response({ status: 'fail', message: 'Gagal membaca gambar', error: err.message })
      .code(400);
  }

  // --- Upload Cloudinary gambar material ---
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
    return h
      .response({ status: 'fail', message: 'Gagal upload gambar ke Cloudinary', error: err.message })
      .code(500);
  }

  // --- Simpan ke Firestore ---
  try {
    const newDocRef = firebaseService.db.collection('materials').doc();
    const materialId = newDocRef.id;

    const parsedPrice = parseInt(price, 10);
    if (Number.isNaN(parsedPrice)) {
      return h.response({ status: 'fail', message: 'price harus angka' }).code(400);
    }

    const normalizedType = String(type).trim();
    const newMaterial = {
      materialId,
      name,
      type: normalizedType,
      price: parsedPrice,
      image_url: uploadResult.secure_url,
      image_public_id: uploadResult.public_id,
      createdAt: new Date().toISOString(),
      // true hanya untuk tipe "Photo"
      requires_photo: normalizedType === 'Photo',
    };

    await newDocRef.set(newMaterial);

    return h
      .response({ status: 'success', message: 'Material berhasil ditambahkan', data: newMaterial })
      .code(201);
  } catch (err) {
    return h
      .response({ status: 'fail', message: 'Gagal simpan ke Firestore', error: err.message })
      .code(500);
  }
};

/* =========================
   LIST materials
   ========================= */
const getAllMaterialsHandler = async (_request, h) => {
  try {
    const snapshot = await firebaseService.db.collection('materials').get();
    const materials = snapshot.docs.map((doc) => {
      const d = doc.data();
      // fallback untuk dokumen lama yang belum punya requires_photo
      if (typeof d.requires_photo === 'undefined') {
        d.requires_photo = d.type === 'Photo';
      }
      return d;
    });

    return h.response({ status: 'success', data: materials }).code(200);
  } catch (err) {
    return h
      .response({ status: 'fail', message: 'Gagal mengambil data materials', error: err.message })
      .code(500);
  }
};

/* =========================
   DELETE material
   ========================= */
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
    return h
      .response({ status: 'fail', message: 'Gagal menghapus material', error: err.message })
      .code(500);
  }
};

/* =========================
   UPDATE material
   ========================= */
const updateMaterialHandler = async (request, h) => {
  const { materialId } = request.params;
  const { name, price, type: newType, requires_photo } = request.payload;
  const image = request.payload.image;

  try {
    const docRef = firebaseService.db.collection('materials').doc(materialId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return h.response({ status: 'fail', message: 'Material tidak ditemukan' }).code(404);
    }

    const existingData = docSnap.data();

    const updatedFields = {
      name: name ?? existingData.name,
      price: price !== undefined ? parseInt(price, 10) : existingData.price,
      type: newType ?? existingData.type,
    };

    // Sinkronisasi requires_photo
    if (typeof requires_photo === 'boolean') {
      updatedFields.requires_photo = requires_photo;
    } else if (newType) {
      updatedFields.requires_photo = newType === 'Photo';
    }

    // --- Gambar baru? ---
    if (image) {
      // baca file
      const buffer = await new Promise((resolve, reject) => {
        const chunks = [];
        image.on('data', (chunk) => chunks.push(chunk));
        image.on('end', () => resolve(Buffer.concat(chunks)));
        image.on('error', reject);
      });

      // hapus gambar lama
      if (existingData.image_public_id) {
        await cloudinary.uploader.destroy(existingData.image_public_id);
      }

      // upload baru
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

    return h
      .response({ status: 'success', message: 'Material berhasil diupdate', data: updatedFields })
      .code(200);
  } catch (err) {
    return h
      .response({ status: 'fail', message: 'Gagal update material', error: err.message })
      .code(500);
  }
};

/* =========================
   UPLOAD multi-foto untuk material "Photo"
   (digunakan pelanggan saat menambahkan bahan Photo)
   ========================= */
const uploadMaterialPhotosHandler = async (request, h) => {
  try {
    let files = request.payload?.photos;
    if (!files) {
      return h.response({ status: 'fail', message: 'Field "photos" wajib diisi' }).code(400);
    }
    if (!Array.isArray(files)) files = [files];

    const uploadOne = async (fileStream) => {
      const buffer = await new Promise((resolve, reject) => {
        const chunks = [];
        fileStream.on('data', (c) => chunks.push(c));
        fileStream.on('end', () => resolve(Buffer.concat(chunks)));
        fileStream.on('error', reject);
      });

      const send = () =>
        new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'user_photos', resource_type: 'image' }, // folder khusus foto pelanggan
            (err, result) => (err ? reject(err) : resolve(result))
          );
          streamifier.createReadStream(buffer).pipe(stream);
        });

      const res = await send();
      return {
        url: res.secure_url,
        public_id: res.public_id,
        width: res.width,
        height: res.height,
        bytes: res.bytes,
      };
    };

    const results = await Promise.all(files.map(uploadOne));

    return h.response({
      status: 'success',
      message: 'Foto berhasil diupload',
      data: results,
    }).code(201);
  } catch (err) {
    return h.response({
      status: 'fail',
      message: 'Gagal upload foto',
      error: err.message,
    }).code(500);
  }
};

module.exports = {
  addMaterialHandler,
  getAllMaterialsHandler,
  deleteMaterialHandler,
  updateMaterialHandler,
  uploadMaterialPhotosHandler, // << baru
};
