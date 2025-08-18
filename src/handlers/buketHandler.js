'use strict';

const { nanoid } = require('nanoid');
const { db } = require('../services/firebaseService');
const cloudinary = require('../services/cloudinaryService');
const streamifier = require('streamifier');
const { FieldValue } = require('firebase-admin/firestore');

// ===== util log singkat =====
const log  = (...args) => console.log('[BUKET]', ...args);
const logR = (...args) => console.log('[REVIEWS]', ...args);

// ===== Helper: hitung base price per size dari daftar material =====
const calculateBasePriceBySize = async (materialsBySize) => {
  const basePrice = {};
  for (const size in materialsBySize) {
    const list = materialsBySize[size] || [];
    let total = 0;
    for (const item of list) {
      const snap = await db.collection('materials').doc(item.materialId).get();
      if (!snap.exists) throw new Error(`Material ${item.materialId} tidak ditemukan`);
      const price = snap.data().price || 0;
      total += price * (item.quantity || 0);
    }
    basePrice[size] = total;
  }
  return basePrice;
};

/* =========================
   ====== BUKET CRUD =======
   ========================= */
const createBuketHandler = async (request, h) => {
  const {
    name, description, type, category, is_customizable, processing_time, service_price
  } = request.payload;

  const image = request.payload.image;
  const materialsBySizeRaw = request.payload.materialsBySize;

  // Baca stream file → Buffer
  let buffer;
  try {
    buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (c) => chunks.push(c));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal membaca gambar', error: err.message }).code(400);
  }

  // Upload ke Cloudinary
  let imageUrl;
  try {
    const uploadStream = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'buket', resource_type: 'image' },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });
    const result = await uploadStream();
    imageUrl = result.secure_url;
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal upload gambar', error: err.message }).code(500);
  }

  try {
    let parsedMaterials;
    try {
      parsedMaterials = JSON.parse(materialsBySizeRaw);
    } catch (e) {
      return h.response({ status: 'fail', message: 'materialsBySize bukan JSON valid', error: e.message }).code(400);
    }

    const base_price_by_size = await calculateBasePriceBySize(parsedMaterials);
    const total_price_by_size = {};
    for (const k in base_price_by_size) {
      total_price_by_size[k] = base_price_by_size[k] + parseInt(service_price || 0, 10);
    }

    const buketId = nanoid(16);
    const doc = {
      buketId,
      name,
      ...(description !== undefined && { description }),
      type,
      category,
      is_customizable: is_customizable === true || is_customizable === 'true',
      processing_time: parseInt(processing_time, 10),
      service_price: parseInt(service_price, 10),
      image_url: imageUrl,
      materialsBySize: parsedMaterials,
      base_price_by_size,
      total_price_by_size,
      rating: { average: 0, count: 0 },
      created_at: new Date().toISOString(),
    };

    await db.collection('buket').doc(buketId).set(doc);
    log('create', buketId, name);

    return h.response({ status: 'success', message: 'Buket berhasil dibuat', data: doc }).code(201);
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal menyimpan buket', error: err.message }).code(500);
  }
};

const getAllBuketHandler = async (_req, h) => {
  try {
    const snap = await db.collection('buket').get();
    const list = snap.docs.map((d) => {
      const x = d.data();
      return {
        buketId: x.buketId,
        name: x.name,
        category: x.category,
        image_url: x.image_url,
        is_customizable: x.is_customizable,
        processing_time: x.processing_time,
        type: x.type,
        service_price: x.service_price,
        base_price_by_size: x.base_price_by_size,
        total_price_by_size: x.total_price_by_size,
        rating: x.rating || { average: 0, count: 0 },
        created_at: x.created_at,
      };
    });
    return h.response({ status: 'success', data: list }).code(200);
  } catch (err) {
    return h.response({ status: 'error', message: 'Gagal mengambil data buket' }).code(500);
  }
};

