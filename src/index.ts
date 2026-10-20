import type { Transaction } from './typings.d.ts';

import crypto from 'node:crypto';
import fs from 'node:fs';
import util from 'node:util';
import express from 'express';
import cookieParser from 'cookie-parser';
import { MongoClient, Db, Collection } from 'mongodb';
import spanishDate from './spanishDate';
import esperantoDate from './esperantoDate';
import onlyDigits from './only-digits.js';
import { luhnCheck } from './luhn.js';

const SCRYPT_KEYLEN = 64;

const scrypt = util.promisify(crypto.scrypt);

const server = express();
const port = Number(process.env.PORT ?? 8080);
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME ?? 'bank';
const stylesheet = fs.readFileSync('./stil.css');

// Conexión y colecciones de MongoDB
let client: MongoClient;
let db: Db;
let usersCollection: Collection<any>;
let transactionsCollection: Collection<Transaction>;
let cookiesCollection: Collection<{ username: string; nonce: string }>;
let idempotencyCollection: Collection<{ nonce: string; createdAt: Date }>;

function formatCurrency(amount: number) {
	return new Intl.NumberFormat('en-CA', {
		style: 'currency',
		currency: 'SED'
	}).format(amount);
}

server.locals.spanishDate = spanishDate;
server.locals.esperantoDate = esperantoDate;
server.locals.formatCurrency = formatCurrency;
server.locals.TIME_SHIFT = -5; // GMT -5

server.disable('x-powered-by');
server.set('view engine', 'ejs');
server.set('views', './views');
server.use(express.urlencoded({ extended: true }));
server.use(cookieParser());

// Utilidades criptográficas para autenticación
async function deriveKey(token: string, salt: Buffer): Promise<Buffer> {
	return (await scrypt(token, salt, SCRYPT_KEYLEN)) as Buffer;
}

async function verifyToken(storedKey: string, token: string): Promise<boolean> {
	if (!storedKey) return false;
	const [saltHex, hashHex] = storedKey.split(':');
	if (!saltHex || !hashHex) return false;
	const salt = Buffer.from(saltHex, 'hex');
	const expectedHash = Buffer.from(hashHex, 'hex');
	try {
		const derived = await deriveKey(token, salt);
		if (derived.length !== expectedHash.length) return false;
		return crypto.timingSafeEqual(expectedHash, derived);
	} catch {
		return false;
	}
}

async function auth(user: string, token: string): Promise<boolean> {
	const userDoc = await usersCollection.findOne({ username: user });
	if (!userDoc) return false;
	return await verifyToken(userDoc.key, token);
}

// Cálculo eficiente de saldo desde MongoDB
async function calculateBalanceFromDB(username: string): Promise<number> {
	if (username === 'admin') return Infinity;

	const pipeline = [
		{
			$match: { $or: [{ payer: username }, { payee: username }] }
		},
		{
			$project: {
				impact: {
					$cond: [
						{ $eq: ['$payer', username] },
						{ $multiply: [-1, '$amount'] },
						'$amount'
					]
				}
			}
		},
		{
			$group: {
				_id: null,
				balance: { $sum: '$impact' }
			}
		}
	];

	const agg = await transactionsCollection.aggregate(pipeline).toArray();
	if (agg.length === 0) return 0;
	const balance = agg[0].balance ?? 0;
	return Number(Number(balance).toFixed(2));
}

// Rutas generales y de estilo
server.get('/', (req, res) => {
	switch (req.cookies?.lingvo) {
		case 'es':
			return res.redirect('/es');
		case 'eo':
			return res.redirect('/eo');
		default:
			return res.status(200).render('radiko');
	}
});

server.get('/stil.css', (_, res) => {
	try {
		return res
			.status(200)
			.setHeader('Cache-Control', 'public, max-age=86400')
			.type('text/css')
			.send(stylesheet);
	} catch (error) {
		console.error('Malsukceso legante stilfolion:', error);
		return res.status(500).render('er5xx', {
			errorMessage:
				'Ne povis legi la stilfolion. / No se pudo leer la hoja de estilos.'
		});
	}
});
server.get('/favicon.ico', (_, res) => {
	try {
		return res
			.status(200)
			.setHeader('Cache-Control', 'public, max-age=86400')
			.type('image/x-icon')
			.send(fs.readFileSync('./favicon.ico'));
	} catch (error) {
		console.error('Malsukceso legante ikonon:', error);
		return res.status(500).render('er5xx', {
			errorMessage: 'Ne povis legi la ikonon. / No se pudo leer el icono.'
		});
	}
});

