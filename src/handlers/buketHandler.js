const fs = require('fs');
const path = require('path');
const { db } = require('../services/firebaseService');
const cloudinary = require('../services/cloudinaryService');
const { nanoid } = require('nanoid'); // Pastikan kamu import ini ya!

// Fungsi bantu: Hitung harga dasar dari materialsBySize
const calculateBasePriceBySize = async (materialsBySize) => {
  const basePrice = {};

  for (const size in materialsBySize) {
    const materialList = materialsBySize[size];
    let total = 0;

    for (const item of materialList) {
      const materialSnapshot = await db.collection('materials').doc(item.materialId).get();

      if (!materialSnapshot.exists) {
        throw new Error(`Material dengan ID ${item.materialId} tidak ditemukan.`);
      }

      const materialData = materialSnapshot.data();
      total += (materialData.price || 0) * (item.quantity || 0);
    }

    basePrice[size] = total;
  }

  return basePrice;
};

// Upload gambar mandiri (jika kamu masih ingin pakai endpoint /upload)
const uploadImageHandler = async (request, h) => {
  const { image } = request.payload;

  const filename = `${Date.now()}-${image.hapi.filename}`;
  const filepath = path.join(__dirname, '../../uploads', filename);
  const fileStream = fs.createWriteStream(filepath);

  await new Promise((resolve, reject) => {
    image.pipe(fileStream);
    image.on('end', resolve);
    image.on('error', reject);
  });

  try {
    const result = await cloudinary.uploader.upload(filepath, {
      folder: 'buket'
    });

    fs.unlinkSync(filepath); // bersihkan file lokal

    return h.response({
      status: 'success',
      message: 'Upload berhasil',
      imageUrl: result.secure_url,
    });
  } catch (error) {
    fs.existsSync(filepath) && fs.unlinkSync(filepath); // tetap hapus file jika error
    return h.response({
      status: 'fail',
      message: 'Upload gagal',
      error: error.message
    }).code(500);
  }
};

// Buat buket baru
const createBuketHandler = async (request, h) => {
  const {
    name,
    description,
    type,
    category,
    requires_photo,
    materialsBySize
  } = request.payload;

  const parsedMaterials = JSON.parse(materialsBySize);
  const filename = `${Date.now()}-${request.payload.image.hapi.filename}`;
  const filepath = path.join(__dirname, '../../uploads', filename);
  const fileStream = fs.createWriteStream(filepath);

  // Simpan file sementara
  await new Promise((resolve, reject) => {
    request.payload.image.pipe(fileStream);
    request.payload.image.on('end', resolve);
    request.payload.image.on('error', reject);
  });

  let imageUrl;
  try {
    // Upload ke Cloudinary
    const result = await cloudinary.uploader.upload(filepath, {
      folder: 'buket',
    });

    imageUrl = result.secure_url;
  } catch (err) {
    fs.existsSync(filepath) && fs.unlinkSync(filepath);
    return h.response({
      status: 'fail',
      message: 'Gagal upload gambar ke Cloudinary',
      error: err.message,
    }).code(500);
  } finally {
    // Pastikan file lokal dihapus
    fs.existsSync(filepath) && fs.unlinkSync(filepath);
  }

  try {
    // Hitung harga dasar otomatis
    const base_price_by_size = await calculateBasePriceBySize(parsedMaterials);

    const buketId = nanoid(16);
    const newBuket = {
      buketId,
      name,
      description,
      type,
      category,
      requires_photo: requires_photo === 'true',
      image_url: imageUrl,
      materialsBySize: parsedMaterials,
      base_price_by_size,
      created_at: new Date().toISOString(),
    };

    await db.collection('buket').doc(buketId).set(newBuket);

    return h.response({
      status: 'success',
      message: 'Buket berhasil dibuat',
      data: newBuket,
    }).code(201);
  } catch (error) {
    return h.response({
      status: 'fail',
      message: 'Gagal menyimpan buket ke database',
      error: error.message,
    }).code(500);
  }
};
