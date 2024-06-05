interface KeyPair {
    pub: string;
    priv: string;
}

interface PubKey {
    pubkey: string;
}

interface Decrypted {
    plain: string;
    valid: ValidityPair;
}

interface ValidityPair {
    mine: boolean;
    theirs: boolean;
}

declare const openpgp;
declare const localStorage;
declare const console;
declare const fetch;
declare const window;
declare const document;

function pluckPub(keys: KeyPair): PubKey {
    return { pubkey: keys.pub };
}

async function makeNewKey(): Promise<KeyPair> {
    const dummyValues = {
        userIDs: [{ name: '', email: '' }],
        passphrase: '',
    };

    const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519',
        format: 'armored',
        ...dummyValues,
    });

    return { pub: publicKey, priv: privateKey };
}

function saveKey(keys: KeyPair, chatId: string) {
    localStorage.setItem(`chat-key-${chatId}`, JSON.stringify(keys));
}

function loadKey(chatId: string): KeyPair {
    return JSON.parse(localStorage.getItem(`chat-key-${chatId}`));
}

function getOrderIdFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('orderId');
}

async function uiMakeChat() {
    const orderId = getOrderIdFromURL();
    if (!orderId) {
        console.error('Order ID is missing from the URL');
        return;
    }

    const keys = await makeNewKey();
    try {
        const response = await fetch('/api/chat/make-offer', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pubkey: keys.pub, orderId: orderId })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const { token, acceptOfferUrl } = await response.json();
        console.log('Generated chat ID:', token);
        saveKey(keys, token);
        window.location.href = `/ui/chat/room/${token}`;
    } catch (error) {
        console.error('Error creating chatroom:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const makeOfferButton = document.querySelector('#make-offer-button'); // Adjust the selector to your button
    if (makeOfferButton) {
        makeOfferButton.addEventListener('click', uiMakeChat);
    }
});