server.get('/elsaluti', async (req, res) => {
	const sessionCookie = req.cookies.seanco;
	if (sessionCookie) {
		const [username, nonce] = String(sessionCookie).split(':');
		if (username && nonce) {
			await cookiesCollection.deleteOne({ username, nonce });
		}
	}
	return res.clearCookie('seanco').redirect('/');
});

server.use((req, res, next) => {
	// Excluimos la hoja de estilos e icono para que sigan usando su propia caché de 24h
	if (!['/stil.css', '/favicon.ico'].includes(req.path)) {
		res.setHeader(
			'Cache-Control',
			'no-store, no-cache, must-revalidate, private'
		);
	}
	next();
});

// ==========================================
// SPANISH HANDLERS
// ==========================================
server.get('/es', async (req, res) => {
	const sessionCookie = req.cookies.seanco;
	let isLoggedIn = false;
	let username: string | null = null;

	if (sessionCookie) {
		const [u, n] = String(sessionCookie).split(':');
		if (u && n) {
			const sessionDoc = await cookiesCollection.findOne({
				username: u,
				nonce: n
			});
			if (sessionDoc) {
				isLoggedIn = true;
				username = u;
			}
		}
	}

	return res
		.status(200)
		.cookie('lingvo', 'es', { httpOnly: true })
		.render('es', { username });
});

server.get('/es/inic-ses', (_, res) =>
	res.status(200).render('es_inic-ses', { error: null })
);

server.get('/es/transferir-fondos', (req, res) => {
	const idempotencyNonce = `${Date.now()}-${
		req.socket?.remoteAddress ?? req.ip ?? 'nekonata-adreso'
	}:${
		req.socket?.remotePort ?? 'nekonata-haveno'
	}-${crypto.randomBytes(3).toString('hex')}`;
	res.status(200).render('es_transferir-fondos', { idempotencyNonce });
});

server.get('/es/saldo-y-transacciones', async (req, res) => {
	const sessionCookie = req.cookies.seanco;
	if (!sessionCookie) return res.redirect('/es/inic-ses');

	const [username, nonce] = String(sessionCookie).split(':');
	if (!username || !nonce) return res.redirect('/es/inic-ses');

	const sessionDoc = await cookiesCollection.findOne({ username, nonce });
	if (!sessionDoc) return res.redirect('/es/inic-ses');

	const balanceNumber = await calculateBalanceFromDB(username);
	const userDoc = await usersCollection.findOne({ username });
	const txnIds = userDoc?.transaction_ids ?? [];

	const txns =
		txnIds.length > 0
			? await transactionsCollection
					.find({ id: { $in: txnIds } })
					.sort({ datetime: -1 })
					.toArray()
			: [];

	return res.status(200).render('es_saldo-y-transacciones', {
		balance: new Intl.NumberFormat('en-CA', {
			style: 'currency',
			currency: 'SED'
		}).format(balanceNumber),
		transactions: txns.map(tx => ({
			txId: tx.id,
			sourceAccount: tx.payer,
			destinationAccount: tx.payee,
			amount: formatCurrency(
				(username === tx.payee ? 1 : -1) * (tx.amount as number)
			),
			datetime: tx.datetime,
			purpose: tx.purpose
		}))
	});
});

server.get('/es/consultar-tx', async (req, res) => {
	const txId = req.query.id;
	if (txId === undefined)
		return res
			.status(200)
			.render('es_consultar-tx', { errorMessage: '', tx: null });

	if (typeof txId !== 'string')
		return res.status(400).render('es_consultar-tx', {
			errorMessage: 'Se proporcionó un ID de transacción inválido.',
			tx: null
		});

	const tx = await transactionsCollection.findOne({ id: txId });
	if (!tx)
		return res.status(404).render('es_consultar-tx', {
			errorMessage: 'No se encontró la transacción.',
			tx: null
		});
	return res.status(200).render('es_consultar-tx', { tx });
});

server.post('/es/inic-ses', async (req, res) => {
	const { uzantnomo, tokeno } = req.body;

	if (await auth(uzantnomo, tokeno)) {
		const nonce = crypto.randomBytes(16).toString('base64');
		const session = `${uzantnomo}:${nonce}`;

		// Guardar sesión en la colección 'cookies' de MongoDB
		await cookiesCollection.insertOne({ username: uzantnomo, nonce });

		return res
			.status(302)
			.cookie('seanco', session, {
				httpOnly: true,
				secure: process.env.NODE_ENV === 'production',
				sameSite: 'lax'
			})
			.redirect('/es/saldo-y-transacciones');
	}

	const error = {
		code: 401,
		message:
			'Se rechazó el inicio de sesión. Verifica tu número de cuenta y token.'
	};
	return res.status(error.code).render('es_inic-ses', { error });
});

