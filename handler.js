const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { askAI, askAIWithHistory, askAIWithModel, GROQ_MODELS, resolveModel, duckSearch, youtubeSearch, getDefaultModelKey, setDefaultModelKey } = require('./lib/functions');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);

// ── Chemin vers yt-dlp (cross-platform : Windows = .exe, Linux/Termux = binaire système) ──
const os = require('os');
const YTDLP_PATH = (() => {
    // Sur Windows, utilise le binaire embarqué dans youtube-dl-exec
    if (os.platform() === 'win32') {
        return path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
    }
    // Sur Linux/Termux, yt-dlp est installé via pip et accessible dans le PATH
    const termuxBin = '/data/data/com.termux/files/usr/bin/yt-dlp';
    if (fs.existsSync(termuxBin)) return termuxBin;
    return 'yt-dlp'; // Fallback : cherche dans le PATH système
})();

let botActive = true;
let currentPrefix = '.'; // Préfixe par défaut
// ── Système d'autorisation ─────────────────────────────────────────────────────
// Numéros autorisés à exécuter des commandes (en dehors du propriétaire/bot)
const authorizedNumbers = new Set();

// Convertit un numéro brut (ex: +33612345678) en JID WhatsApp
function toJid(rawNumber) {
    const clean = rawNumber.replace(/[^\d]/g, ''); // retire +, espaces, tirets
    return clean + '@s.whatsapp.net';
}

// Normalise un JID Baileys : retire le suffixe de device (:2, :0, etc.)
// Ex: '242050271841:2@s.whatsapp.net' → '242050271841@s.whatsapp.net'
function normalizeJid(jid) {
    if (!jid) return jid;
    return jid.replace(/:\d+@/, '@');
}


// ── Mode Groq Alive (IA suit la conversation) ────────────────────────────────
// groqAliveChats : Set des JIDs où le mode alive est actif
// groqHistory    : Map<jid, Array<{role, content}>> — historique par chat
const groqAliveChats = new Set();
const groqHistory = new Map();
const HISTORY_LIMIT = 20; // nombre max de messages (user+assistant) conservés

// ── Nettoyage horaire : évite la fuite mémoire si .groq dead n'est jamais tapé
setInterval(() => {
    for (const jid of groqHistory.keys()) {
        if (!groqAliveChats.has(jid)) groqHistory.delete(jid);
    }
}, 60 * 60 * 1000); // toutes les heures

// Mots-clés qui signalent qu'un message mérite une réponse de l'IA
const QUESTION_PATTERNS = [
    /\?/,                                              // point d'interrogation
    /^(c'est quoi|qu'est[-\s]ce|pourquoi|comment|quand|où|qui|combien|est[-\s]ce|tu peux|tu sais|explique|dis[-\s]moi|parle[-\s]moi|c'est quoi|keskon|kske|kc|kv|c kwa|c koi)/i,
    /\b(aide|help|info|définis|signifie|veut dire|traduction|traduis|calcul|fait combien)\b/i
];

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];

// ── Média du menu (Image, Vidéo ou GIF) ──────────────────────────────────────
function loadDanyMedia() {
    try {
        const imgDir = path.join(__dirname, 'img');
        if (!fs.existsSync(imgDir)) return null;
        
        // Trouver tous les fichiers qui commencent par "dany"
        const files = fs.readdirSync(imgDir).filter(f => f.toLowerCase().startsWith('dany'));
        if (files.length === 0) return null;
        
        // Choisir un fichier au hasard (pour alterner de temps en temps)
        const file = files[Math.floor(Math.random() * files.length)];
        const ext = path.extname(file).toLowerCase();
        
        return {
            buffer: fs.readFileSync(path.join(imgDir, file)),
            isVideo: ext === '.mp4',
            isGif: ext === '.gif'
        };
    } catch (_) { return null; }
}

// ── Extraction média (vue unique ouverte ou non) ──────────────────────────────
function extractMedia(quoted) {
    if (!quoted || typeof quoted !== 'object') return null;
    for (const voKey of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
        const inner = quoted[voKey]?.message;
        if (inner) {
            for (const mk of MEDIA_KEYS) {
                if (inner[mk]) return { mediaMessage: inner[mk], mediaType: mk.replace('Message', '') };
            }
        }
    }
    for (const mk of MEDIA_KEYS) {
        if (quoted[mk]) return { mediaMessage: quoted[mk], mediaType: mk.replace('Message', '') };
    }
    const eph = quoted.ephemeralMessage?.message;
    if (eph) return extractMedia(eph);
    return null;
}

// ── Disponibilité de ffmpeg (cherche dans le dossier local et dans le PATH système) ─────────
const HAS_FFMPEG = (() => {
    if (os.platform() === 'win32') return fs.existsSync(path.join(__dirname, 'ffmpeg.exe'));
    // Sur Linux/Termux, ffmpeg est installé via pkg dans le PATH
    const termuxFfmpeg = '/data/data/com.termux/files/usr/bin/ffmpeg';
    if (fs.existsSync(termuxFfmpeg)) return true;
    const linuxFfmpeg = '/usr/bin/ffmpeg';
    if (fs.existsSync(linuxFfmpeg)) return true;
    return false;
})();

// ── Télécharge la vidéo YouTube via yt-dlp ───────────────────────────────────
async function downloadYoutubeVideo(query) {
    const play = require('play-dl');
    const youtubedl = require('youtube-dl-exec');
    const os = require('os');

    const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!results || results.length === 0) throw new Error('Aucun résultat trouvé');

    const video = results[0];
    console.log(`👻 [DVID] Trouvé : ${video.title} | HAS_FFMPEG=${HAS_FFMPEG}`);

    const tmpBase = path.join(os.tmpdir(), `phantom_vid_${Date.now()}`);
    const tmpFile = tmpBase + '.mp4';

    const args = [
        video.url,
        '--output', tmpFile,
        '--no-playlist',
        '--no-check-certificates',
        '--limit-rate', '2M',
        '--extractor-args', 'youtube:player_client=android,web',
        '--add-header', 'referer:youtube.com',
        '--add-header', 'user-agent:Mozilla/5.0',
        '--format', 'mp4[height<=360]/mp4[height<=480]/best[ext=mp4]/best'
    ];

    await execFile(YTDLP_PATH, args);

    // 2. Cherche le fichier téléchargé (yt-dlp peut changer l'extension)
    let finalFile = tmpFile;
    if (!fs.existsSync(finalFile)) {
        const tmpDir = os.tmpdir();
        const ts = path.basename(tmpBase).replace('phantom_vid_', '');
        const found = fs.readdirSync(tmpDir).find(f => f.includes(`phantom_vid_${ts}`));
        if (found) finalFile = path.join(tmpDir, found);
        else throw new Error('Fichier vidéo introuvable après téléchargement');
    }

    // 3. Vérifie la taille (WhatsApp limite à ~100MB)
    const stats = fs.statSync(finalFile);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > 95) {
        fs.unlinkSync(finalFile);
        throw new Error(`Fichier trop lourd (${Math.round(sizeMB)}MB). Essaie un clip plus court.`);
    }

    const buffer = fs.readFileSync(finalFile);
    try { fs.unlinkSync(finalFile); } catch (_) { }

    return {
        buffer,
        title: video.title,
        author: video.channel?.name || 'Inconnu',
        duration: video.durationRaw,
        url: video.url,
        sizeMB: Math.round(sizeMB)
    };
}

