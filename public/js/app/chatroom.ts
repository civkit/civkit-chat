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
    const keys: KeyPair = await makeNewKey();
    const chatId: string = (document.querySelector('#chat-id') as HTMLInputElement).value;

    try {
        const response = await fetch(`/api/chat/accept-offer/${chatId}`, {
            method: 'POST',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(pluckPub(keys)),
        });

        const data = await response.json();

        saveKey(keys, chatId);

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

function initChatroom() {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const keys: KeyPair = loadKey(chatId);

    if (!keys) {
        console.error('No keys found for this chatroom.');
        return;
    }

    const whoami: HTMLElement = document.querySelector('#show-role');
    if (whoami) {
        let otherPubKey: string = null;
        const pubA: string = (document.querySelector('#pubkey-a') as HTMLInputElement).value;
        const pubB: string = (document.querySelector('#pubkey-b') as HTMLInputElement).value;

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
        if ((document.querySelector('#disputed-by') as HTMLInputElement).value === 'a') {
            document.querySelector('#pubkey-b').classList.add('partner-key');
            document.querySelector('#pubkey-a').classList.add('my-key');
        } else {
            document.querySelector('#pubkey-a').classList.add('partner-key');
            document.querySelector('#pubkey-b').classList.add('my-key');
        }
    }

    Array.from(document.querySelectorAll('.crypt')).forEach(async (msgBlock: Element) => {
        try {
            const data: Decrypted = await decryptMessage(msgBlock.textContent);
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
        } catch (e) {
            console.log('Not encrypted for us');
        }
    });
}

async function decryptMessage(crypt: string): Promise<Decrypted> {
    const chatId: string = document.querySelector('#chat-id').value;
    const keys: KeyPair = loadKey(chatId);

    const publicKey = await openpgp.readKey({ armoredKey: document.querySelector('.partner-key').value });
    const myPublicKey = await openpgp.readKey({ armoredKey: document.querySelector('.my-key').value });
    const privateKey = await openpgp.readPrivateKey({ armoredKey: keys.priv });

    const message = await openpgp.readMessage({ armoredMessage: crypt });
    const payload: any = await openpgp.decrypt({
        message,
        verificationKeys: [publicKey, myPublicKey],
        decryptionKeys: privateKey,
    });

    const decrypted: string = payload.data;
    const signatures: any = payload.signatures;
    let theirsValid = false;
    let mineValid = false;

    try {
        await signatures[0].verified;
        if (signatures[0].keyID.bytes === publicKey.keyPacket.keyID.bytes) {
            theirsValid = true;
        }
        if (signatures[0].keyID.bytes === myPublicKey.keyPacket.keyID.bytes) {
            mineValid = true;
        }
    } catch (e) {
        theirsValid = false;
        mineValid = false;
    }

    return { plain: decrypted, valid: { mine: mineValid, theirs: theirsValid } };
}

async function encryptMessage(plain: string): Promise<string> {
    const chatId: string = document.querySelector('#chat-id').value;
    const keys: KeyPair = loadKey(chatId);

    const publicKey = await openpgp.readKey({ armoredKey: document.querySelector('.partner-key').value });
    const myPublicKey = await openpgp.readKey({ armoredKey: document.querySelector('.my-key').value });
    const privateKey = await openpgp.readPrivateKey({ armoredKey: keys.priv });

    const encrypted = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: plain }),
        encryptionKeys: [publicKey, myPublicKey],
        signingKeys: privateKey,
    });

    return encrypted;
}

function sendMessage() {
    (async () => {
        const chatbox: any = document.querySelector('#chat');
        const plain: string = chatbox.value;

        const msg: string = await encryptMessage(plain);

        const chatId: string = document.querySelector('#chat-id').value;
        const response = await fetch(`/api/chat/add-message/${chatId}`, {
            method: 'POST',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: msg }),
        });

        if ((await response.json()).ok) {
            chatbox.value = '';
            window.location.reload();
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