async function uiAcceptOffer() {
    try {
        const keys = await makeNewKey();
        const chatId = document.querySelector('#chat-id').value;

        console.log('Generated keys for accepting offer:', keys);

        const response = await fetch(`/api/chat/accept-offer/${chatId}`, {
            method: 'POST',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(pluckPub(keys)),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();

        console.log('Response data after accepting offer:', data);

        saveKey(keys, chatId);
        console.log('Keys saved after accepting offer:', keys);

        window.location.href = `/ui/chat/room/${chatId}`;
    } catch (error) {
        console.error('Error accepting chatroom:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initChatroom();

    const acceptOfferButton = document.querySelector('#accept-offer-button'); // Adjust the selector to your button
    if (acceptOfferButton) {
        acceptOfferButton.addEventListener('click', uiAcceptOffer);
    }

    const disputeButton = document.querySelector('#raise-dispute-button'); // Adjust the selector to your button
    if (disputeButton) {
        disputeButton.addEventListener('click', raiseDispute);
    }
});

async function decryptMessage(crypt: string): Promise<Decrypted> {
    const chatId: string = document.querySelector('#chat-id').value;
    const keys: KeyPair = loadKey(chatId);

    if (!keys) {
        console.error('No keys found for this chatroom.');
        return { plain: 'Error: No keys found', valid: { mine: false, theirs: false } };
    }

    const partnerKeyElement = document.querySelector('.partner-key');
    const myKeyElement = document.querySelector('.my-key');

    if (!partnerKeyElement || !myKeyElement) {
        console.error('Public key elements not found.');
        return { plain: 'Error: Public key elements not found', valid: { mine: false, theirs: false } };
    }

    const partnerKey = await openpgp.readKey({ armoredKey: partnerKeyElement.value });
    const myKey = await openpgp.readKey({ armoredKey: myKeyElement.value });
    const privateKey = await openpgp.readPrivateKey({ armoredKey: keys.priv });

    console.log('Attempting to decrypt message with the following keys:');
    console.log('Partner Key:', partnerKey);
    console.log('My Key:', myKey);
    console.log('Private Key:', privateKey);

    try {
        const message = await openpgp.readMessage({ armoredMessage: crypt });
        console.log('Message:', message);
        const payload = await openpgp.decrypt({
            message,
            verificationKeys: [partnerKey, myKey],
            decryptionKeys: privateKey,
        });

        const decrypted = payload.data;
        const signatures = payload.signatures;

        console.log('Decrypted payload:', decrypted);
        console.log('Signatures:', signatures);

        let theirsValid = false;
        let mineValid = false;

        try {
            await signatures[0].verified;
            if (signatures[0].keyID.bytes === partnerKey.keyPacket.keyID.bytes) {
                theirsValid = true;
            }
            if (signatures[0].keyID.bytes === myKey.keyPacket.keyID.bytes) {
                mineValid = true;
            }
        } catch (e) {
            theirsValid = false;
            mineValid = false;
        }

        return { plain: decrypted, valid: { mine: mineValid, theirs: theirsValid } };
    } catch (error) {
        console.error('Error decrypting message:', error);
        return { plain: 'Error decrypting message', valid: { mine: false, theirs: false } };
    }
}

function initChatroom() {
    const chatId = document.querySelector('#chat-id').value;
    const keys = loadKey(chatId);

    if (!keys || !keys.priv) {
        console.error('No keys found for this chatroom.');
        return;
    }

    console.log('Loaded keys:', keys);

    const whoami = document.querySelector('#show-role');
    if (whoami) {
        let otherPubKey = null;
        const pubA = document.querySelector('#pubkey-a').value;
        const pubB = document.querySelector('#pubkey-b').value;

        if (keys.pub === pubA) {
            whoami.innerText = 'user A';
            otherPubKey = pubB;
            document.querySelector('#pubkey-b').classList.add('partner-key');
            document.querySelector('#pubkey-a').classList.add('my-key');
        } else if (keys.pub === pubB) {
            whoami.innerText = 'user B';
            otherPubKey = pubA;
            document.querySelector('#pubkey-a').classList.add('partner-key');
            document.querySelector('#pubkey-b').classList.add('my-key');
        } else {
            whoami.innerText = 'a third party';
        }
    } else {
        if (document.querySelector('#disputed-by').value === 'a') {
            document.querySelector('#pubkey-b').classList.add('partner-key');
            document.querySelector('#pubkey-a').classList.add('my-key');
        } else {
            document.querySelector('#pubkey-a').classList.add('partner-key');
            document.querySelector('#pubkey-b').classList.add('my-key');
        }
    }

    Array.from(document.querySelectorAll('.crypt')).forEach(async (msgBlock) => {
        try {
            console.log('Original encrypted message block:', msgBlock.textContent);
            const data = await decryptMessage(msgBlock.textContent);
            msgBlock.textContent = data.plain;
            msgBlock.classList.remove('crypt');
            msgBlock.classList.add('plaintext');
            msgBlock.classList.add((data.valid.mine || data.valid.theirs) ? 'valid-sig' : 'bad-sig');
            if (data.valid.mine) {
                msgBlock.classList.add('from-me');
            }
            if (data.valid.theirs) {
                msgBlock.classList.add('from-them');
            }
            console.log('Decrypted message block:', msgBlock.textContent);
        } catch (e) {
            console.log('Not encrypted for us', e);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initChatroom();

    const acceptOfferButton = document.querySelector('#accept-offer-button');
    if (acceptOfferButton) {
        acceptOfferButton.addEventListener('click', uiAcceptOffer);
    }

    const disputeButton = document.querySelector('#raise-dispute-button');
    if (disputeButton) {
        disputeButton.addEventListener('click', raiseDispute);
    }
});

async function encryptMessage(plain: string): Promise<string> {
    const chatId = document.querySelector('#chat-id')?.value;
    const keys = loadKey(chatId);

    const publicKeyElement = document.querySelector('.partner-key');
    const myPublicKeyElement = document.querySelector('.my-key');

    if (!publicKeyElement || !myPublicKeyElement) {
        throw new Error('Public key elements not found.');
    }

    const publicKey = await openpgp.readKey({ armoredKey: publicKeyElement.value });
    const myPublicKey = await openpgp.readKey({ armoredKey: myPublicKeyElement.value });
    const privateKey = await openpgp.readPrivateKey({ armoredKey: keys.priv });

    console.log("Public Key:", publicKey);
    console.log("My Public Key:", myPublicKey);
    console.log("Private Key:", privateKey);

    const encrypted = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: plain }),
        encryptionKeys: [publicKey, myPublicKey],
        signingKeys: privateKey,
    });

    console.log("Encrypted Message:", encrypted);

    return encrypted;
}

function sendMessage() {
    (async () => {
        const chatbox = document.querySelector('#chat');
        const plain = chatbox.value;

        try {
            const msg = await encryptMessage(plain);
            const chatId = document.querySelector('#chat-id')?.value;

            if (!chatId) {
                throw new Error('Chat ID not found.');
            }

            const response = await fetch(`/api/chat/add-message/${chatId}`, {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: msg }),
            });

            if (response.ok) {
                chatbox.value = '';
                window.location.reload();
            } else {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
        } catch (error) {
            console.error('Error sending message:', error);
        }
    })();
}

function raiseDispute() {
    (async () => {
        const chatId: string = document.querySelector('#chat-id').value;
        const keys: KeyPair = loadKey(chatId);

        const whoami: any = document.querySelector('#show-role');
        const user: string = whoami.innerText === 'user A' ? 'a' : 'b';

        const response = await fetch(`/api/chat/raise-dispute/${chatId}`, {
            method: 'POST',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                privateKey: keys.priv,
                byUser: user,
            }),
        });

        if ((await response.json()).ok) {
            window.location.reload();
        }
    })();
}
