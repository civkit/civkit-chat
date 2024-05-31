const express = require('express');
const app = express();
const port = 3456;

app.use(express.static('public'));
app.set('view engine', 'pug');
app.use(express.json());

const fsProm = require('fs/promises');

// simple pair of helpers
async function writeTo(chat_id, data) {
    return fsProm.writeFile(`./data/${chat_id}.json`, JSON.stringify(data));
}

async function loadFrom(chat_id) {
    return JSON.parse(await fsProm.readFile(`./data/${chat_id}.json`));
}

app.post('/api/chat/make-offer', async (req, res) => {
    const chars = '0123456789';
    let token = '';
    while (token.length < 10) {
        token += chars[Math.floor(Math.random() * chars.length)];
    }

    const data = {
        pubkey_a: req.body.pubkey,
        pubkey_b: null,
        messages: [],
    };

    await writeTo(token, data);

    const acceptOfferUrl = `http://localhost:3456/ui/chat/accept-offer/${token}`;
    console.log(`Chatroom created with token: ${token}`);
    console.log(`Accept Offer URL: ${acceptOfferUrl}`);

    // Call the API to update the accept offer URL
    await fetch('http://localhost:3000/api/update-accept-offer-url', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chat_id: token, accept_offer_url: acceptOfferUrl })
    });

    res.json({ token });
});

app.post('/api/chat/accept-offer/:chat_id', async (req, res) => {
    const { chat_id } = req.params;
    const data = await loadFrom(chat_id);

    if (data.pubkey_b) {
        return res.json({ ok: false });
    }

    data.pubkey_b = req.body.pubkey;
    await writeTo(chat_id, data);
    res.json({ ok: true });
});

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

app.post('/api/chat/raise-dispute/:chat_id', async (req, res) => {
    const { chat_id } = req.params;
    const data = await loadFrom(chat_id);

    data.has_dispute = true;
    data.dispute_private_key = req.body.privateKey;
    data.disputed_by = req.body.byUser;

    await writeTo(chat_id, data);
    res.json({ ok: true });
});

app.get('/ui/chat/make-offer', (req, res) => {
    res.render('make-offer');
});

app.get('/ui/chat/accept-offer/:chat_id', async (req, res) => {
    const data = await loadFrom(req.params.chat_id);
    res.render('accept-offer', { ...data, chat_id: req.params.chat_id });
});

app.get('/ui/chat/room/:chat_id', async (req, res) => {
    const data = await loadFrom(req.params.chat_id);
    res.render('chatroom', { ...data, chat_id: req.params.chat_id });
});

app.get('/ui/chat/moderator-view/:chat_id', async (req, res) => {
    const data = await loadFrom(req.params.chat_id);
    res.render('moderator-view', { ...data, chat_id: req.params.chat_id });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
