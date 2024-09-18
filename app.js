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
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
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
        const order_id = parseInt(orderId, 10);
        const existingChat = await prisma.chat.findFirst({
            where: { order_id }
        });

        if (existingChat) {
            await prisma.chat.update({
                where: { chat_id: existingChat.chat_id },
                data: { token, accept_offer_url: acceptOfferUrl, chatroom_url: chatroomUrl }
            });
        } else {
            await prisma.chat.create({
                data: { order_id, token, accept_offer_url: acceptOfferUrl, chatroom_url: chatroomUrl }
            });
        }
    } catch (err) {
        console.error("Error updating database:", err);
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

    const baseUrl = process.env.BASE_URL || 'http://localhost:3456';
    const acceptOfferUrl = `${baseUrl}/ui/chat/accept-offer/${token}?orderId=${orderId}`;
    const chatroomUrl = `${baseUrl}/ui/chat/room/${token}`;
    console.log(`Accept Offer URL: ${acceptOfferUrl}`);

    await updateDatabaseWithToken(orderId, token, acceptOfferUrl, chatroomUrl);

    res.json({ token, acceptOfferUrl });
});

// Handle accept-offer endpoint
app.post('/api/chat/accept-offer/:chat_id', async (req, res) => {
    const { chat_id } = req.params;
    const data = await loadFrom(chat_id);

    if (data.pubkey_b) {
        return res.status(400).json({ error: 'Chat already accepted by another user.' });
    }

    data.pubkey_b = req.body.pubkey;
    await writeTo(chat_id, data);
    res.json({ ok: true });
});

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
