const cloudinary = require('../services/cloudinaryService');
const fs = require('fs');
const path = require('path');
const { db } = require('../services/firebaseService');

// Upload gambar ke Cloudinary

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
      folder: 'buket' // atau sesuai folder yang kamu inginkan
    });

    fs.unlinkSync(filepath); // hapus file lokal setelah upload berhasil

    return h.response({
      status: 'success',
      message: 'Upload berhasil',
      imageUrl: result.secure_url,
    });
  } catch (error) {
    return h.response({
      status: 'fail',
      message: 'Upload gagal',
      error: error.message
    }).code(500);
  }
};

// Fungsi untuk menghitung harga dasar per ukuran dari materialsBySize
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
      const price = materialData.price || 0;
      total += price * (item.quantity || 0);
    }

    basePrice[size] = total;
  }

  return basePrice;
};

// Handler untuk membuat buket
const createBuketHandler = async (request, h) => {
  try {
    const { name, type, category, requires_photo, materialsBySize, imageUrl } = request.payload;

    const base_price_by_size = await calculateBasePriceBySize(materialsBySize);

    const newBuket = {
      name,
      type,
      category,
      requires_photo,
      imageUrl,
      materialsBySize,
      base_price_by_size,
      createdAt: new Date().toISOString(),
    };

    const parsedMaterialsBySize = typeof materialsBySize === 'string'
  ? JSON.parse(materialsBySize)
  : materialsBySize;

    const docRef = await db.collection('buket').add(newBuket);

    return h.response({ status: 'success', id: docRef.id }).code(201);
  } catch (error) {
    console.error(error);
    return h.response({ status: 'fail', message: error.message }).code(500);
  }
};

// Ambil semua buket (tanpa bahan)
const getAllBuketHandler = async (request, h) => {
  try {
    const snapshot = await db.collection('buket').get();

    const bukets = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        buketId: data.buketId,
        name: data.name,
        size: data.size,
        category: data.category,
        image_url: data.image_url,
        is_customizable: data.is_customizable,
        processing_time: data.processing_time,
        requires_photo: data.requires_photo,
        type: data.type,
        base_price_by_size: data.base_price_by_size,
        created_at: data.created_at
      };
    });

    return h.response({
      status: 'success',
      data: bukets
    }).code(200);
  } catch (error) {
    console.error(error);
    return h.response({
      status: 'error',
      message: 'Gagal mengambil data buket'
    }).code(500);
  }
};

// Ambil detail buket + bahan & total harga bahan berdasarkan ukuran
const getBuketDetail = async (request, h) => {
  const { buketId } = request.params;
  const { size = 'small' } = request.query;

  try {
    const buketDoc = await db.collection('buket').doc(buketId).get();
    if (!buketDoc.exists) {
      return h.response({ status: 'fail', message: 'Buket tidak ditemukan.' }).code(404);
    }

    const buketData = buketDoc.data();
    const selectedMaterials = buketData.materialsBySize?.[size.toLowerCase()] || [];

    const materials = [];
    let totalPrice = 0;

    for (const item of selectedMaterials) {
      const materialDoc = await db.collection('materials').doc(item.materialId).get();
      if (!materialDoc.exists) continue;

      const materialData = materialDoc.data();
      const total = materialData.price * item.quantity;

      materials.push({
        materialId: item.materialId,
        name: materialData.name,
        price: materialData.price,
        quantity: item.quantity,
        total
      });

      totalPrice += total;
    }

    return h.response({
      buketId: buketData.buketId,
      name: buketData.name,
      image_url: buketData.image_url,
      size: size.toLowerCase(),
      category: buketData.category,
      price: buketData.base_price_by_size?.[size.toLowerCase()] || 0,
      processing_time: buketData.processing_time,
      is_customizable: buketData.is_customizable,
      requires_photo: buketData.requires_photo,
      type: buketData.type,
      created_at: buketData.created_at,
      materials,
      total_material_price: totalPrice
    }).code(200);
  } catch (error) {
    console.error(error);
    return h.response({ message: 'Terjadi kesalahan.' }).code(500);
  }
};

// Edit buket (Admin)
const updateBuketHandler = async (request, h) => {
  const { buketId } = request.params;
  const updateData = request.payload;

  try {
    await db.collection('buket').doc(buketId).update({
      ...updateData,
      updated_at: new Date().toISOString()
    });

    return h.response({
      status: 'success',
      message: 'Buket berhasil diperbarui'
    }).code(200);
  } catch (error) {
    console.error(error);
    return h.response({
      status: 'fail',
      message: 'Gagal memperbarui buket'
    }).code(500);
  }
};

// Hapus buket (Admin)
const deleteBuketHandler = async (request, h) => {
  const { buketId } = request.params;

  try {
    await db.collection('buket').doc(buketId).delete();

    return h.response({
      status: 'success',
      message: 'Buket berhasil dihapus'
    }).code(200);
  } catch (error) {
    console.error(error);
    return h.response({
      status: 'fail',
      message: 'Gagal menghapus buket'
    }).code(500);
  }
};

module.exports = {
  uploadImageHandler,
  createBuketHandler,
  getAllBuketHandler,
  getBuketDetail,
  updateBuketHandler,
  deleteBuketHandler
};
