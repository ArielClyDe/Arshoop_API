// src/handlers/orderPaymentHandler.js
const midtransClient = require('midtrans-client');
const Order = require('../models/Order'); // contoh, sesuaikan dengan model kamu
const Cart = require('../models/Cart');

// Buat instance Snap Midtrans (bisa dipakai ulang)
const snap = new midtransClient.Snap({
  isProduction: false, // true kalau sudah live
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

const createOrderHandler = async (request, h) => {
  try {
    const {
      userId,
      carts,
      deliveryMethod,
      alamat,
      ongkir,
      paymentMethod,
      totalPrice
    } = request.payload;

    // Simpan order ke database
    const newOrder = await Order.create({
      userId,
      carts,
      deliveryMethod,
      alamat,
      ongkir,
      paymentMethod,
      totalPrice,
      status: 'pending'
    });

    // Kalau metode pembayaran bukan COD, buat transaksi Midtrans
    let snapToken = null;
    if (paymentMethod !== 'cod') {
      const transaction = await snap.createTransaction({
        transaction_details: {
          order_id: `order-${Date.now()}`,
          gross_amount: totalPrice
        },
        credit_card: { secure: true }
      });

      snapToken = transaction.token;
    }

    return h.response({
      message: 'Order berhasil dibuat',
      order: newOrder,
      snapToken
    }).code(201);

  } catch (err) {
    console.error('Midtrans API Error:', err);
    return h.response({
      message: 'Gagal membuat order',
      error: err.message
    }).code(500);
  }
};

const getAllOrdersHandler = async (request, h) => {
  try {
    const { userId } = request.params;
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });

    return h.response(orders).code(200);
  } catch (err) {
    return h.response({ message: 'Gagal mengambil order' }).code(500);
  }
};

const getOrderDetailHandler = async (request, h) => {
  try {
    const { orderId } = request.params;
    const order = await Order.findById(orderId);
    if (!order) {
      return h.response({ message: 'Order tidak ditemukan' }).code(404);
    }
    return h.response(order).code(200);
  } catch (err) {
    return h.response({ message: 'Gagal mengambil detail order' }).code(500);
  }
};

const updateOrderStatusHandler = async (request, h) => {
  try {
    const { orderId } = request.params;
    const { status } = request.payload;

    const updated = await Order.findByIdAndUpdate(orderId, { status }, { new: true });
    if (!updated) {
      return h.response({ message: 'Order tidak ditemukan' }).code(404);
    }

    return h.response(updated).code(200);
  } catch (err) {
    return h.response({ message: 'Gagal update status order' }).code(500);
  }
};

const chargePaymentHandler = async (request, h) => {
  try {
    const { orderId, paymentType, bank } = request.payload;
    const order = await Order.findById(orderId);
    if (!order) {
      return h.response({ message: 'Order tidak ditemukan' }).code(404);
    }

    const parameter = {
      payment_type: paymentType,
      transaction_details: {
        order_id: orderId,
        gross_amount: order.totalPrice
      }
    };

    if (paymentType === 'bank_transfer') {
      parameter.bank_transfer = { bank };
    }

    const chargeResponse = await snap.createTransaction(parameter);

    return h.response(chargeResponse).code(200);
  } catch (err) {
    return h.response({ message: 'Gagal memproses pembayaran', error: err.message }).code(500);
  }
};

const handleMidtransNotification = async (request, h) => {
  try {
    const notification = request.payload;
    console.log('Notifikasi Midtrans diterima:', notification);

    // TODO: update status order di database sesuai notifikasi Midtrans

    return h.response({ message: 'Notifikasi diproses' }).code(200);
  } catch (err) {
    return h.response({ message: 'Gagal memproses notifikasi' }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  getAllOrdersHandler,
  getOrderDetailHandler,
  updateOrderStatusHandler,
  chargePaymentHandler,
  handleMidtransNotification
};