server.post('/es/transferir-fondos', async (req, res) => {
	const sessionCookie = req.cookies.seanco;
	const datetime = Date.now();
	const idempotencyNonce = req.body.idem;
	const payee = req.body.ricevanto;
	const amount = Number(Number(req.body.kvanto).toFixed(2));
	const purpose = req.body.kialo;

	if (!sessionCookie)
		return res.status(401).render('es_tx-resultado', {
			sourceAccount: '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Inicio de sesión no válido.'
		});

	const [payer, nonce] = String(sessionCookie).split(':');
	const sessionDoc = await cookiesCollection.findOne({
		username: payer,
		nonce
	});
	const payeeUser = await usersCollection.findOne({ username: payee });
	const amountIsNAN = Number.isNaN(amount);
	const amountIsNegativeOrZero = amount <= 0;
	const payeeIsInvalid =
		typeof payee !== 'string' ||
		(onlyDigits(payee) ? !luhnCheck(payee) : payee !== 'admin');
	const isSelfTx = payer === payee;

	let errorMessage = '';

	if (amountIsNAN) errorMessage = 'El monto no es un número válido.';
	if (amountIsNegativeOrZero)
		errorMessage = 'El monto debe ser mayor que cero.';
	if (payeeIsInvalid) errorMessage = 'La cuenta del beneficiario no es válida.';
	if (isSelfTx) errorMessage = 'No puedes enviarte dinero a ti mismo/a.';

	if (errorMessage)
		return res.status(400).render('es_tx-resultado', {
			sourceAccount: payer ?? '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage
		});

	// Verificar idempotencia en MongoDB
	const existingNonce = await idempotencyCollection.findOne({
		nonce: idempotencyNonce
	});
	if (existingNonce)
		return res.status(409).render('es_tx-resultado', {
			sourceAccount: payer ?? '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Se intentó volver a ejecutar una transacción.'
		});

	if (!payer || !nonce || !sessionDoc)
		return res.status(401).render('es_tx-resultado', {
			sourceAccount: payer ?? '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Inicio de sesión no válido.'
		});

	if (!payeeUser)
		return res.status(404).render('es_tx-resultado', {
			sourceAccount: payer ?? '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Cuenta del beneficiario no encontrada.'
		});

	const payerBalance = await calculateBalanceFromDB(payer);
	if (payer !== 'admin' && amount > payerBalance)
		return res.status(403).render('es_tx-resultado', {
			sourceAccount: payer ?? '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Fondos insuficientes.'
		});

	const txId = crypto.randomUUID();
	const transactionDoc: Transaction = {
		id: txId,
		amount,
		payee,
		payer,
		purpose: purpose ?? '',
		status: 'approved',
		datetime,
		error: null
	};

	const session = client.startSession();
	try {
		await session.withTransaction(async () => {
			await usersCollection.updateOne(
				{ username: payer },
				{ $push: { transaction_ids: txId } as any },
				{ session }
			);
			await usersCollection.updateOne(
				{ username: payee },
				{ $push: { transaction_ids: txId } as any },
				{ session }
			);
			await transactionsCollection.insertOne(transactionDoc, { session });
		});

		// Registrar nonce de idempotencia efímero (expira en 24h vía TTL)
		await idempotencyCollection.insertOne({
			nonce: idempotencyNonce,
			createdAt: new Date()
		});

		return res.status(200).render('es_tx-resultado', {
			sourceAccount: payer ?? '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'approved',
			purpose,
			txId
		});
	} catch (err: any) {
		return res.status(500).render('es_tx-resultado', {
			sourceAccount: payer ?? '(desconocido)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Error interno al procesar la transacción.'
		});
	} finally {
		await session.endSession();
	}
});

// ==========================================
// ESPERANTO HANDLERS
// ==========================================
server.get('/eo', async (req, res) => {
	const sessionCookie = req.cookies.seanco;
	let isLoggedIn = false;
	let username: string | null = null;

	if (sessionCookie) {
		const [u, n] = String(sessionCookie).split(':');
		if (u && n) {
			const sessionDoc = await cookiesCollection.findOne({
				username: u,
				nonce: n
			});
			if (sessionDoc) {
				isLoggedIn = true;
				username = u;
			}
		}
	}

	return res
		.status(200)
		.cookie('lingvo', 'eo', { httpOnly: true })
		.render('eo', { username });
});

