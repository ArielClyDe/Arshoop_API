const cloudinary = require('../services/cloudinaryService');
const streamifier = require('streamifier');
const firebaseService = require('../services/firebaseService');

const addMaterialHandler = async (request, h) => {
  const { name, type, price } = request.payload;
  const image = request.payload.image;

  // Baca stream dari image
  let buffer;
  try {
    buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (chunk) => chunks.push(chunk));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });
  } catch (err) {
    return h.response({
      status: 'fail',
      message: 'Gagal membaca gambar dari request',
      error: err.message,
    }).code(400);
  }

  // Upload ke Cloudinary (folder: materials)
  let imageUrl;
  try {
    const uploadStream = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'materials',
            resource_type: 'image',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );

        streamifier.createReadStream(buffer).pipe(stream);
      });

    const result = await uploadStream();
    imageUrl = result.secure_url;
  } catch (err) {
    return h.response({
      status: 'fail',
      message: 'Gagal upload gambar ke Cloudinary',
      error: err.message,
    }).code(500);
  }

  // Simpan ke Firestore
  try {
    const newDocRef = await firebaseService.addMaterial({});
    const materialId = newDocRef.id;

    const newMaterial = {
      materialId,
      name,
      type,
      price: parseInt(price),
      image_url: imageUrl,
      createdAt: new Date().toISOString(),
    };

    await newDocRef.set(newMaterial);

    return h.response({
      status: 'success',
      message: 'Material berhasil ditambahkan',
      data: newMaterial,
    }).code(201);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal menyimpan material ke database',
      error: err.message,
    }).code(500);
  }
};

module.exports = { addMaterialHandler };
