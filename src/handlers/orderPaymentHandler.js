// functions/createOrder.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const midtransClient = require("midtrans-client");

admin.initializeApp();

// Midtrans client
const snap = new midtransClient.Snap({
    isProduction: false, // Sandbox mode
    serverKey: process.env.MIDTRANS_SERVER_KEY
});

exports.createOrder = functions.https.onRequest(async (req, res) => {
    try {
        const {
            userId,
            carts,
            alamat,
            ongkir,
            paymentMethod, // "cod" atau "midtrans"
            totalPrice,
            deliveryMethod // kurir atau ambil sendiri
        } = req.body;

        if (!userId || !carts || carts.length === 0) {
            return res.status(400).json({ error: "Data pesanan tidak lengkap" });
        }

        // Simpan order awal ke Firestore
        const orderRef = await admin.firestore().collection("orders").add({
            userId,
            carts,
            alamat,
            ongkir,
            paymentMethod,
            totalPrice,
            deliveryMethod,
            status: paymentMethod === "cod" ? "waiting_confirmation" : "pending",
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        let paymentData = null;

        if (paymentMethod === "midtrans") {
            // Buat transaksi Midtrans Snap
            const parameter = {
                transaction_details: {
                    order_id: orderRef.id,
                    gross_amount: totalPrice
                },
                customer_details: {
                    user_id: userId,
                    address: alamat
                }
            };

            const transaction = await snap.createTransaction(parameter);
            paymentData = {
                snapToken: transaction.token,
                snapRedirectUrl: transaction.redirect_url
            };
        } else {
            // COD — tidak perlu Snap Token
            paymentData = {
                note: "Bayar di tempat saat pesanan tiba"
            };
        }

        return res.status(200).json({
            message: "Order berhasil dibuat",
            orderId: orderRef.id,
            paymentMethod,
            paymentData
        });

    } catch (error) {
        console.error("Error createOrder:", error);
        res.status(500).json({ error: error.message });
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
