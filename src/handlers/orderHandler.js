// handlers/orderHandler.js
const { db } = require('../services/firebaseService');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
// TOP: tambahkan import
const axios = require('axios');
const archiver = require('archiver');
const { PassThrough } = require('stream');

// helper kecil buat ambil semua URL foto dari carts dan (legacy) note
function extractPhotoUrlsFromText(note = '') {
  const urlRegex = /(https?:\/\/\S+)/gi;
  return (note.match(urlRegex) || []).filter((u) =>
    /\.(jpg|jpeg|png|webp|gif)$/i.test(u) ||
    u.toLowerCase().includes('res.cloudinary.com')
  );
}

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
});

const core = new midtransClient.CoreApi({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
});

// --- utils ---
const allowedStatuses = ['pending','processing','shipping','delivered','done','canceled'];

const normalizeStatus = (s='') => {
  const v = String(s).toLowerCase().trim();
  if (['process','processing','diproses'].includes(v)) return 'processing';
  if (['shipping','shipped','dikirim'].includes(v))   return 'shipping';
  if (['delivered','terkirim'].includes(v))           return 'delivered';
  if (['done','completed','selesai'].includes(v))     return 'done';
  if (['canceled','cancelled','batal'].includes(v))   return 'canceled';
  if (['pending','menunggu'].includes(v))             return 'pending';
  return 'pending';
};

