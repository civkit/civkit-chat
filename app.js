const express = require('express');
const app = express();
const port = 3456;
require('dotenv').config();

app.use(express.static('public'));
app.set('view engine', 'pug');
app.use(express.json());

const fsProm = require('fs/promises');
const path = require('path');
const db = require('./dbConfig.ts'); // Adjust the path to where you've set up the pool

// Helper functions
async function writeTo(chat_id, data) {
    if (!chat_id) {
        console.error('Chat ID is undefined');
        throw new Error('Chat ID is undefined');
    }
    return fsProm.writeFile(path.join(__dirname, `./data/${chat_id}.json`), JSON.stringify(data));
}

async function loadFrom(chat_id) {
    if (!chat_id) {
        console.error('Chat ID is undefined');
        throw new Error('Chat ID is undefined');
    }
    return JSON.parse(await fsProm.readFile(path.join(__dirname, `./data/${chat_id}.json`)));
}

// Update the database with the token, chatroom_url, and accept offer URL
async function updateDatabaseWithToken(orderId, token, acceptOfferUrl, chatroomUrl) {
    try {
        const selectQuery = 'SELECT * FROM chats WHERE order_id = $1';
        const selectResult = await db.query(selectQuery, [orderId]);

        if (selectResult.rows.length > 0) {
            // Update existing row
            const updateQuery = 'UPDATE chats SET token = $1, accept_offer_url = $2, chatroom_url = $3 WHERE order_id = $4 RETURNING *';
            const updateResult = await db.query(updateQuery, [token, acceptOfferUrl, chatroomUrl, orderId]);
            console.log("Database update result:", updateResult.rows);
        } else {
            // Insert new row
            const insertQuery = 'INSERT INTO chats (order_id, token, accept_offer_url, chatroom_url) VALUES ($1, $2, $3, $4) RETURNING *';
            const insertResult = await db.query(insertQuery, [orderId, token, acceptOfferUrl, chatroomUrl]);
            console.log("Database insert result:", insertResult.rows);
        }
    } catch (err) {
        console.error("Error updating database:", err.stack);
    }
}

// Handle make-offer endpoint
app.post('/api/chat/make-offer', async (req, res) => {
    const { pubkey } = req.body;
    const orderId = req.query.orderId; // Get orderId from query params
    console.log("Received orderId:", orderId);

    if (!orderId) {
        return res.status(400).json({ error: 'Order ID is required.' });
    }

    let token = '';
    const chars = '0123456789';
    while (token.length < 10) {
        token += chars[Math.floor(Math.random() * chars.length)];
    }

    console.log("Generated token:", token);

    const data = {
        pubkey_a: pubkey,
        pubkey_b: null,
        messages: [],
        orderId: orderId,
        token: token
    };

    await writeTo(token, data);

    const acceptOfferUrl = `http://localhost:3456/ui/chat/accept-offer/${token}?orderId=${orderId}`;
    const chatroomUrl = `http://localhost:3456/ui/chat/room/${token}`;
    console.log(`Accept Offer URL: ${acceptOfferUrl}`);

    await updateDatabaseWithToken(orderId, token, acceptOfferUrl, chatroomUrl);

    res.json({ token, acceptOfferUrl });
});

// Handle accept-offer endpoint
app.get('/ui/chat/accept-offer/:token', async (req, res) => {
    const token = req.params.token;
    const orderId = req.query.orderId;

    console.log("Received token:", token);
    console.log("Received orderId:", orderId);

    const data = await loadFromTokenAndOrderId(token, orderId);
    if (!data) {
        return res.status(404).send('Chat or order not found.');
    }

    res.render('accept-offer', { ...data, chat_id: token, orderId: orderId });
});

async function loadFromTokenAndOrderId(token, orderId) {
    const query = 'SELECT * FROM chats WHERE token = $1 AND order_id = $2';
    try {
        const res = await db.query(query, [token, orderId]);
        return res.rows[0];
    } catch (err) {
        console.error(err.stack);
        return null;
    }
}

// Handle adding a message to the chat
app.post('/api/chat/add-message/:chat_id', async (req, res) => {
    const { chat_id } = req.params;
    const data = await loadFrom(chat_id);

    if (data.has_dispute) {
        return res.json({ ok: false });
    }

    data.messages.push(req.body.message);
    await writeTo(chat_id, data);
    res.json({ ok: true });
});

// Handle raising a dispute
app.post('/api/chat/raise-dispute/:chat_id', async (req, res) => {
    const { chat_id } = req.params;
    const data = await loadFrom(chat_id);

    data.has_dispute = true;
    data.dispute_private_key = req.body.privateKey;
    data.disputed_by = req.body.byUser;

    await writeTo(chat_id, data);
    res.json({ ok: true });
});

// Render make-offer page
app.get('/ui/chat/make-offer', (req, res) => {
    const orderId = req.query.orderId;
    res.render('make-offer', { orderId });
});

// Render accept-offer page
app.get('/ui/chat/accept-offer/:chat_id', async (req, res) => {
    const data = await loadFrom(req.params.chat_id);
    res.render('accept-offer', { ...data, chat_id: req.params.chat_id });
});

// Render chatroom page
app.get('/ui/chat/room/:chat_id', async (req, res) => {
    const data = await loadFrom(req.params.chat_id);
    res.render('chatroom', { ...data, chat_id: req.params.chat_id });
});

// Render moderator-view page
app.get('/ui/chat/moderator-view/:chat_id', async (req, res) => {
    const data = await loadFrom(req.params.chat_id);
    res.render('moderator-view', { ...data, chat_id: req.params.chat_id });
});

// Start the server
app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
