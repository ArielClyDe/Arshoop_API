
// functions/orders.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const midtransClient = require("midtrans-client");

admin.initializeApp();
const db = admin.firestore();

// Konfigurasi Midtrans
const snap = new midtransClient.Snap({
    isProduction: false, // true jika sudah live
    serverKey: "MIDTRANS_SERVER_KEY",
});

exports.createOrder = functions.https.onCall(async (data, context) => {
    try {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                "unauthenticated",
                "User belum login"
            );
        }

        const {
            userId,
            carts,
            alamat,
            ongkir,
            paymentMethod,
            totalPrice,
            deliveryMethod,
        } = data;

        if (!carts || carts.length === 0) {
            throw new functions.https.HttpsError(
                "invalid-argument",
                "Keranjang kosong"
            );
        }

        // Buat ID order unik
        const orderId = `ORDER-${Date.now()}`;

        // Data order
        const orderData = {
            orderId,
            userId,
            carts,
            alamat,
            ongkir,
            totalPrice,
            paymentMethod,
            deliveryMethod,
            status: paymentMethod === "midtrans" ? "pending" : "waiting_payment",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        let midtransToken = null;
        let midtransRedirectUrl = null;

        if (paymentMethod === "midtrans") {
            // Request ke Midtrans
            const midtransParams = {
                transaction_details: {
                    order_id: orderId,
                    gross_amount: totalPrice,
                },
                customer_details: {
                    first_name: "User",
                    email: "user@example.com", // bisa ambil dari profile Firebase
                    phone: "08123456789",
                    shipping_address: {
                        address: alamat,
                    },
                },
                item_details: carts.map(item => ({
                    id: item.buketId,
                    price: item.basePrice,
                    quantity: item.quantity,
                    name: item.name,
                })),
            };

            const transaction = await snap.createTransaction(midtransParams);
            midtransToken = transaction.token;
            midtransRedirectUrl = transaction.redirect_url;
        }

        // Simpan ke Firestore
        await db.collection("orders").doc(orderId).set({
            ...orderData,
            midtransToken,
            midtransRedirectUrl,
        });

        return {
            success: true,
            message: "Order berhasil dibuat",
            orderId,
            midtransToken,
            midtransRedirectUrl,
        };
    } catch (error) {
        console.error("Error createOrder:", error);
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// GET ALL ORDERS
const getAllOrdersHandler = async (request, h) => {
  try {
    const snapshot = await db.collection('orders').get();
    if (snapshot.empty) {
      return h.response({ status: 'success', data: [], message: 'Tidak ada order' }).code(200);
    }

    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        orderId: doc.id,
        ...data,
        createdAt: data.createdAt ? new Date(data.createdAt).toLocaleString('id-ID') : null,
        updatedAt: data.updatedAt ? new Date(data.updatedAt).toLocaleString('id-ID') : null,
        totalItems: Array.isArray(data.carts)
          ? data.carts.reduce((sum, item) => sum + (item.quantity || 0), 0)
          : 0
      };
    });

    return h.response({ status: 'success', data: orders }).code(200);
  } catch (error) {
    console.error('Error fetching all orders:', error);
    return h.response({ status: 'error', message: 'Gagal mengambil semua order' }).code(500);
  }
};

// GET ORDER DETAIL
const getOrderDetailHandler = async (request, h) => {
  const { orderId } = request.params;
  try {
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    const orderData = doc.data();
    return h.response({
      status: 'success',
      data: {
        orderId,
        ...orderData,
        createdAt: new Date(orderData.createdAt).toLocaleString('id-ID'),
        updatedAt: orderData.updatedAt ? 
          new Date(orderData.updatedAt).toLocaleString('id-ID') : null,
        totalItems: orderData.carts.reduce((sum, item) => sum + item.quantity, 0),
      }
    }).code(200);
  } catch (error) {
    console.error('Error fetching order details:', error);
    return h.response({ status: 'error', message: 'Gagal mengambil detail order' }).code(500);
  }
};

