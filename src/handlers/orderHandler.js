const { db } = require('../services/firebaseService');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');

// Midtrans Snap Client
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: process.env.MIDTRANS_SERVER_KEY || "",
});

const core = new midtransClient.CoreApi({
    isProduction: false,
    serverKey: process.env.MIDTRANS_SERVER_KEY || "",
    clientKey: process.env.MIDTRANS_CLIENT_KEY || "",
});

// ======== BUAT ORDER ========
const createOrderHandler = async (request, h) => {
    try {
        const {
            userId,
            carts,
            alamat,
            ongkir = 0,
            paymentMethod,
            totalPrice,
            deliveryMethod,
            customer
        } = request.payload;

        if (!userId || !carts || carts.length === 0) {
            return h.response({ status: 'fail', message: 'Data order tidak lengkap' }).code(400);
        }

        const normalizedPaymentMethod = paymentMethod?.toLowerCase();
        const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const itemDetails = carts.map(item => {
            const customMaterialTotal = item.customMaterials?.reduce((sum, m) =>
                sum + (m.price * m.quantity), 0
            ) || 0;

            return {
                id: item.buketId,
                price: item.basePrice + customMaterialTotal,
                quantity: item.quantity,
                name: item.name
            };
        });

        if (ongkir) {
            itemDetails.push({
                id: "ONGKIR",
                price: ongkir,
                quantity: 1,
                name: "Ongkos Kirim"
            });
        }

        const grossAmount = itemDetails.reduce((sum, item) =>
            sum + (item.price * item.quantity), 0
        );

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
        };

        let midtransToken = null;
        let midtransRedirectUrl = null;

        if (normalizedPaymentMethod === 'midtrans') {
            const midtransParams = {
                transaction_details: {
                    order_id: orderId,
                    gross_amount: grossAmount,
                },
                customer_details: {
                    first_name: customer?.name || "User",
                    email: customer?.email || "user@example.com",
                    phone: customer?.phone || "",
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
                    console.log(`SANDBOX: Order ${orderId} langsung di-approve sebagai paid`);
                    orderData.paymentStatus = 'paid';
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

        // Hapus semua cart item yang diorder dengan batch + logging path & cek keberadaan
           // langsung hapus dari koleksi global carts
            const batch = db.batch();

            for (const cartItem of carts) {
                if (!cartItem.cartId) {
                    console.warn(`❌ Cart item "${cartItem.name}" tidak punya cartId`);
                    continue;
                }

                const docRef = db.collection('carts').doc(cartItem.cartId);
                const docSnap = await docRef.get();

                if (!docSnap.exists) {
                    console.warn(`⚠ Tidak ada dokumen carts/${cartItem.cartId}`);
                    continue;
                }

                console.log(`🗑 Menghapus dokumen: carts/${cartItem.cartId}`);
                batch.delete(docRef);
            }

            await batch.commit();
            console.log(`✅ Proses penghapusan cart selesai untuk userId: ${userId}`);




        return h.response({
            status: 'success',
            message: 'Order berhasil dibuat dan cart dihapus',
            data: { orderId, midtransToken, midtransRedirectUrl }
        }).code(201);

    } catch (error) {
        console.error('Error createOrderHandler:', error);
        return h.response({ status: 'fail', message: error.message }).code(500);
    }
};





// ======== NOTIFIKASI MIDTRANS ========
// midtransNotificationHandler.js
const midtransNotificationHandler = async (request, h) => {
  try {
    console.log("==== Midtrans Notification Diterima ====");
    console.log("Headers:", request.headers);
    console.log("Body:", JSON.stringify(request.payload, null, 2));

    const notificationJson = request.payload;

    const core = new midtransClient.CoreApi({
      isProduction: false,
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY
    });

    const statusResponse = await core.transaction.notification(notificationJson);

    console.log("==== Status Response dari Midtrans ====");
    console.log(JSON.stringify(statusResponse, null, 2));

    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    // Tentukan channel pembayaran
    let paymentChannel = "";
    if (statusResponse.payment_type === "bank_transfer" && statusResponse.va_numbers?.length) {
      paymentChannel = statusResponse.va_numbers[0].bank.toUpperCase();
    } else if (statusResponse.payment_type === "qris") {
      paymentChannel = `QRIS ${statusResponse.acquirer?.toUpperCase() || ""}`.trim();
    } else if (statusResponse.payment_type) {
      paymentChannel = statusResponse.payment_type.toUpperCase();
    }

    console.log(`Payment Channel: ${paymentChannel}`);

    // Map status pembayaran
    let paymentStatus;
    if (transactionStatus === 'capture') {
      paymentStatus = (fraudStatus === 'accept') ? 'paid' : 'challenge';
    } else if (transactionStatus === 'settlement') {
      paymentStatus = 'paid';
    } else if (transactionStatus === 'pending') {
      paymentStatus = 'pending';
    } else if (['deny', 'cancel', 'expire'].includes(transactionStatus)) {
      paymentStatus = 'failed';
    }

    console.log(`Mapped Payment Status: ${paymentStatus}`);

    if (paymentStatus) {
      const updateData = { 
        paymentStatus,
        paymentMethod: "midtrans",
        paymentChannel
      };

      if (paymentStatus === 'paid') {
        updateData.status = 'process';
      }

      await admin.firestore()
        .collection('orders')
        .doc(orderId)
        .update(updateData);

      console.log(`Order ${orderId} diupdate menjadi:`, updateData);
    }

    return h.response({ message: 'Notification processed' }).code(200);

  } catch (err) {
    console.error("Error di midtransNotificationHandler:", err);
    return h.response({ error: err.message }).code(500);
  }
};





// ======== ADMIN UPDATE STATUS PESANAN ========
const updateOrderStatusHandler = async (request, h) => {
    try {
        const { orderId, status } = request.payload;

        const allowedStatuses = ["pending", "processing", "done", "shipping", "delivered"];
        if (!allowedStatuses.includes(status)) {
            return h.response({ status: "fail", message: "Status tidak valid" }).code(400);
        }

        await db.collection('orders').doc(orderId).update({
            status,
            updatedAt: new Date().toISOString()
        });

        return h.response({
            status: "success",
            message: `Status order ${orderId} diperbarui menjadi ${status}`
        }).code(200);
    } catch (error) {
        console.error("Error updateOrderStatusHandler:", error);
        return h.response({ status: "fail", message: error.message }).code(500);
    }
    
};

const getOrdersHandler = async (request, h) => {
    try {
        const { userId } = request.params;

        const snapshot = await db.collection('orders')
            .where('userId', '==', userId)
            .get(); // Tanpa orderBy → tidak perlu composite index

        if (snapshot.empty) {
            return h.response([]).code(200);
        }

        const orders = snapshot.docs
            .map(doc => {
                const data = doc.data();
                return {
                    ...data,
                    createdAt: data.createdAt?.toDate
                        ? data.createdAt.toDate()
                        : new Date(data.createdAt)
                };
            })
            .sort((a, b) => b.createdAt - a.createdAt) // Urutkan dari terbaru
            .map(order => ({
                ...order,
                createdAt: order.createdAt.toISOString() // Kembalikan ke string ISO
            }));

        return h.response(orders).code(200);
    } catch (error) {
        console.error('Error getOrdersHandler:', error);
        return h.response({ message: 'Gagal mengambil data order' }).code(500);
    }
};







module.exports = {
    createOrderHandler,
    midtransNotificationHandler,
    updateOrderStatusHandler,
    getOrdersHandler
};