const toIso = (tsOrDate) => {
  if (!tsOrDate) return new Date().toISOString();
  if (tsOrDate.toDate) return tsOrDate.toDate().toISOString();
  const d = new Date(tsOrDate);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

// ========== CREATE ORDER ==========
// ======== BUAT ORDER ========
const createOrderHandler = async (request, h) => {
  try {
    const {
      userId,
      carts,
      alamat,
      ongkir = 0,
      paymentMethod,
      deliveryMethod,
      customer, // <- abaikan dari client; kita override dari Firestore
    } = request.payload;

    if (!userId || !carts || carts.length === 0) {
      return h.response({ status: 'fail', message: 'Data order tidak lengkap' }).code(400);
    }

    const normalizedPaymentMethod = paymentMethod?.toLowerCase();
    const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Hitung itemDetails & grossAmount seperti sebelumnya...
    const itemDetails = carts.map(item => {
      const customMaterialTotal = item.customMaterials?.reduce((sum, m) =>
        sum + (m.price * m.quantity), 0
      ) || 0;

      return {
        id: item.buketId,
        price: (item.basePrice || 0) + customMaterialTotal,
        quantity: item.quantity || 1,
        name: item.name || "Item"
      };
    });

    if (ongkir) {
      itemDetails.push({ id: "ONGKIR", price: ongkir, quantity: 1, name: "Ongkos Kirim" });
    }

    const grossAmount = itemDetails.reduce((s, it) => s + (it.price * it.quantity), 0);

    // >>> Ambil profil user dari Firestore
    let customerFromFirestore = null;
    try {
      const userSnap = await db.collection('users').doc(userId).get();
      if (userSnap.exists) {
        const u = userSnap.data() || {};
        customerFromFirestore = {
          name:  u.name  || customer?.name  || "User",
          email: u.email || customer?.email || "user@example.com",
          phone: u.no_telp || customer?.phone || ""
        };
      }
    } catch (e) {
      console.warn("Gagal baca users/", userId, ":", e.message);
    }

    const orderData = {
      orderId,
      userId,
      carts,
      alamat,
      ongkir,
      totalPrice: grossAmount,
      paymentMethod: normalizedPaymentMethod,
      paymentChannel: normalizedPaymentMethod === 'midtrans' ? null : 'COD',
      deliveryMethod,
      status: 'pending',
      paymentStatus: normalizedPaymentMethod === 'midtrans' ? 'pending' : 'waiting_payment',
      createdAt: admin.firestore.Timestamp.now(),
      customer: customerFromFirestore || (customer ?? null), // <- ini kuncinya
    };

    // === Midtrans (seperti sebelumnya) ===
    let midtransToken = null;
    let midtransRedirectUrl = null;

    if (normalizedPaymentMethod === 'midtrans') {
      const midtransParams = {
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        customer_details: {
          first_name: orderData.customer?.name || "User",
          email: orderData.customer?.email || "user@example.com",
          phone: orderData.customer?.phone || "",
          shipping_address: { address: alamat },
        },
        item_details: itemDetails
      };

      const transaction = await snap.createTransaction(midtransParams);
      midtransToken = transaction.token;
      midtransRedirectUrl = transaction.redirect_url;

      if (!snap.apiConfig.isProduction) {
            try {
                await core.transaction.approve(orderId);
                console.log(`SANDBOX: Order ${orderId} auto-approve paid`);
                orderData.paymentStatus = 'paid';
                orderData.status = 'processing'; // <- konsisten dg filter di app
            } catch (err) {
                console.error("Gagal auto-approve sandbox:", err.message);
            }
            }

    }

    await db.collection('orders').doc(orderId).set({
      ...orderData,
      midtransToken,
      midtransRedirectUrl,
    });

    // Hapus carts (tetap seperti kode kamu sebelumnya) ...
    const batch = db.batch();
    for (const cartItem of carts) {
      if (!cartItem.cartId) continue;
      const docRef = db.collection('carts').doc(cartItem.cartId);
      const docSnap = await docRef.get();
      if (docSnap.exists) batch.delete(docRef);
    }
    await batch.commit();

    return h.response({
      status: 'success',
      message: 'Order berhasil dibuat',
      data: { orderId, midtransToken, midtransRedirectUrl }
    }).code(201);

  } catch (error) {
    console.error('Error createOrderHandler:', error);
    return h.response({ status: 'fail', message: error.message }).code(500);
  }
};


// ========== MIDTRANS NOTIFICATION ==========
const midtransNotificationHandler = async (request, h) => {
  try {
    const statusResponse = await core.transaction.notification(request.payload);

    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    // Channel
    let paymentChannel = '';
    if (statusResponse.payment_type === 'bank_transfer' && statusResponse.va_numbers?.length) {
      paymentChannel = statusResponse.va_numbers[0].bank?.toUpperCase() || 'BANK_TRANSFER';
    } else if (statusResponse.payment_type === 'qris') {
      paymentChannel = `QRIS ${statusResponse.acquirer?.toUpperCase() || ''}`.trim();
    } else if (statusResponse.payment_type) {
      paymentChannel = statusResponse.payment_type.toUpperCase();
    }

    // Map status
    let paymentStatus;
    if      (transactionStatus === 'capture')    paymentStatus = (fraudStatus === 'accept') ? 'paid' : 'challenge';
    else if (transactionStatus === 'settlement') paymentStatus = 'paid';
    else if (transactionStatus === 'pending')    paymentStatus = 'pending';
    else if (['deny','cancel','expire'].includes(transactionStatus)) paymentStatus = 'failed';

    const updateData = { paymentStatus, paymentMethod:'midtrans', paymentChannel };
    if (paymentStatus === 'paid') updateData.status = 'processing';

    await db.collection('orders').doc(orderId).update(updateData);
    return h.response({ message: 'Notification processed' }).code(200);
  } catch (err) {
    console.error('Error midtransNotificationHandler:', err);
    return h.response({ error: err.message }).code(500);
  }
};

// ========== ADMIN: GET SEMUA ORDER (optional filter & pagination) ==========
const getAllOrdersAdminHandler = async (request, h) => {
  try {
    const { status, paymentStatus, userId, limit = 25 } = request.query || {};
    let ref = db.collection('orders');

    if (userId)        ref = ref.where('userId', '==', userId);
    if (status)        ref = ref.where('status', '==', normalizeStatus(status));
    if (paymentStatus) ref = ref.where('paymentStatus', '==', String(paymentStatus).toLowerCase());

    const snap = await ref.get();

    // Bentuk array awal
    let rows = snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, ...x, createdAt: toIso(x.createdAt) };
    });

    // Sort newest-first & batasi
    rows = rows.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
               .slice(0, Number(limit));

    // Cari yang belum punya customer.name
    const missing = rows.filter(r => !r.customer || !r.customer.name).map(r => r.userId);
    const uniqueUserIds = Array.from(new Set(missing));

    if (uniqueUserIds.length > 0) {
      // Ambil profile user per id
      const userDocs = await Promise.all(
        uniqueUserIds.map(uid => db.collection('users').doc(uid).get())
      );
      const userMap = {};
      userDocs.forEach((doc, idx) => {
        const uid = uniqueUserIds[idx];
        if (doc.exists) {
          const u = doc.data() || {};
          userMap[uid] = {
            name:  u.name || 'User',
            email: u.email || 'user@example.com',
            phone: u.no_telp || ''
          };
        }
      });

      // Enrich rows (tanpa menulis balik ke DB; pure response)
      rows = rows.map(r => {
        if (!r.customer || !r.customer.name) {
          const cu = userMap[r.userId];
          if (cu) {
            return { ...r, customer: cu };
          }
        }
        return r;
      });
    }

    return h.response({ data: rows }).code(200);
  } catch (err) {
    console.error('Error getAllOrdersAdminHandler:', err);
    return h.response({ message: 'Gagal mengambil data order' }).code(500);
  }
};


// ========== USER: GET ORDER MILIKNYA ==========
const getOrdersByUserHandler = async (request, h) => {
  try {
    const { userId } = request.params;

    const snap = await db.collection('orders')
      .where('userId','==', userId)
      .get();

    const orders = snap.docs
      .map(doc => ({ ...doc.data(), createdAt: toIso(doc.data().createdAt) }))
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    return h.response(orders).code(200);
  } catch (error) {
    console.error('Error getOrdersByUserHandler:', error);
    return h.response({ message: 'Gagal mengambil data order' }).code(500);
  }
};