const getBuketDetail = async (request, h) => {
  const { buketId } = request.params;
  const { size = 'small' } = request.query;

  try {
    const doc = await db.collection('buket').doc(buketId).get();
    if (!doc.exists) return h.response({ status: 'fail', message: 'Buket tidak ditemukan.' }).code(404);

    const data = doc.data();
    const selectedSize = (size || 'small').toLowerCase();
    const selectedMaterials = data.materialsBySize?.[selectedSize] || [];

    let baseTotal = 0;
    for (const item of selectedMaterials) {
      const m = await db.collection('materials').doc(item.materialId).get();
      if (!m.exists) continue;
      baseTotal += (m.data().price || 0) * (item.quantity || 0);
    }
    const totalPrice = baseTotal + (data.service_price || 0);

    return h.response({
      status: 'success',
      data: {
        buketId: doc.id,
        name: data.name,
        image_url: data.image_url,
        size: selectedSize,
        category: data.category,
        price: totalPrice,
        base_price: baseTotal,
        service_price: data.service_price,
        processing_time: data.processing_time,
        is_customizable: data.is_customizable,
        type: data.type,
        created_at: data.created_at,
        rating: data.rating || { average: 0, count: 0 },
        base_price_by_size: data.base_price_by_size,
        total_price_by_size: data.total_price_by_size,
        materialsBySize: data.materialsBySize,
      },
    }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({ message: 'Terjadi kesalahan.' }).code(500);
  }
};

const updateBuketHandler = async (request, h) => {
  const { buketId } = request.params;
  const updateData = request.payload || {};
  try {
    await db.collection('buket').doc(buketId).update({
      ...updateData,
      updated_at: new Date().toISOString(),
    });
    log('update', buketId);
    return h.response({ status: 'success', message: 'Buket berhasil diperbarui' }).code(200);
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal memperbarui buket' }).code(500);
  }
};

const updateBuketImageHandler = async (request, h) => {
  const { buketId } = request.params;
  const image = request.payload.image;

  try {
    const buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (c) => chunks.push(c));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });

    const uploadStream = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'buket', resource_type: 'image' },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });

    const result = await uploadStream();

    await db.collection('buket').doc(buketId).update({
      image_url: result.secure_url,
      updated_at: new Date().toISOString(),
    });
    log('update-image', buketId);

    return h.response({
      status: 'success',
      message: 'Gambar diperbarui',
      image_url: result.secure_url,
    }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({ status: 'fail', message: 'Gagal memperbarui gambar', error: err.message }).code(500);
  }
};

const deleteBuketHandler = async (request, h) => {
  const { buketId } = request.params;
  try {
    await db.collection('buket').doc(buketId).delete();
    log('delete', buketId);
    return h.response({ status: 'success', message: 'Buket berhasil dihapus' }).code(200);
  } catch (err) {
    return h.response({ status: 'fail', message: 'Gagal menghapus buket' }).code(500);
  }
};

/* =========================
   ========= REVIEWS =======
   Collection: buket_reviews
   Dok: reviewId, buketId, userId, reviewer_name, rating, comment, created_at
   Ringkasan di dok buket.rating = { average, count }
   ========================= */
async function recalcRatingSummary(buketId) {
  const snap = await db.collection('buket_reviews').where('buketId', '==', buketId).get();
  let sum = 0, count = 0;
  snap.forEach((d) => {
    const r = d.data() || {};
    const v = parseInt(r.rating || 0, 10);
    if (!Number.isNaN(v)) { sum += v; count += 1; }
  });
  const average = count ? Math.round((sum / count) * 10) / 10 : 0;
  return { average, count };
}