server.get('/eo/ensaluti', (_, res) =>
	res.status(200).render('eo_ensaluti', { error: null })
);

server.get('/eo/transfiri-financon', (req, res) => {
	const idempotencyNonce = `${Date.now()}-${
		req.socket?.remoteAddress ?? req.ip ?? 'nekonata-adreso'
	}:${
		req.socket?.remotePort ?? 'nekonata-haveno'
	}-${crypto.randomBytes(3).toString('hex')}`;
	res.status(200).render('eo_transfiri-financon', { idempotencyNonce });
});

server.get('/eo/saldo-kaj-transakcioj', async (req, res) => {
	const sessionCookie = req.cookies.seanco;
	if (!sessionCookie) return res.redirect('/eo/ensaluti');

	const [username, nonce] = String(sessionCookie).split(':');
	if (!username || !nonce) return res.redirect('/eo/ensaluti');

	const sessionDoc = await cookiesCollection.findOne({ username, nonce });
	if (!sessionDoc) return res.redirect('/eo/ensaluti');

	const balanceNumber = await calculateBalanceFromDB(username);
	const userDoc = await usersCollection.findOne({ username });
	const txnIds = userDoc?.transaction_ids ?? [];

	const txns =
		txnIds.length > 0
			? await transactionsCollection
					.find({ id: { $in: txnIds } })
					.sort({ datetime: -1 })
					.toArray()
			: [];

	return res.status(200).render('eo_saldo-kaj-transakcioj', {
		balance: new Intl.NumberFormat('en-CA', {
			style: 'currency',
			currency: 'SED'
		}).format(balanceNumber),
		transactions: txns.map(tx => ({
			txId: tx.id,
			sourceAccount: tx.payer,
			destinationAccount: tx.payee,
			amount: formatCurrency(
				(username === tx.payee ? 1 : -1) * (tx.amount as number)
			),
			datetime: tx.datetime,
			purpose: tx.purpose
		}))
	});
});

server.get('/eo/demandi-pri-tx', async (req, res) => {
	const txId = req.query.id;
	if (txId === undefined)
		return res
			.status(200)
			.render('eo_demandi-pri-tx', { errorMessage: '', tx: null });

	if (typeof txId !== 'string')
		return res.status(400).render('eo_demandi-pri-tx', {
			errorMessage: 'Malvalida identigilo estis provizita.',
			tx: null
		});

	const tx = await transactionsCollection.findOne({ id: txId });
	if (!tx)
		return res.status(404).render('eo_demandi-pri-tx', {
			errorMessage: 'Transakcio ne troviĝis.',
			tx: null
		});
	return res.status(200).render('eo_demandi-pri-tx', { tx });
});

server.post('/eo/ensaluti', async (req, res) => {
	const { uzantnomo, tokeno } = req.body;

	if (await auth(uzantnomo, tokeno)) {
		const nonce = crypto.randomBytes(16).toString('base64');
		const session = `${uzantnomo}:${nonce}`;

		await cookiesCollection.insertOne({ username: uzantnomo, nonce });

		return res
			.status(302)
			.cookie('seanco', session, {
				httpOnly: true,
				secure: process.env.NODE_ENV === 'production',
				sameSite: 'lax'
			})
			.redirect('/eo/saldo-kaj-transakcioj');
	}

	const error = {
		code: 401,
		message:
			'Ensaluto estis rifuzita. Kontrolu vian kontan numeron kaj tokenon.'
	};
	return res.status(error.code).render('eo_ensaluti', { error });
});