// ── Télécharge un média Baileys en Buffer ────────────────────────────────────
async function downloadMedia(mediaMessage, mediaType) {
    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

// ── Recherche + Télécharge l'audio YouTube via yt-dlp ────────────────────────
async function downloadYoutubeAudio(query) {
    const play = require('play-dl');
    const os = require('os');

    // 1. Recherche jusqu'à 3 résultats via play-dl (pour avoir des alternatives)
    let candidates = [];
    try {
        const results = await play.search(query, { source: { youtube: 'video' }, limit: 3 });
        if (results && results.length > 0) candidates = results;
    } catch (searchErr) {
        console.error('[DAUDIO] play-dl search failed:', searchErr.message);
    }

    if (candidates.length === 0) throw new Error('Aucun résultat trouvé pour : ' + query);

    // 2. Essaie chaque candidat jusqu'à ce qu'un téléchargement réussisse
    let lastErr = null;
    for (const video of candidates) {
        console.log(`👻 [DAUDIO] Essai : ${video.title} | ${video.url}`);

        const tmpBase = path.join(os.tmpdir(), `phantom_${Date.now()}`);
        const tmpFile = tmpBase + '.mp4';

        try {
            const args = [
                video.url,
                '--output', tmpFile,
                '--no-playlist',
                '--no-check-certificates',
                '--limit-rate', '2M',
                '--add-header', 'referer:youtube.com',
                '--add-header', 'user-agent:Mozilla/5.0',
                '--format', 'mp4[height<=360]/mp4[height<=480]/best[ext=mp4]/bestaudio[ext=m4a]/best'
            ];

            await execFile(YTDLP_PATH, args);

            // Cherche le fichier téléchargé
            let finalFile = tmpFile;
            if (!fs.existsSync(finalFile)) {
                const tmpDir = os.tmpdir();
                const ts = path.basename(tmpBase).replace('phantom_', '');
                const found = fs.readdirSync(tmpDir).find(f => f.includes(`phantom_${ts}`));
                if (found) finalFile = path.join(tmpDir, found);
                else throw new Error('Fichier audio introuvable après téléchargement');
            }

            const buffer = fs.readFileSync(finalFile);
            try { fs.unlinkSync(finalFile); } catch (_) { }

            return {
                buffer,
                mimetype: 'audio/mp4',
                title: video.title || query,
                author: video.channel?.name || 'Inconnu',
                duration: video.durationRaw || '?'
            };

        } catch (dlErr) {
            lastErr = dlErr;
            console.error(`[DAUDIO] Échec pour ${video.url} :`, dlErr.message);
            // On nettoie le fichier temporaire si créé
            try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) { }
            // On essaie le candidat suivant
        }
    }

    throw new Error(lastErr?.message || 'Tous les résultats ont échoué');
}