// UPDATE ORDER STATUS
const updateOrderStatusHandler = async (request, h) => {
  const { orderId } = request.params;
  const { status } = request.payload;
  try {
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return h.response({ status: 'fail', message: 'Status tidak valid', validStatuses }).code(400);
    }

    await db.collection('orders').doc(orderId).update({ 
      status,
      updatedAt: new Date().toISOString() 
    });

    return h.response({ status: 'success', message: 'Status berhasil diperbarui' }).code(200);
  } catch (error) {
    console.error('Failed to update order status:', error);
    return h.response({ status: 'error', message: 'Gagal memperbarui status' }).code(500);
  }
};

// CHARGE PAYMENT
const chargePaymentHandler = async (request, h) => {
  const { orderId, paymentType, bank } = request.payload;
  try {
    const validPaymentTypes = ['bank_transfer', 'qris', 'gopay'];
    if (!validPaymentTypes.includes(paymentType)) {
      return h.response({ status: 'fail', message: 'Jenis pembayaran tidak valid', validPaymentTypes }).code(400);
    }

    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    const orderData = doc.data();
    const parameter = {
      transaction_details: { order_id: orderId, gross_amount: orderData.totalPrice },
      customer_details: {
        first_name: `Customer-${orderData.userId.substring(0, 8)}`,
        email: `${orderData.userId.substring(0, 8)}@customer.com`,
      },
      payment_type: paymentType,
    };

    if (paymentType === 'bank_transfer') {
      parameter.bank_transfer = { bank: bank || 'bca' };
    }

    const transaction = await snap.createTransaction(parameter);

    await db.collection('orders').doc(orderId).update({
      paymentMethod: paymentType,
      midtrans_status: 'pending',
      paymentData: {
        transactionId: transaction.transaction_id,
        paymentUrl: transaction.redirect_url,
        status: 'pending',
      },
      updatedAt: new Date().toISOString(),
    });

    return h.response({
      status: 'success',
      message: 'Pembayaran berhasil diproses',
      data: {
        paymentUrl: transaction.redirect_url,
        transactionId: transaction.transaction_id,
        paymentType,
      },
    }).code(200);
  } catch (error) {
    console.error('Payment processing failed:', error);
    await db.collection('orders').doc(orderId).update({
      midtrans_status: 'error',
      paymentError: error.ApiResponse?.error_messages || error.message,
      updatedAt: new Date().toISOString(),
    });
    return h.response({ status: 'error', message: 'Gagal memproses pembayaran' }).code(500);
  }
};

// MIDTRANS NOTIFICATION
const handleMidtransNotification = async (request, h) => {
  const notification = request.payload;
  try {
    const { order_id, transaction_status, fraud_status } = notification;
    const orderRef = db.collection('orders').doc(order_id);
    const doc = await orderRef.get();
    if (!doc.exists) {
      return h.response({ message: 'Order tidak ditemukan' }).code(404);
    }

    const statusMap = {
      'capture': 'dibayar',
      'settlement': 'dibayar',
      'pending': 'menunggu pembayaran',
      'deny': 'ditolak',
      'expire': 'expired',
      'cancel': 'dibatalkan'
    };

    const newStatus = statusMap[transaction_status] || transaction_status;
    const updateData = {
      status: newStatus,
      midtrans_status: transaction_status,
      fraud_status,
      updatedAt: new Date().toISOString(),
    };

    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      updateData.payment_time = notification.settlement_time || new Date().toISOString();
      updateData.paymentData = {
        ...(doc.data().paymentData || {}),
        status: 'completed',
        settlementTime: updateData.payment_time
      };
    }

    await orderRef.update(updateData);
    return h.response({ message: 'Notifikasi berhasil diproses' }).code(200);
  } catch (error) {
    console.error('Notification handling failed:', error);
    return h.response({ error: 'Terjadi kesalahan saat memproses notifikasi' }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  getAllOrdersHandler,
  getOrderDetailHandler,
  updateOrderStatusHandler,
  chargePaymentHandler,
  handleMidtransNotification,
};