server.post('/eo/transfiri-financon', async (req, res) => {
	const sessionCookie = req.cookies.seanco;
	const datetime = Date.now();
	const idempotencyNonce = req.body.idem;
	const payee = req.body.ricevanto;
	const amount = Number(Number(req.body.kvanto).toFixed(2));
	const purpose = req.body.kialo;

	if (!sessionCookie)
		return res.status(401).render('eo_tx-rezulto', {
			sourceAccount: '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Malvalida ensaluto.'
		});

	const [payer, nonce] = String(sessionCookie).split(':');
	const sessionDoc = await cookiesCollection.findOne({
		username: payer,
		nonce
	});
	const payeeUser = await usersCollection.findOne({ username: payee });
	const amountIsNAN = Number.isNaN(amount);
	const amountIsNegativeOrZero = amount <= 0;
	const payeeIsInvalid =
		typeof payee !== 'string' ||
		(onlyDigits(payee) ? !luhnCheck(payee) : payee !== 'admin');
	const isSelfTx = payer === payee;

	let errorMessage = '';

	if (amountIsNAN) errorMessage = 'La kvanto ne estas valida nombro.';
	if (amountIsNegativeOrZero)
		errorMessage = 'La kvanto devas pli alta ol nulo.';
	if (payeeIsInvalid) errorMessage = 'La ricevanta konto ne estas valida.';
	if (isSelfTx) errorMessage = 'Vi ne povas sendi monon al vi mem.';

	if (errorMessage)
		return res.status(400).render('eo_tx-rezulto', {
			sourceAccount: payer ?? '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage
		});

	const existingNonce = await idempotencyCollection.findOne({
		nonce: idempotencyNonce
	});
	if (existingNonce)
		return res.status(409).render('eo_tx-rezulto', {
			sourceAccount: payer ?? '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Provis refari transakcion.'
		});

	if (!payer || !nonce || !sessionDoc)
		return res.status(401).render('eo_tx-rezulto', {
			sourceAccount: payer ?? '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Malvalida ensaluto.'
		});

	if (!payeeUser)
		return res.status(404).render('eo_tx-rezulto', {
			sourceAccount: payer ?? '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Ne troviĝis ricevanta konto.'
		});

	const payerBalance = await calculateBalanceFromDB(payer);
	if (payer !== 'admin' && amount > payerBalance)
		return res.status(403).render('eo_tx-rezulto', {
			sourceAccount: payer ?? '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Nesufiĉa financo.'
		});

	const txId = crypto.randomUUID();
	const transactionDoc: Transaction = {
		id: txId,
		amount,
		payee,
		payer,
		purpose: purpose ?? '',
		status: 'approved',
		datetime,
		error: null
	};

	const session = client.startSession();
	try {
		await session.withTransaction(async () => {
			await usersCollection.updateOne(
				{ username: payer },
				{ $push: { transaction_ids: txId } as any },
				{ session }
			);
			await usersCollection.updateOne(
				{ username: payee },
				{ $push: { transaction_ids: txId } as any },
				{ session }
			);
			await transactionsCollection.insertOne(transactionDoc, { session });
		});

		await idempotencyCollection.insertOne({
			nonce: idempotencyNonce,
			createdAt: new Date()
		});

		return res.status(200).render('eo_tx-rezulto', {
			sourceAccount: payer ?? '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'approved',
			purpose,
			txId
		});
	} catch (err: any) {
		return res.status(500).render('eo_tx-rezulto', {
			sourceAccount: payer ?? '(nekonata)',
			destinationAccount: payee,
			amount,
			datetime,
			status: 'declined',
			txId: null,
			purpose,
			errorMessage: 'Interna eraro okazis dum la transakcio.'
		});
	} finally {
		await session.endSession();
	}
});

// Manejadores de errores genéricos (4xx y 5xx)
server.use((_, res) => {
	return res.status(404).render('er4xx', {
		errorMessage: 'Ĉi tiu paĝo ne ekzistas. / Esta página no existe.'
	});
});

server.use((_, res) => {
	return res.status(500).render('er5xx', {
		errorMessage: 'Interna eraro okazis. / Ocurrió un error interno.'
	});
});

// Inicialización de colecciones, índices TTL y arranque del servidor
(async function start() {
	try {
		client = new MongoClient(MONGO_URI);
		await client.connect();
		db = client.db(DB_NAME);

		usersCollection = db.collection('users');
		transactionsCollection = db.collection('transactions');
		cookiesCollection = db.collection('cookies');
		idempotencyCollection = db.collection('idempotency_keys');

		// Asegurar índices únicos y TTL
		await usersCollection.createIndex({ username: 1 }, { unique: true });
		await transactionsCollection.createIndex({ id: 1 }, { unique: true });
		await cookiesCollection.createIndex(
			{ username: 1, nonce: 1 },
			{ unique: true }
		);

		// Índice TTL: borra automáticamente los nonces de idempotencia a las 24 horas (86400 segundos)
		await idempotencyCollection.createIndex(
			{ createdAt: 1 },
			{ expireAfterSeconds: 86400 }
		);
		await idempotencyCollection.createIndex({ nonce: 1 }, { unique: true });

		console.log(
			'✅ MongoDB konektita, kolekto de sesioj kaj vivtempaj idempotencaj indeksoj sekuritaj.'
		);

		server.listen(port, () =>
			console.log(`Servilo preta ĉe: http://127.0.0.1:${port}`)
		);
	} catch (err) {
		console.error(
			'❌ Servilo malsukcese inicialigita / Iniciala konekta eraro:',
			err
		);
		process.exit(1);
	}
})();
