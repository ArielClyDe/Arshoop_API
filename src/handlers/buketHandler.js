const { nanoid } = require('nanoid');
const { db } = require('../services/firebaseService');
const cloudinary = require('../services/cloudinaryService');
const streamifier = require('streamifier');

// Fungsi bantu untuk hitung harga
const calculateBasePriceBySize = async (materialsBySize, service_fee = 0) => {
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

    basePrice[size] = total + parseInt(service_fee); // Tambahkan service_fee ke total
  }

  return basePrice;
};

// Handler createBuket tanpa simpan ke lokal
const createBuketHandler = async (request, h) => {
  const {
    name,
    description,
    type,
    category,
    requires_photo,
    is_customizable,
    processing_time,
    service_fee = 0 // default 0 jika tidak dikirim
  } = request.payload;

  const image = request.payload.image;
  const materialsBySizeRaw = request.payload.materialsBySize;

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

  // Upload ke Cloudinary
  let imageUrl;
  try {
    const uploadStream = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'buket',
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

  try {
    let parsedMaterials;
    try {
      parsedMaterials = JSON.parse(materialsBySizeRaw);
    } catch (parseErr) {
      return h.response({
        status: 'fail',
        message: 'Format materialsBySize tidak valid JSON',
        error: parseErr.message,
      }).code(400);
    }

    const numericServiceFee = parseInt(service_fee) || 0;

    const base_price_by_size = await calculateBasePriceBySize(parsedMaterials, numericServiceFee);
    const buketId = nanoid(16);

    const newBuket = {
      buketId,
      name,
      ...(description !== undefined && { description }),
      type,
      category,
      requires_photo: requires_photo === 'true' || requires_photo === true,
      is_customizable: is_customizable === 'true' || is_customizable === true,
      processing_time: parseInt(processing_time),
      service_fee: numericServiceFee,
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
        service_fee: buketData.service_fee || 0,
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
  createBuketHandler,
  getAllBuketHandler,
  getBuketDetail,
  updateBuketHandler,
  deleteBuketHandler
};