// ════════════════════════════════════════════════════════════════════════════
module.exports = async (sock, m) => {
    const msg = m.messages[0];
    const from = msg?.key?.remoteJid;

    // console.log(`[DEBUG] handler appelé pour ${from}. msg.message présent ? ${!!msg?.message}`);

    try {
        if (!msg?.message) return;

        const myJid = sock.user ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : '';
        const botId = sock.user ? sock.user.id.replace(/:\d+@/, '@') : (sock.sessionName || 'default');
        const globalSessionId = botId + '_' + from;

        // ── Extraction robuste du texte ───────────────────────────────────
        // Fonction récursive pour trouver le texte dans n'importe quel wrapper
        function extractBody(m) {
            if (!m) return '';
            // Dépaqueter les wrappers courants
            if (m.ephemeralMessage) return extractBody(m.ephemeralMessage.message);
            if (m.viewOnceMessageV2) return extractBody(m.viewOnceMessageV2.message);
            if (m.documentWithCaptionMessage) return extractBody(m.documentWithCaptionMessage.message);

            if (m.conversation) return m.conversation;
            if (m.extendedTextMessage) return m.extendedTextMessage?.text || '';
            if (m.imageMessage) return m.imageMessage?.caption || '';
            if (m.videoMessage) return m.videoMessage?.caption || '';
            if (m.documentMessage) return m.documentMessage?.caption || ''; // document simple sans wrapper
            if (m.audioMessage) return '';
            if (m.buttonsResponseMessage) return m.buttonsResponseMessage?.selectedButtonId || '';
            if (m.listResponseMessage) return m.listResponseMessage?.singleSelectReply?.selectedRowId || '';
            return '';
        }

        const body = extractBody(msg.message);
        console.log(`[DEBUG] body extrait : "${body}"`);
        if (!body) return;

        // ── Interception des messages en mode Groq Alive ──────────────────
        // Ce bloc doit être AVANT le filtre commandes
        if (!body.startsWith(currentPrefix) && groqAliveChats.has(globalSessionId)) {
            const text = body.trim();
            const wordCount = text.split(/\s+/).length;
            const isQuestion = wordCount >= 2 && QUESTION_PATTERNS.some(p => p.test(text));
            if (isQuestion) {
                if (!groqHistory.has(globalSessionId)) groqHistory.set(globalSessionId, []);
                const hist = groqHistory.get(globalSessionId);
                hist.push({ role: 'user', content: text });
                const { answer: reply, modelLabel } = await askAIWithHistory(hist);
                if (reply) {
                    hist.push({ role: 'assistant', content: reply });
                    if (hist.length > HISTORY_LIMIT) hist.splice(0, hist.length - HISTORY_LIMIT);
                    await sock.sendMessage(from, { text: `👻 [${modelLabel}] ${reply}` });
                }
            }
            return;
        }

        // Filtre : seules les commandes (débutant par le préfixe configuré) sont traitées après
        if (!body.startsWith(currentPrefix)) return;

        const parts = body.trim().split(/ +/);
        const command = parts.shift().slice(currentPrefix.length).toLowerCase();
        const query = parts.join(' ');

        console.log(`👻 [PHANTOM] ${currentPrefix}${command}${query ? ' | ' + query : ''}`);

        // ── Vérification des droits d'exécution ──────────────────────────────
        // myJid (propriétaire) = toujours autorisé
        const rawSender = msg.key.fromMe ? myJid : (msg.key.participant || from);
        const senderJid = normalizeJid(rawSender);
        const normMyJid = normalizeJid(myJid);
        console.log(`🔑 [AUTH] sender=${senderJid} | owner=${normMyJid} | list=${[...authorizedNumbers].join(',') || '(vide)'}`);
        
        if (senderJid !== normMyJid && !authorizedNumbers.has(senderJid)) {
            // Silence absolu pour les utilisateurs non autorisés (évite les conflits entre bots)
            return;
        }

        if (command === 'setprefix') {
            if (!query) return sock.sendMessage(from, { text: `⚠️ *Préfixe manquant !*\n_Exemple : ${currentPrefix}setprefix !_` });
            if (query.length > 3) return sock.sendMessage(from, { text: '⚠️ *Le préfixe est trop long !* (3 caractères max)' });
            
            currentPrefix = query.trim();
            return sock.sendMessage(from, { text: `✅ *Préfixe modifié avec succès !*\n_Le nouveau préfixe est :_ *${currentPrefix}*` });
        }

        if (command === 'off') {
            botActive = false;
            return sock.sendMessage(from, { text: `🌑 *Phantom s'eclipse dans le Ghost Zone...*\n_Tape ${currentPrefix}on pour le réveiller._` });
        }
        if (command === 'on') {
            botActive = true;
            try {
                const onAnimPath = path.join(__dirname, 'img', 'on_anim.mp4');
                if (fs.existsSync(onAnimPath)) {
                    return sock.sendMessage(from, {
                        video: fs.readFileSync(onAnimPath),
                        caption: '⚡ *I\'M GOING GHOST !* 👻\n_Phantom Bot surgit de l\'ombre !_',
                        gifPlayback: true
                    });
                }
            } catch (_) {}
            return sock.sendMessage(from, { text: '⚡ *I\'M GOING GHOST !* 👻\n_Phantom Bot surgit de l\'ombre !_' });
        }
        if (!botActive) return;

        switch (command) {


            case 'auth': {
                const sub = query.trim().toLowerCase();

                // .auth clear - vide toute la liste
                if (sub === 'clear') {
                    authorizedNumbers.clear();
                    return sock.sendMessage(from, { text: '🚨 *Mise à jour spectrale !*\n_Tous les accès ont été réinitialisés. Seul le propriétaire peut utiliser le bot._' });
                }

                // .auth list — affiche les JIDs autorisés (brut pour debug)
                if (sub === 'list') {
                    if (authorizedNumbers.size === 0) {
                        return sock.sendMessage(from, { text: '📋 _Aucun numéro autorisé pour le moment._' });
                    }
                    const list = [...authorizedNumbers].map((j, i) => `${i + 1}. ${j}`).join('\n');
                    return sock.sendMessage(from, { text: `🛡️ *Autorisés :*\n${list}` });
                }

                // .auth - autorise la personne (en privé ou en répondant à son message en groupe)
                if (sub === '') {
                    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    let target = null;

                    if (quotedParticipant) {
                        target = normalizeJid(quotedParticipant);
                    } else if (!from.endsWith('@g.us')) {
                        target = normalizeJid(from);
                    }

                    if (!target) return sock.sendMessage(from, {
                        text: '⚠️ *Cible introuvable !*\n_En groupe, vous devez répondre au message de la personne pour l\'autoriser._'
                    });

                    if (target === normalizeJid(myJid)) return sock.sendMessage(from, {
                        text: '⚠️ *Impossible !* C\'est le numéro du bot.'
                    });

                    authorizedNumbers.add(target);
                    console.log(`✅ [AUTH here] Ajout JID : ${target}`);
                    return sock.sendMessage(from, {
                        text: [
                            '✅ *Accès accordé !*',
                            `_ID autorisé : ${target}_`,
                            '',
                            '👻 _Ce contact peut maintenant utiliser les commandes Phantom._'
                        ].join('\n')
                    });
                }

                // Commande inconnue pour .auth
                return sock.sendMessage(from, {
                    text: [
                        '⚠️ *Usage :*',
                        '  *.auth* — Autorise ce contact (réponds à son message en groupe)',
                        '  *.auth list* — Voir les accès actifs',
                        '  *.auth clear* — Réinitialiser tous les accès'
                    ].join('\n')
                });
            }

            // ── RET ───────────────────────────────────────────────────────
            case 'ret': {
                const sub = query.trim().toLowerCase();

                // .ret - retire la personne (en privé ou en répondant à son message en groupe)
                if (sub === '') {
                    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    let target = null;

                    if (quotedParticipant) {
                        target = normalizeJid(quotedParticipant);
                    } else if (!from.endsWith('@g.us')) {
                        target = normalizeJid(from);
                    }

                    if (!target) return sock.sendMessage(from, {
                        text: '⚠️ *Cible introuvable !*\n_En groupe, vous devez répondre au message de la personne pour lui retirer ses droits._'
                    });

                    const existed = authorizedNumbers.delete(target);
                    const remaining = [...authorizedNumbers].join('\n') || '_Aucun_';
                    return sock.sendMessage(from, {
                        text: existed
                            ? `✅ *Accès retiré !*\n_Le JID ${target} n'est plus autorisé._\n\n📋 *Restants :*\n${remaining}`
                            : `ℹ️ _Ce contact (${target}) n'était pas dans la liste._`
                    });
                }

                // Commande inconnue pour .ret
                return sock.sendMessage(from, {
                    text: [
                        '⚠️ *Usage :*',
                        '  *.ret* — Retire ce contact (réponds à son message en groupe)'
                    ].join('\n')
                });
            }

            // ── HELP ─────────────────────────────────────────────────────
            case 'help': {
                const isDefaultSession = (sock.sessionName || 'default') === 'default';
                let menuArr = [
                    '╭─ 👻 *PHANTOM BOT*',
                    '│ ⚡ _Gardien du Ghost Zone_ ⚡',
                    '╰────────────── ✧',
                    '',
                    ' 🔮 *PORTAIL DU FANTÔME*',
                    ` ├ ⋆ *${currentPrefix}help* ➜ Ouvre ce portail`,
                    ` ├ ⋆ *${currentPrefix}setprefix* ➜ Changer le préfixe`,
                    ` ├ ⋆ *${currentPrefix}on* ➜ 🟢 Activer Phantom`,
                    ` ╰ ⋆ *${currentPrefix}off* ➜ 🔴 Mode veille`,
                    '',
                    ' 🛡️ *CONTRÔLE D\'ACCÈS*',
                    ` ├ ⋆ *${currentPrefix}auth* ➜ Autorise un contact`,
                    ` ├ ⋆ *${currentPrefix}ret* ➜ Retire les droits`,
                    ` ├ ⋆ *${currentPrefix}couple* ➜ 🔗 Lier une session`,
                    ` ├ ⋆ *${currentPrefix}uncouple* ➜ 💥 Détruire sa session`
                ];

                if (isDefaultSession) {
                    menuArr.push(` ╰ ⋆ *${currentPrefix}status* ➜ 📊 Sessions (Admin)`);
                } else {
                    menuArr[menuArr.length - 1] = menuArr[menuArr.length - 1].replace(' ├', ' ╰');
                }

                menuArr = menuArr.concat([
                    '',
                    ' 🌀 *DIMENSION SAVOIR*',
                    ` ├ ⋆ *${currentPrefix}groq* _<txt>_ ➜ IA directe`,
                    ` ├ ⋆ *${currentPrefix}groq alive* ➜ 🟢 Chat IA`,
                    ` ├ ⋆ *${currentPrefix}groq dead* ➜ 🔴 Stop Chat`,
                    ` ╰ ⋆ *${currentPrefix}model* _<alias> <q>_ ➜ 🧠 IA multi-modèle`,
                    '',
                    ' 🎨 *CRÉATION & MÉDIAS*',
                    ` ├ ⋆ *${currentPrefix}imagine* _<txt>_ ➜ Générer image`,
                    ` ├ ⋆ *${currentPrefix}play* _<titre>_ ➜ Aperçu`,
                    ` ├ ⋆ *${currentPrefix}daudio* _<titre>_ ➜ Audio YT`,
                    ` ╰ ⋆ *${currentPrefix}dvid* _<titre>_ ➜ Vidéo YT`,
                    '',
                    ' 👥 *MODÉRATION DE GROUPE*',
                    ` ├ ⋆ *${currentPrefix}kick* / *${currentPrefix}ban* ➜ Expulse`,
                    ` ├ ⋆ *${currentPrefix}promote* ➜ Nomme Admin`,
                    ` ╰ ⋆ *${currentPrefix}demote* ➜ Retire Admin`,
                    '',
                    ' 💀 *ARTEFACTS FANTÔMES*',
                    ` ├ ⋆ *${currentPrefix}save* ➜ Vole vue unique`,
                    ` ├ ⋆ *${currentPrefix}stick* ➜ Crée un sticker`,
                    ` ╰ ⋆ *${currentPrefix}gif* ➜ Crée un GIF`,
                    '',
                    ` 💡 *ASTUCE : ${currentPrefix}save*`,
                    ' ▹ 1. _Ouvre la vue unique_',
                    ' ▹ 2. _Réponds au message_',
                    ` ▹ 3. _Tape *${currentPrefix}save*_`,
                    '',
                    `『 👁️ _Préfixe : ${currentPrefix} | By Danny_ 』`
                ]);

                const menuTxt = menuArr.join('\n');
                const media = loadDanyMedia();
                if (media) {
                    if (media.isVideo || media.isGif) {
                        await sock.sendMessage(from, { 
                            video: media.buffer, 
                            caption: menuTxt,
                            gifPlayback: media.isGif
                        });
                    } else {
                        await sock.sendMessage(from, { 
                            image: media.buffer, 
                            caption: menuTxt 
                        });
                    }
                } else {
                    await sock.sendMessage(from, { text: menuTxt });
                }
                break;
            }


            // ── COUPLE (Multi-session) ──────────────────────────────────
            case 'couple': {
                if (senderJid !== normMyJid) return sock.sendMessage(from, { text: '💀 _Seul le maître du portail peut utiliser cette commande._' });
                
                const sessionName = 'phantom-' + Date.now();
                await sock.sendMessage(from, { text: '🌀 _Ouverture d\'un nouveau portail Fenton... Génération du QR Code en cours..._' });
                
                try {
                    const { startSession } = require('./index');
                    let qrEnvoye = false;
                    
                    startSession(sessionName, async (qr) => {
                        if (qrEnvoye) return; // Envoyer une seule fois
                        qrEnvoye = true;
                        
                        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=400&margin=2`;
                        await sock.sendMessage(from, {
                            image: { url: qrUrl },
                            caption: [
                                '👻 *NOUVELLE SESSION PHANTOM*',
                                '',
                                `ID : _${sessionName}_`,
                                '',
                                '📱 _Scanne ce QR Code depuis un autre appareil WhatsApp (Appareils connectés > Connecter un appareil) pour lier un nouveau numéro au bot._',
                                '',
                                '⏳ _Attention, le code expire vite !_'
                            ].join('\n')
                        });
                    });
                } catch (e) {
                    console.error(e);
                    await sock.sendMessage(from, { text: '💀 _Erreur ectoplasmique lors de la création du portail._' });
                }
                break;
            }
            // ── GROQ ─────────────────────────────────────────────────────
            case 'groq': {
                const subCmd = query.trim().toLowerCase();

                // ── .groq alive ───────────────────────────────────────────
                if (subCmd === 'alive') {
                    groqAliveChats.add(globalSessionId);
                    if (!groqHistory.has(globalSessionId)) groqHistory.set(globalSessionId, []);
                    return sock.sendMessage(from, {
                        text: [
                            '⚡ *Mode Specter Deflector activé ! (Groq Alive)* 👻',
                            '',
                            '_Je patrouille dans ce chat en invisible et je réponds à vos appels._',
                            '_Posez-moi une question directement sans commande !_',
                            '',
                            '🔴 Tape *.groq dead* pour me faire taire.'
                        ].join('\n')
                    });
                }

                // ── .groq dead ────────────────────────────────────────────
                if (subCmd === 'dead' || subCmd === 'off') {
                    groqAliveChats.delete(globalSessionId);
                    groqHistory.delete(globalSessionId); // Efface l'historique
                    return sock.sendMessage(from, {
                        text: '🔴 *Mode Specter Deflector désactivé.*\n_Je retourne dans mon thermos Fenton. Fini les réponses automatiques._'
                    });
                }

                // ── .groq reset ───────────────────────────────────────────
                if (subCmd === 'reset') {
                    groqHistory.delete(globalSessionId);
                    return sock.sendMessage(from, {
                        text: '🧠 *Mémoire ectoplasmique effacée !*\n_L\'IA repart de zéro pour cette conversation._'
                    });
                }

                // ── .groq <question> — mode question directe ─────────────
                if (!query) return sock.sendMessage(from, {
                    text: [
                        '🌀 *Thermos Fenton vide ! Il manque ta question !*',
                        'Usage : *.groq <ta question>*',
                        '',
                        'Sous-commandes :',
                        '  *.groq alive*  — Active la discussion automatique',
                        '  *.groq dead*   — Désactive la discussion',
                        '  *.groq reset*  — Efface la mémoire IA'
                    ].join('\n')
                });

                await sock.sendMessage(from, { text: '🔮 _Je passe à travers les murs de la Zone Fantôme pour trouver la réponse..._' });

                const { answer: aiAnswer, modelLabel } = await askAI(query);

                if (aiAnswer) {
                    await sock.sendMessage(from, {
                        text: [
                            `╔══ 🧠 *${modelLabel} RÉPOND*`,
                            `╠══ ❓ _${query}_`,
                            `╠══`,
                            `║ ${aiAnswer.replace(/\n/g, '\n║ ')}`,
                            `╚══════════════════════`,
                            `⚡ _Via le Portail Fenton_`
                        ].join('\n')
                    });
                } else {
                    const results = await duckSearch(query);
                    if (!results || !results.length) {
                        return sock.sendMessage(from, { text: '💀 _Mon sens fantôme ne détecte rien. Aucune trace dans la Zone Fantôme._' });
                    }
                    let text = `╔══ 🌀 *SCAN SPECTRAL : "${query}"*\n`;
                    results.slice(0, 3).forEach((res, i) => {
                        const num = ['1️⃣', '2️⃣', '3️⃣'][i];
                        text += `╠══\n║ ${num} *${res.title}*\n`;
                        if (res.snippet) text += `║ 👁️ _${res.snippet.slice(0, 120)}_\n`;
                        text += `║ 🔗 ${res.link}\n`;
                    });
                    text += `╚══════════════════════`;
                    await sock.sendMessage(from, { text });
                }
                break;
            }

            // ── PLAY ─────────────────────────────────────────────────────
            case 'play': {
                if (!query) return sock.sendMessage(from, {
                    text: '🎵 *Fréquence manquante !*\nUsage : *.play <titre>*'
                });
                await sock.sendMessage(from, { text: '👻 _Phantom capte les ondes de YouTube..._' });

                const vid = await youtubeSearch(query);
                if (vid) {
                    await sock.sendMessage(from, {
                        image: { url: vid.thumbnail },
                        caption: [
                            `🎵 *${vid.title}*`,
                            `👤 *Artiste :* ${vid.author}`,
                            `⏱️ *Durée :*  ${vid.timestamp}`,
                            `🔗 *Lien :*   ${vid.url}`,
                            ``,
                            `_💡 Tape_ *.daudio ${query}* _pour télécharger l'audio_`,
                            `_💡 Tape_ *.dvid ${query}* _pour télécharger la vidéo_`
                        ].join('\n')
                    });
                } else {
                    await sock.sendMessage(from, { text: '💀 _Signal perdu dans la Zone Fantôme. Aucune trace de cette vidéo._' });
                }
                break;
            }

            // ── DAUDIO ───────────────────────────────────────────────────
            case 'daudio': {
                if (!query) return sock.sendMessage(from, {
                    text: [
                        '🎵 *Titre manquant !*',
                        'Usage : *.daudio <titre> <artiste>*',
                        '',
                        '_Exemples :_',
                        '➜ .daudio Bella GIMS',
                        '➜ .daudio Hakari Zoro l\'frero',
                        '➜ .daudio Calm Down Rema',
                    ].join('\n')
                });

                await sock.sendMessage(from, { text: '🎵 _Phantom vole l\'audio depuis YouTube..._' });

                try {
                    const result = await downloadYoutubeAudio(query);
                    await sock.sendMessage(from, {
                        text: `🎵 _Envoi de :_ *${result.title}* par *${result.author}* _(${result.duration})_`
                    });
                    await sock.sendMessage(from, {
                        audio: result.buffer,
                        mimetype: result.mimetype, // mimetype dynamique selon le fichier réel
                        ptt: false
                    });
                } catch (dlErr) {
                    console.error('[DAUDIO ERROR]', dlErr.message);
                    await sock.sendMessage(from, {
                        text: [
                            '💀 _Ectoplasme bloqué ! Téléchargement impossible._',
                            '',
                            '💡 *Essaie avec titre + artiste :*',
                            `➜ *.daudio ${query} official*`,
                            `➜ *.daudio ${query} lyrics*`,
                        ].join('\n')
                    });
                }
                break;
            }

            // ── DVID ─────────────────────────────────────────────────────
            case 'dvid': {
                if (!query) return sock.sendMessage(from, {
                    text: [
                        '🎬 *Titre manquant !*',
                        'Usage : *.dvid <titre> <artiste>*',
                        '',
                        '_Fonctionne avec YouTube, TikTok,_',
                        '_Instagram, Facebook et plus..._',
                        '',
                        '_Exemples :_',
                        '➜ .dvid Bella GIMS clip officiel',
                        '➜ .dvid Hakari Zoro l\'frero',
                        '➜ .dvid <lien direct TikTok/Insta>',
                    ].join('\n')
                });

                await sock.sendMessage(from, { text: '🎬 _Je sors mon thermos Fenton pour capturer la vidéo depuis le Ghost Zone..._' });

                try {
                    // Si c'est un lien direct (TikTok, Instagram, Facebook...)
                    const isDirectUrl = query.startsWith('http://') || query.startsWith('https://');
                    let result;

                    if (isDirectUrl) {
                        // Téléchargement direct depuis l'URL
                        const youtubedl = require('youtube-dl-exec');
                        const os = require('os');
                        const tmpBase = path.join(os.tmpdir(), `phantom_vid_${Date.now()}`);
                        const tmpFile = tmpBase + '.mp4';

                        await youtubedl(query, {
                            // Format 18 supprimé par YouTube en 2024 → formats progressifs alternatifs
                            format: 'mp4[height<=360]/mp4[height<=480]/best[ext=mp4]/best',
                            output: tmpFile,
                            noPlaylist: true,
                            noCheckCertificates: true,
                            addHeader: ['user-agent:Mozilla/5.0'],
                        });

                        let finalFile = tmpFile;
                        if (!fs.existsSync(finalFile)) {
                            const found = fs.readdirSync(os.tmpdir()).find(f => f.includes(`phantom_vid_`));
                            if (found) finalFile = path.join(os.tmpdir(), found);
                            else throw new Error('Fichier introuvable');
                        }

                        const stats = fs.statSync(finalFile);
                        const sizeMB = stats.size / (1024 * 1024);
                        if (sizeMB > 95) {
                            fs.unlinkSync(finalFile);
                            throw new Error(`Fichier trop lourd (${Math.round(sizeMB)}MB)`);
                        }

                        const buffer = fs.readFileSync(finalFile);
                        try { fs.unlinkSync(finalFile); } catch (_) { }
                        result = { buffer, title: 'Vidéo', author: 'Lien direct', duration: '?', sizeMB: Math.round(sizeMB) };

                    } else {
                        // Recherche YouTube par titre
                        result = await downloadYoutubeVideo(query);
                    }

                    await sock.sendMessage(from, {
                        text: `🎬 _Envoi de :_ *${result.title}* par *${result.author}* _(${result.duration} | ${result.sizeMB}MB)_`
                    });
                    await sock.sendMessage(from, {
                        video: result.buffer,
                        mimetype: 'video/mp4',
                        caption: `🎬 *${result.title}* - *${result.author}* — 👻 _Phantom Bot_`
                    });

                } catch (dlErr) {
                    console.error('[DVID ERROR]', dlErr);
                    await sock.sendMessage(from, {
                        text: [
                            '💀 _Téléchargement vidéo impossible._',
                            '',
                            `⚠️ _Raison : ${dlErr.message}_`,
                            '',
                            '💡 *Essaie :*',
                            `➜ *.dvid ${query} clip officiel*`,
                            '➜ Colle directement le lien YouTube/TikTok',
                            '➜ Vérifie que la vidéo est publique',
                        ].join('\n')
                    });
                }
                break;
            }

            // ── STICK ────────────────────────────────────────────────────
            case 'stick':
            case 's': {
                const quotedForStick = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const imgMsg =
                    msg.message?.imageMessage ||
                    quotedForStick?.imageMessage;

                if (!imgMsg) {
                    return sock.sendMessage(from, {
                        text: [
                            '🖼️ *Aucune image trouvée !*',
                            '',
                            '💡 *Deux façons de créer un sticker :*',
                            '1️⃣ Envoie une photo avec *.stick* en légende',
                            '2️⃣ Réponds à une photo avec *.stick*',
                        ].join('\n')
                    });
                }

                await sock.sendMessage(from, { text: '👻 _Phantom forge un sticker spectral..._' });

                const imgBuffer = await downloadMedia(imgMsg, 'image');
                const sticker = new Sticker(imgBuffer, {
                    pack: '👻 Phantom Bot',
                    author: '⚡ Danny',
                    type: StickerTypes.FULL,
                    quality: 60
                });
                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(from, { sticker: stickerBuffer });
                break;
            }

            // ── GIF ──────────────────────────────────────────────────────
            case 'gif': {
                const quotedForGif = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const vidMsg =
                    msg.message?.videoMessage ||
                    quotedForGif?.videoMessage;

                if (!vidMsg) {
                    return sock.sendMessage(from, {
                        text: [
                            '🎬 *Aucune vidéo trouvée !*',
                            '',
                            '💡 *Deux façons de créer un GIF :*',
                            '1️⃣ Envoie une courte vidéo avec *.gif* en légende',
                            '2️⃣ Réponds à une vidéo avec *.gif*',
                            '',
                            '_Idéal pour les vidéos de moins de 10 secondes._'
                        ].join('\n')
                    });
                }

                await sock.sendMessage(from, { text: '🌀 _Phantom transforme la vidéo en GIF spectral..._' });

                const videoBuffer = await downloadMedia(vidMsg, 'video');
                await sock.sendMessage(from, {
                    video: videoBuffer,
                    gifPlayback: true,
                    mimetype: 'video/mp4',
                    caption: '👻 _GIF spectral by Phantom Bot_ ⚡'
                });
                break;
            }

            // ── SAVE ─────────────────────────────────────────────────────
            case 'save': {
                const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
                const quoted = ctxInfo?.quotedMessage;

                if (!quoted) {
                    return sock.sendMessage(from, {
                        text: [
                            '👻 *Fantôme introuvable !*',
                            '',
                            '〔 💡 *Comment voler un média vue unique* 〕',
                            '1️⃣  Ouvre le message vue unique',
                            '2️⃣  Appuie sur ↩️ *Répondre*',
                            '3️⃣  Tape *.save*',
                        ].join('\n')
                    });
                }

                try {
                    const safeLog = JSON.parse(JSON.stringify(quoted, (k, v) =>
                        (v instanceof Buffer || v?.type === 'Buffer') ? '<Buffer>' : v
                    ));
                    console.log('👻 [SAVE] Clés quoted:', Object.keys(safeLog));
                } catch (_) { }

                const found = extractMedia(quoted);

                if (!found) {
                    return sock.sendMessage(from, {
                        text: [
                            '💀 *Artefact introuvable dans ce message.*',
                            '',
                            '〔 💡 *Rappel* 〕',
                            '1️⃣  Ouvre le message vue unique',
                            '2️⃣  Appuie sur ↩️ *Répondre*',
                            '3️⃣  Tape *.save*',
                        ].join('\n')
                    });
                }

                const buffer = await downloadMedia(found.mediaMessage, found.mediaType);

                // Construit le payload correct selon le type de média
                let savePayload;
                const mimetype = found.mediaMessage?.mimetype || '';
                if (found.mediaType === 'sticker') {
                    savePayload = { sticker: buffer };
                } else if (found.mediaType === 'audio') {
                    savePayload = {
                        audio: buffer,
                        mimetype: mimetype || 'audio/ogg; codecs=opus',
                        ptt: false
                    };
                } else if (found.mediaType === 'image') {
                    savePayload = {
                        image: buffer,
                        mimetype: mimetype || 'image/jpeg',
                        caption: '👻 *Artefact spectral capturé — PHANTOM BOT* ⚡'
                    };
                } else if (found.mediaType === 'video') {
                    savePayload = {
                        video: buffer,
                        mimetype: mimetype || 'video/mp4',
                        caption: '👻 *Artefact spectral capturé — PHANTOM BOT* ⚡'
                    };
                } else {
                    savePayload = {
                        document: buffer,
                        mimetype: mimetype || 'application/octet-stream',
                        fileName: `phantom_save.${found.mediaType}`,
                        caption: '👻 *Artefact spectral capturé — PHANTOM BOT* ⚡'
                    };
                }

                await sock.sendMessage(myJid, savePayload);

                try {
                    const saveAnimPath = path.join(__dirname, 'img', 'save_anim.mp4');
                    if (fs.existsSync(saveAnimPath)) {
                        await sock.sendMessage(from, {
                            video: fs.readFileSync(saveAnimPath),
                            caption: '👀 *Cible acquise !*\n_L\'artefact a été sécurisé dans la Ghost Zone._ 👻',
                            gifPlayback: true
                        });
                    } else {
                        await sock.sendMessage(from, { text: '👀 *Cible acquise !*\n_L\'artefact a été sécurisé dans la Ghost Zone._ 👻' });
                    }
                } catch (_) {}

                break;
            }

            // ── MODEL ───────────────────────────────────────────────────
            case 'model': {
                const modelParts = query.trim().split(/ +/);
                const rawKey     = modelParts.shift().toLowerCase();
                const modelQuery = modelParts.join(' ');

                // ── .model sans argument → menu style .help ──────────────────────────
                if (!rawKey) {
                    const currentModel = GROQ_MODELS[getDefaultModelKey()];
                    const menu = [
                        '╭─ 🧠 *PHANTOM AI (Mode Fenton) — PORTAIL DES MODÈLES*',
                        '│ ⚡ _Ouvrez le portail vers la dimension mentale_ ⚡',
                        '╰────────────── ✧',
                        '',
                        ` 🎯 *Modèle actuel :* _${currentModel ? currentModel.label : 'Inconnu'}_`,
                        '',
                        ' 🔵 *LLAMA (Meta AI)*',
                        '',
                        ` ├ 🤖 *Llama 3.1 8B* — Ultra-rapide ⚡`,
                        `   │  🏷️ _Alias : *llama8b* • *8b* • *fast* • *rapide*_`,
                        `   │`,
                        ` ├ 🤖 *Llama 3.3 70B* — Puissant & polyvalent 🔥`,
                        `   │  🏷️ _Alias : *llama70b* • *70b* • *pro* • *big*_`,
                        `   │`,
                        ` ╰ 🤖 *Llama 4 Scout 17B* — Nouvelle gen Meta 🧠`,
                        `     🏷️ _Alias : *llama4* • *l4* • *scout* • *meta*_`,
                        '',
                        ' 🟣 *AUTRES MODÈLES*',
                        '',
                        ` ├ 🤖 *Qwen 3 32B* — Logique & Code (Alibaba) 💻`,
                        `   │  🏷️ _Alias : *qwen3* • *qwen* • *q3* • *code*_`,
                        `   │`,
                        ` ├ 🤖 *GPT OSS 20B* — Rapide & Créatif (OpenAI) 🎨`,
                        `   │  🏷️ _Alias : *gpt20b* • *gpt* • *gpt20* • *openai*_`,
                        `   │`,
                        ` ├ 🤖 *GPT OSS 120B* — Raisonnement profond 🔬`,
                        `   │  🏷️ _Alias : *gpt120b* • *gpt120* • *genius* • *ultra*_`,
                        `   │`,
                        ` ╰ 🤖 *Compound* — Agent multi-étapes 🤖`,
                        `     🏷️ _Alias : *compound* • *comp* • *beta* • *agent*_`,
                        '',
                        '╭────────────── 💡',
                        `│ *COMMENT UTILISER :*`,
                        `│ *${currentPrefix}model <alias>* pour changer de modèle`,
                        `│ *${currentPrefix}groq <question>* pour poser une question`,
                        '╰────────────── ✧',
                        '',
                        `『 🧠 _Phantom AI | ${Object.keys(GROQ_MODELS).length} modèles | By Danny_ 』`,
                    ].join('\r\n');

                    const media = loadDanyMedia();
                    if (media) {
                        if (media.isVideo || media.isGif) {
                            await sock.sendMessage(from, { video: media.buffer, caption: menu, gifPlayback: media.isGif });
                        } else {
                            await sock.sendMessage(from, { image: media.buffer, caption: menu });
                        }
                    } else {
                        await sock.sendMessage(from, { text: menu });
                    }
                    break;
                }

                // ── Résolution alias → clé principale ───────────────────────────
                const resolvedKey = resolveModel(rawKey);

                if (!resolvedKey) {
                    const allAliases = Object.entries(GROQ_MODELS)
                        .map(([k, e]) => `*${k}* (${e.aliases.slice(0,2).join(', ')})`)
                        .join(' | ');
                    return sock.sendMessage(from, {
                        text: [
                            `⚠️ *Modèle inconnu :* _${rawKey}_`,
                            '',
                            `💡 *Alias disponibles :*`,
                            allAliases,
                            '',
                            `_Tape *${currentPrefix}model* pour voir le menu complet._`
                        ].join('\n')
                    });
                }

                // Définition du modèle par défaut
                setDefaultModelKey(resolvedKey);
                const entry = GROQ_MODELS[resolvedKey];
                
                await sock.sendMessage(from, {
                    text: [
                        `✅ *Modèle par défaut mis à jour !*`,
                        '',
                        `🧠 *Nouveau modèle :* _${entry.label}_`,
                        `📊 _${entry.desc}_`,
                        '',
                        `💡 _Toutes les futures commandes *${currentPrefix}groq* (et le mode alive) utiliseront maintenant ce modèle._`
                    ].join('\n')
                });
                break;
            }

            
            // ── STATUS (Admin) ──────────────────────────────────────────
            case 'status': {
                if ((sock.sessionName || 'default') !== 'default') return;
                try {
                    const { activeSessions } = require('./index');
                    let statusTxt = '╭─ 📊 *GHOST ZONE — SESSIONS ACTIVES*\n│\n';
                    let count = 0;
                    for (const [key, val] of activeSessions.entries()) {
                        const isConnected = val && val.user;
                        const userNum = isConnected ? (val.user.id.split(':')[0]) : '?';
                        statusTxt += `│ 👻 *[${key}]*\n`;
                        statusTxt += `│   ▹ Numéro : +${userNum}\n`;
                        statusTxt += `│   ▹ Statut : ${isConnected ? '🟢 En Ligne' : '🔴 Hors Ligne'}\n│\n`;
                        count++;
                    }
                    statusTxt += `╰─ *Total :* ${count} fantôme(s) connecté(s)`;
                    return sock.sendMessage(from, { text: statusTxt });
                } catch (e) {
                    console.error('Erreur status:', e);
                    return sock.sendMessage(from, { text: '❌ Erreur de récupération du statut des portails.' });
                }
            }

            // ── UNCOUPLE (Déconnexion) ──────────────────────────────────
            case 'uncouple': {
                await sock.sendMessage(from, { text: '💥 _Destruction du portail... Déconnexion en cours..._' });
                try {
                    await sock.logout(); // Se déconnecter de WhatsApp
                    if (sock.sessionName && sock.sessionName !== 'default') {
                        const path = require('path');
                        const fsSync = require('fs');
                        const sessionDir = path.join(__dirname, 'sessions', sock.sessionName);
                        if (fsSync.existsSync(sessionDir)) {
                            fsSync.rmSync(sessionDir, { recursive: true, force: true });
                        }
                    }
                } catch (e) {
                    console.error('Erreur uncouple:', e);
                }
                break;
            }

            // ── MODÉRATION (Groupe) ─────────────────────────────────────
            case 'kick':
            case 'ban': {
                if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: '⚠️ _Cette commande ne s\'utilise que dans un groupe._' });
                const targetMsg = msg.message.extendedTextMessage?.contextInfo;
                if (!targetMsg) return sock.sendMessage(from, { text: '⚠️ _Réponds au message de la personne à expulser._' });
                const targetJid = targetMsg.participant || (targetMsg.mentionedJid && targetMsg.mentionedJid[0]);
                if (!targetJid) return sock.sendMessage(from, { text: '⚠️ _Impossible de trouver la cible._' });
                try {
                    await sock.groupParticipantsUpdate(from, [targetJid], "remove");
                    await sock.sendMessage(from, { text: '⚡ _BAM ! Fantôme expulsé dans le néant !_ 👻' });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ _Erreur : Je dois être Admin pour faire ça !_' });
                }
                break;
            }

            case 'promote': {
                if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: '⚠️ _Cette commande ne s\'utilise que dans un groupe._' });
                const targetMsg = msg.message.extendedTextMessage?.contextInfo;
                if (!targetMsg) return sock.sendMessage(from, { text: '⚠️ _Réponds au message de la personne à promouvoir._' });
                const targetJid = targetMsg.participant || (targetMsg.mentionedJid && targetMsg.mentionedJid[0]);
                if (!targetJid) return sock.sendMessage(from, { text: '⚠️ _Impossible de trouver la cible._' });
                try {
                    await sock.groupParticipantsUpdate(from, [targetJid], "promote");
                    await sock.sendMessage(from, { text: '🎖️ _Félicitations ! Ce fantôme devient Gardien (Admin)._' });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ _Erreur : Je dois être Admin pour faire ça !_' });
                }
                break;
            }

            case 'demote': {
                if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: '⚠️ _Cette commande ne s\'utilise que dans un groupe._' });
                const targetMsg = msg.message.extendedTextMessage?.contextInfo;
                if (!targetMsg) return sock.sendMessage(from, { text: '⚠️ _Réponds au message de la personne à rétrograder._' });
                const targetJid = targetMsg.participant || (targetMsg.mentionedJid && targetMsg.mentionedJid[0]);
                if (!targetJid) return sock.sendMessage(from, { text: '⚠️ _Impossible de trouver la cible._' });
                try {
                    await sock.groupParticipantsUpdate(from, [targetJid], "demote");
                    await sock.sendMessage(from, { text: '⏬ _Oups ! Ce Gardien a perdu ses pouvoirs (Admin retiré)._' });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ _Erreur : Je dois être Admin pour faire ça !_' });
                }
                break;
            }

            // ── IMAGINE (Création d'Image via Pollinations.ai) ──────────
            case 'imagine': {
                if (!query) return sock.sendMessage(from, { text: `⚠️ *Astuce !* Tape *${currentPrefix}imagine* suivi de ce que tu veux voir.\n_Exemple : ${currentPrefix}imagine un fantôme qui mange une pizza_` });
                await sock.sendMessage(from, { text: '🎨 _Matérialisation de l\'ectoplasme en cours... patiente..._' });
                try {
                    const axios = require('axios');
                    const encodedQuery = encodeURIComponent(query);
                    const seed = Math.floor(Math.random() * 1000000);
                    const imageUrl = `https://image.pollinations.ai/prompt/${encodedQuery}?seed=${seed}&width=1024&height=1024&nologo=true`;
                    
                    const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(res.data, 'binary');
                    
                    await sock.sendMessage(from, { 
                        image: buffer, 
                        caption: `👻 *Voici l'artefact demandé :*\n_"${query}"_`
                    });
                } catch (e) {
                    console.error('Erreur imagine:', e);
                    await sock.sendMessage(from, { text: '❌ _Erreur de matérialisation. La Zone Fantôme est instable._' });
                }
                break;
            }

            // ── DEFAULT ──────────────────────────────────────────────────
            default:
                await sock.sendMessage(from, {
                    text: `👻 *Erreur ectoplasmique ! Commande inconnue :* _${currentPrefix}${command}_\n⚡ Tape *${currentPrefix}help* pour voir le portail.`
                });
        }

    } catch (e) {
        console.error('💀 [PHANTOM ERROR]', e);
        try {
            if (from) await sock.sendMessage(from, { text: '⚠️ _Erreur spectrale :_ ' + e.message });
        } catch (_) { }
    }
};