const createReviewHandler = async (request, h) => {
  const { buketId } = request.params;
  const { user_id, reviewer_name, rating, comment } = request.payload || {};
  logR('POST /buket/%s/reviews user=%s rating=%s', buketId, user_id, rating);

  if (!buketId) return h.response({ status: 'fail', message: 'buketId wajib diisi.' }).code(400);
  if (!user_id) return h.response({ status: 'fail', message: 'user_id wajib diisi.' }).code(400);
  const rate = parseInt(rating, 10);
  if (!(rate >= 1 && rate <= 5)) {
    return h.response({ status: 'fail', message: 'rating harus 1..5' }).code(400);
  }

  try {
    // 1) Buket ada?
    const buketRef = db.collection('buket').doc(buketId);
    const buketDoc = await buketRef.get();
    if (!buketDoc.exists) {
      logR('NOT FOUND buket=%s', buketId);
      return h.response({ status: 'fail', message: 'Buket tidak ditemukan.' }).code(404);
    }

    // 2) Anti-duplikat TANPA index: ambil semua review buket ini → filter user di memory
    const dupSnap = await db.collection('buket_reviews')
      .where('buketId', '==', buketId)
      .get();
    const already = dupSnap.docs.some(d => {
      const u = d.data().userId || d.data().user_id;
      return u === user_id;
    });
    if (already) {
      logR('DUPLICATE user=%s buket=%s', user_id, buketId);
      return h.response({ status: 'fail', message: 'Anda sudah memberikan review untuk buket ini.' }).code(409);
    }

    // 3) Validasi user pernah order buket ini & status selesai (opsional, boleh hapus jika belum perlu)
    const doneStatuses = ['delivered', 'done', 'completed'];
    const ordersSnap = await db.collection('orders')
      .where('userId', '==', user_id)
      .where('status', 'in', doneStatuses)
      .get();

    let hasCompleted = false;
    ordersSnap.forEach(doc => {
      const d = doc.data() || {};
      const carts = Array.isArray(d.carts) ? d.carts : [];
      if (carts.some(it => it && it.buketId === buketId)) hasCompleted = true;
    });
    if (!hasCompleted) {
      logR('FORBIDDEN no-completed-order user=%s buket=%s', user_id, buketId);
      return h.response({ status: 'fail', message: 'Review hanya setelah pesanan selesai.' }).code(403);
    }

    // 4) Simpan review (pakai serverTimestamp agar konsisten)
    const reviewId = nanoid(16);
    const reviewData = {
      reviewId,
      buketId,
      userId: user_id,
      reviewer_name: reviewer_name || 'User',
      rating: rate,
      comment: comment || null,
      created_at: FieldValue.serverTimestamp(),
    };
    await db.collection('buket_reviews').doc(reviewId).set(reviewData);
    logR('insert reviewId=%s', reviewId);

    // 5) Recalc summary dan simpan di dok buket
    const { average, count } = await recalcRatingSummary(buketId);
    await buketRef.update({
      rating: { average, count },
      updated_at: new Date().toISOString(),
    });
    logR('summary updated avg=%s count=%s', average, count);

    // Balikkan created_at sebagai ISO (optional normalisasi)
    const nowIso = new Date().toISOString();
    return h.response({
      status: 'success',
      message: 'Review berhasil disimpan',
      data: { ...reviewData, created_at: nowIso },
    }).code(201);
  } catch (err) {
    console.error('[REVIEWS] create error:', err);
    return h.response({ status: 'fail', message: 'Gagal menyimpan review', error: err.message }).code(500);
  }
};

// ======= GET reviews TANPA INDEX: where(buketId) lalu sort di memory =======
const listBuketReviewsNoIndex = async (request, h) => {
  const { buketId } = request.params;
  const limit = parseInt(request.query.limit, 10) || 100;

  logR('GET (no-index) /buket/%s/reviews?limit=%s', buketId, limit);

  try {
    // cek buket exist supaya bisa return 404 yang jelas
    const buketDoc = await db.collection('buket').doc(buketId).get();
    if (!buketDoc.exists) {
      return h.response({ status: 'fail', message: 'Buket tidak ditemukan.' }).code(404);
    }

    const snap = await db
      .collection('buket_reviews')
      .where('buketId', '==', buketId)
      .get();

    let reviews = snap.docs.map((d) => {
      const x = d.data();
      // Normalisasi timestamp → ISO string
      let createdAtIso = new Date(0).toISOString();
      const ca = x.created_at;
      if (ca?.toDate) createdAtIso = ca.toDate().toISOString();
      else if (ca?.toMillis) createdAtIso = new Date(ca.toMillis()).toISOString();
      else if (typeof ca === 'string') {
        const t = new Date(ca);
        createdAtIso = isNaN(t) ? new Date(0).toISOString() : t.toISOString();
      }
      return {
        reviewId: x.reviewId || d.id,
        buketId: x.buketId,
        userId: x.userId || x.user_id || null,
        reviewer_name: x.reviewer_name || x.reviewerName || null,
        rating: x.rating || 0,
        comment: x.comment || null,
        created_at: createdAtIso,
      };
    });

    // Sort desc by created_at (di memory), lalu batasi limit
    reviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (reviews.length > limit) reviews = reviews.slice(0, limit);

    // Summary (avg & count)
    const count = reviews.length;
    const sum = reviews.reduce((s, r) => s + (r.rating || 0), 0);
    const average = count ? Math.round((sum / count) * 10) / 10 : 0;

    return h.response({
      status: 'success',
      data: { summary: { average, count }, reviews },
    }).code(200);
  } catch (err) {
    console.error('[REVIEWS] list error (no-index):', err);
    return h.response({ status: 'fail', message: 'Gagal mengambil review' }).code(500);
  }
};

module.exports = {
  // buket
  createBuketHandler,
  getAllBuketHandler,
  getBuketDetail,
  updateBuketHandler,
  deleteBuketHandler,
  updateBuketImageHandler,

  // reviews
  createReviewHandler,
  listBuketReviewsNoIndex,
};
