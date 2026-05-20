const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const handler = require('./handler');

// ── Gestion propre des erreurs pour éviter les crashs complets ───────────
process.on('uncaughtException', err => {
    console.error('💥 Erreur non interceptée :', err);
});
process.on('unhandledRejection', err => {
    console.error('💥 Rejet de promesse non intercepté :', err);
});

// Masquer les messages d'erreur liés au décryptage WhatsApp
const originalConsoleError = console.error;
console.error = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('Bad MAC') || msg.includes('decrypt') || msg.includes('Record Overflow')) return;
    originalConsoleError(...args);
};

const fs = require('fs');
const path = require('path');

const activeSessions = new Map();

async function startSession(sessionName, onQrReceived = null) {
    const sessionDir = path.join(__dirname, 'sessions', sessionName);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version }          = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        auth: state,
        browser: ['Phantom-Bot', 'Chrome', '3.0.0'],
    });

    const isDefault = sessionName === 'default';

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            if (onQrReceived) {
                onQrReceived(qr);
            } else if (isDefault) {
                console.clear();
                console.log('');
                console.log('  👻  ╔══════════════════════════════════════╗');
                console.log('  ⚡  ║        P H A N T O M   B O T        ║');
                console.log('  👻  ║     Scanne le QR code ci-dessous     ║');
                console.log('  ⚡  ╚══════════════════════════════════════╝');
                console.log('');
                qrcode.generate(qr, { small: true });
            }
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                if (isDefault) console.log(`🌀 Le portail s'est refermé pour ${sessionName}... Réouverture dans 5 secondes...`);
                setTimeout(() => startSession(sessionName, onQrReceived), 5000); 
            } else {
                console.log(`💀 Session ${sessionName} aspirée par le Thermos Fenton. Connexion révoquée.`);
                activeSessions.delete(sessionName);
            }
        }

        if (connection === 'open') {
            activeSessions.set(sessionName, sock);
            if (isDefault) {
                console.clear();
                console.log('');
                console.log('  👻  ╔══════════════════════════════════════╗');
                console.log("  ⚡  ║   I'M GOING GHOST !  PHANTOM BOT    ║");
                console.log('  👻  ║        ✅  Connecté & prêt !         ║');
                console.log('  ⚡  ╚══════════════════════════════════════╝');
                console.log('');
            }
            console.log(`✅ Session [${sessionName}] connectée avec succès !`);
        }
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', async m => {
        if (m.type !== 'notify') return;
        if (!m.messages || !m.messages[0]) return;
        const msg = m.messages[0];
        if (!msg.message) return;

        console.log(`[${sessionName}] 👻 [SENS FANTÔME] Message détecté de : ${msg.key.remoteJid}`);
        // Injecte le nom de la session pour la logique handler si besoin
        sock.sessionName = sessionName;
        await handler(sock, m);
    });
    
    return sock;
}

async function initAllSessions() {
    const sessionsPath = path.join(__dirname, 'sessions');
    if (!fs.existsSync(sessionsPath)) fs.mkdirSync(sessionsPath);
    
    const dirs = fs.readdirSync(sessionsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
        
    for (const dir of dirs) {
        startSession(dir);
    }
}

initAllSessions();

module.exports = { startSession, activeSessions };
