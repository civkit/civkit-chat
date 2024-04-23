interface KeyPair {
	pub: string;
	priv: string;
	// ignore the revocation certificate, we don't need that for our app
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

// TODO set up typescript config so that these browser apis are pre-included
declare const localStorage;
declare const console;
declare const fetch;
declare const window;
declare const document;

function pluckPub(keys: KeyPair): PubKey {
	return {pubkey: keys.pub}
}

async function makeNewKey() : Promise<KeyPair> {
	// values that we don't use, but which the OpenPGP.js library needs for key generation
	const dummyValues = {
		userIDs: [{name:'', email:''}],
		passphrase: '', // passphrase might actually come in handy at some point, but currently, we don't use it
	};

	const { privateKey, publicKey, revocationCertificate } = await openpgp.generateKey({
		type: 'ecc', // Type of the key, defaults to ECC
		curve: 'curve25519', // ECC curve name, defaults to curve25519
		format: 'armored', // output key format, defaults to 'armored' (other options: 'binary' or 'object')

		...dummyValues,
	});

	return { pub: publicKey, priv: privateKey };
}

function saveKey(keys : KeyPair, chatId: string) {
	localStorage.setItem(`chat-key-${chatId}`, JSON.stringify(keys));
}

function loadKey(chatId: string) : KeyPair {
	const keyOverride = document.querySelector('#privkey');
	if (keyOverride) {
		return { priv: keyOverride.value, pub: null };
	} else {
		return JSON.parse(localStorage.getItem(`chat-key-${chatId}`));
	}
}


function uiMakeOffer() {
	(async () => {
		const keys: KeyPair = await makeNewKey();

		const response = await fetch('/api/chat/make-offer', {
			method: "POST",
			cache: "no-cache",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(pluckPub(keys)),
		})

		// Q from heather: is there a way to destructure objects while assigning, in TS?
		const token: string = (await response.json()).token;

		saveKey(keys, token);

		window.location.href = `/ui/chat/room/${token}`;
	})()
}
function uiAcceptOffer() {
	(async () => {
		const keys: KeyPair = await makeNewKey();
		const chatId: string = document.querySelector('#chat-id').value;

		const response = await fetch(`/api/chat/accept-offer/${chatId}`, {
			method: "POST",
			cache: "no-cache",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(pluckPub(keys)),
		})

		await response.json();

		saveKey(keys, chatId);

		window.location.href = `/ui/chat/room/${chatId}`;
	})()
}

function initChatroom() {
	const chatId: string = document.querySelector('#chat-id').value;
	const keys: KeyPair = loadKey(chatId);

	// TODO figure out what DOM type to use
	const whoami: any = document.querySelector('#show-role');
	// this only needs to run in the chatroom view, not the moderator view
	if (whoami) {
		let otherPubKey: string = null;

		const pubA: string = document.querySelector('#pubkey-a').value;
		const pubB: string = document.querySelector('#pubkey-b').value;
		if (keys && keys.pub == pubA) {
			whoami.innerText = 'user A';
			otherPubKey = pubB;
			document.querySelector('#pubkey-b').classList.add('partner-key');
			document.querySelector('#pubkey-a').classList.add('my-key');
		} else if (keys && keys.pub == pubB) {
			whoami.innerText = 'user B';
			otherPubKey = pubA;
			document.querySelector('#pubkey-a').classList.add('partner-key');
			document.querySelector('#pubkey-b').classList.add('my-key');
		} else {
			whoami.innerText = 'a third party';
		}
	} else {
		if (document.querySelector('#disputed-by').value == 'a') {
			document.querySelector('#pubkey-b').classList.add('partner-key');
			document.querySelector('#pubkey-a').classList.add('my-key');
		} else {
			document.querySelector('#pubkey-a').classList.add('partner-key');
			document.querySelector('#pubkey-b').classList.add('my-key');
		}
	}

	Array.from(document.querySelectorAll('.crypt')).forEach(async (msgBlock:any) => {
		try {
			const data: Decrypted = await decryptMessage(msgBlock.innerText);
			msgBlock.innerText = data.plain;
			msgBlock.classList.remove('crypt');
			msgBlock.classList.add('plaintext');
			msgBlock.classList.add((data.valid.mine || data.valid.theirs) ? 'valid-sig' : 'bad-sig');
			console.log(data.valid);
			if (data.valid.mine) {
				msgBlock.classList.add('from-me');
			}
			if (data.valid.theirs) {
				msgBlock.classList.add('from-them');
			}
		} catch(e) {
			console.log("not encrypted for us")
		}
	})
}

async function decryptMessage(crypt: string): Promise<Decrypted> {
	const chatId: string = document.querySelector('#chat-id').value;
	const keys: KeyPair = loadKey(chatId);

	const publicKey = await openpgp.readKey({ armoredKey: document.querySelector('.partner-key').value });
	const myPublicKey = await openpgp.readKey({ armoredKey: document.querySelector('.my-key').value });
	const privateKey = await openpgp.readPrivateKey({ armoredKey: keys.priv, });

	const message = await openpgp.readMessage({
		armoredMessage: crypt // parse armored message
	});
	const payload: any = await openpgp.decrypt({
		message,
		verificationKeys: [publicKey, myPublicKey], // optional
		decryptionKeys: privateKey
	});
	const decrypted: string = payload.data;
	const signatures: any = payload.signatures;
	console.log(decrypted); // 'Hello, World!'
	// check signature validity (signed messages only)
	let theirsValid: boolean = false;
	let mineValid: boolean = false;
	console.log(signatures);
	console.log(publicKey);
	try {
		await signatures[0].verified; // throws on invalid signature
		if (signatures[0].keyID.bytes == publicKey.keyPacket.keyID.bytes) {
			theirsValid = true;
		}
		if (signatures[0].keyID.bytes == myPublicKey.keyPacket.keyID.bytes) {
			mineValid = true;
		}
	} catch (e) {
		theirsValid = false;
		mineValid = false;
	}	

	return {plain: decrypted, valid: {mine: mineValid, theirs: theirsValid}};
}

async function encryptMessage(plain: string) : Promise<string> {
	const chatId: string = document.querySelector('#chat-id').value;
	const keys: KeyPair = loadKey(chatId);

	const publicKey = await openpgp.readKey({ armoredKey: document.querySelector('.partner-key').value });
	const myPublicKey = await openpgp.readKey({ armoredKey: document.querySelector('.my-key').value });
	const privateKey = await openpgp.readPrivateKey({ armoredKey: keys.priv, });

	const encrypted = await openpgp.encrypt({
		message: await openpgp.createMessage({ text: plain }), // input as Message object
		encryptionKeys: [publicKey, myPublicKey],
		signingKeys: privateKey // optional
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
			method: "POST",
			cache: "no-cache",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({message: msg}),
		})

		if ((await response.json()).ok) {
			chatbox.value = '';
			window.location.reload();
		}
	})()
}

function raiseDispute() {
	(async () => {
		const chatId: string = document.querySelector('#chat-id').value;
		const keys: KeyPair = loadKey(chatId);

		// TODO better user A/B storage (at a later date; might depend on the rest of the app)
		const whoami: any = document.querySelector('#show-role');
		const user: string = whoami.innerText == 'user A' ? 'a' : 'b';

		const response = await fetch(`/api/chat/raise-dispute/${chatId}`, {
			method: "POST",
			cache: "no-cache",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				privateKey: keys.priv,
				byUser: user,
			}),
		})

		if ((await response.json()).ok) {
			window.location.reload();
		}
	})()
}
