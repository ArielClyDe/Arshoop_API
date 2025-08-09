const { db } = require('../services/firebaseService');
const midtransClient = require('midtrans-client');

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

        // Buat Order ID unik
        const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Hitung item_details
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

        // Tambah ongkir
        if (ongkir) {
            itemDetails.push({
                id: "ONGKIR",
                price: ongkir,
                quantity: 1,
                name: "Ongkos Kirim"
            });
        }

        // Hitung total
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
            paymentMethod,
            deliveryMethod,
            // status awal untuk pengerjaan
            status: 'pending', // pending menunggu validasi admin
            paymentStatus: paymentMethod === 'midtrans' ? 'pending' : 'waiting_payment',
            createdAt: new Date().toISOString(),
        };

        let midtransToken = null;
        let midtransRedirectUrl = null;

        if (paymentMethod === 'midtrans') {
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

            // AUTO SETTLEMENT SANDBOX
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

        // Simpan order
        await db.collection('orders').doc(orderId).set({
            ...orderData,
            midtransToken,
            midtransRedirectUrl,
        });

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

// ======== NOTIFIKASI MIDTRANS ========
const midtransNotificationHandler = async (request, h) => {
    try {
        const notification = request.payload;
        const statusResponse = await core.transaction.notification(notification);

        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        let paymentStatus = 'pending';

        if (transactionStatus === 'capture') {
            paymentStatus = fraudStatus === 'accept' ? 'paid' : 'challenge';
        } else if (transactionStatus === 'settlement') {
            paymentStatus = 'paid';
        } else if (transactionStatus === 'pending') {
            paymentStatus = 'pending';
        } else if (['deny', 'cancel', 'expire'].includes(transactionStatus)) {
            paymentStatus = 'failed';
        } else if (transactionStatus === 'refund') {
            paymentStatus = 'refunded';
        }

        await db.collection('orders').doc(orderId).update({
            paymentStatus,
            updatedAt: new Date().toISOString(),
            midtransStatus: statusResponse
        });

        return h.response({ success: true, message: 'Notifikasi diproses' }).code(200);

    } catch (error) {
        console.error('Error midtransNotificationHandler:', error);
        return h.response({ success: false, message: error.message }).code(500);
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
            .get();

        const orders = [];
        snapshot.forEach(doc => {
            orders.push(doc.data());
        });

        return h.response(orders).code(200);
    } catch (error) {
        console.error(error);
        return h.response({ message: 'Gagal mengambil data order' }).code(500);
    }
};


module.exports = {
    createOrderHandler,
    midtransNotificationHandler,
    updateOrderStatusHandler,
    getOrdersHandler
};