// ========== DETAIL ORDER ==========
const getOrderDetailHandler = async (request, h) => {
  try {
    const { orderId } = request.params;
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) return h.response({ message:'Order tidak ditemukan' }).code(404);
    const data = doc.data();

    let out = { ...data, createdAt: toIso(data.createdAt) };

    // Enrich kalau belum ada customer.name
    if (!out.customer || !out.customer.name) {
      try {
        const udoc = await db.collection('users').doc(out.userId).get();
        if (udoc.exists) {
          const u = udoc.data() || {};
          out = {
            ...out,
            customer: {
              name:  u.name  || 'User',
              email: u.email || 'user@example.com',
              phone: u.no_telp || ''
            }
          };
        }
      } catch (e) {
        console.warn('Gagal enrich customer di detail:', e.message);
      }
    }

    return h.response({ data: out }).code(200);
  } catch (error) {
    console.error('Error getOrderDetailHandler:', error);
    return h.response({ message:'Gagal mengambil detail order' }).code(500);
  }
};


// ========== UPDATE STATUS (path param) ==========
const updateOrderStatusByPathHandler = async (request, h) => {
  try {
    const { orderId } = request.params;
    const { status } = request.payload || {};
    const s = normalizeStatus(status);

    if (!allowedStatuses.includes(s)) {
      return h.response({ status:'fail', message:'Status tidak valid' }).code(400);
    }

    await db.collection('orders').doc(orderId).update({
      status: s,
      updatedAt: new Date().toISOString(),
    });

    return h.response({ status:'success', message:`Status order ${orderId} diperbarui menjadi ${s}` }).code(200);
  } catch (error) {
    console.error('Error updateOrderStatusByPathHandler:', error);
    return h.response({ status:'fail', message:error.message }).code(500);
  }
};

// ========== UPDATE STATUS (legacy body: {orderId, status}) ==========
const updateOrderStatusLegacyHandler = async (request, h) => {
  try {
    const { orderId, status } = request.payload || {};
    if (!orderId) return h.response({ status:'fail', message:'orderId wajib' }).code(400);
    const s = normalizeStatus(status);
    if (!allowedStatuses.includes(s)) {
      return h.response({ status:'fail', message:'Status tidak valid' }).code(400);
    }

    await db.collection('orders').doc(orderId).update({
      status: s,
      updatedAt: new Date().toISOString(),
    });

    return h.response({ status:'success', message:`Status order ${orderId} diperbarui menjadi ${s}` }).code(200);
  } catch (error) {
    console.error('Error updateOrderStatusLegacyHandler:', error);
    return h.response({ status:'fail', message:error.message }).code(500);
  }
};

// === DOWNLOAD ZIP SEMUA FOTO DI ORDER ===
const downloadOrderPhotosZip = async (request, h) => {
  const { orderId } = request.params;

  // ambil dokumen order
  const doc = await db.collection('orders').doc(orderId).get();
  if (!doc.exists) {
    return h.response({ message: 'Order tidak ditemukan' }).code(404);
  }

  const data = doc.data() || {};
  const carts = Array.isArray(data.carts) ? data.carts : [];

  // kumpulkan semua URL foto dari setiap cart item
  let urls = [];
  carts.forEach((c, idx) => {
    // sumber utama: field photoUrls
    if (Array.isArray(c.photoUrls)) urls.push(...c.photoUrls);
    // fallback legacy: link yang masih nempel di catatan
    if (typeof c.orderNote === 'string' && c.orderNote.includes('http')) {
      urls.push(...extractPhotoUrlsFromText(c.orderNote));
    }
  });

  // unik & bersih
  urls = Array.from(new Set(urls));
  if (!urls.length) {
    return h.response({ message: 'Tidak ada foto pada order ini.' }).code(404);
  }

  // siapkan stream ZIP
  const pass = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('ZIP error:', err);
    pass.emit('error', err);
  });
  archive.pipe(pass);

  // tambahkan file ke zip (stream dari url)
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const extMatch = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    const filename = `order_${orderId}_photo_${String(i + 1).padStart(2, '0')}.${ext}`;

    try {
      const resp = await axios.get(url, { responseType: 'stream' });
      archive.append(resp.data, { name: filename });
    } catch (e) {
      console.warn('Lewati url gagal diunduh:', url, e.message);
    }
  }

  archive.finalize(); // mulai proses zip

  // stream response zip
  return h
    .response(pass)
    .type('application/zip')
    .header(
      'Content-Disposition',
      `attachment; filename="order_${orderId}_photos.zip"`
    );
};

module.exports = {
  createOrderHandler,
  midtransNotificationHandler,
  getAllOrdersAdminHandler,
  getOrdersByUserHandler,
  getOrderDetailHandler,
  updateOrderStatusByPathHandler,
  updateOrderStatusLegacyHandler,
  downloadOrderPhotosZip, // ⬅️ export baru
};
