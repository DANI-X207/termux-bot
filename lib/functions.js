const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const path = require('path');

// ── Clé API Groq ──────────────────────────────────────────────────────────────
let GROQ_KEY = process.env.GROQ_API_KEY;
try {
    const apiKeyPath = path.join(__dirname, '..', 'api.txt');
    if (fs.existsSync(apiKeyPath)) {
        GROQ_KEY = fs.readFileSync(apiKeyPath, 'utf8').trim();
    }
} catch (e) {
    console.error("Erreur de lecture api.txt:", e.message);
}
if (!GROQ_KEY) GROQ_KEY = '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';

// ── Catalogue des modèles Groq ────────────────────────────────────────────────
// aliases : noms courts acceptés pour appeler le modèle
const GROQ_MODELS = {
    'llama8b': {
        id:      'llama-3.1-8b-instant',
        label:   'Llama 3.1 8B',
        desc:    'Ultra-rapide et léger — parfait pour questions simples',
        aliases: ['8b', 'fast', 'rapide', 'l8'],
    },
    'llama70b': {
        id:      'llama-3.3-70b-versatile',
        label:   'Llama 3.3 70B',
        desc:    'Puissant & polyvalent — meilleure qualité de réponse',
        aliases: ['70b', 'pro', 'l70', 'big'],
    },
    'llama4': {
        id:      'meta-llama/llama-4-scout-17b-16e-instruct',
        label:   'Llama 4 Scout 17B',
        desc:    'Dernière génération Meta — intelligent et optimisé',
        aliases: ['l4', 'scout', 'llama4', 'meta'],
    },
    'qwen3': {
        id:      'qwen/qwen3-32b',
        label:   'Qwen 3 32B',
        desc:    'Excellent en logique, code et maths',
        aliases: ['qwen', 'q3', 'code', 'math'],
    },
    'gpt20b': {
        id:      'openai/gpt-oss-20b',
        label:   'GPT OSS 20B',
        desc:    'Le modèle Open Source d\'OpenAI — créatif et rapide',
        aliases: ['gpt', 'gpt20', 'openai'],
    },
    'gpt120b': {
        id:      'openai/gpt-oss-120b',
        label:   'GPT OSS 120B',
        desc:    'Modèle massif d\'OpenAI — raisonnement profond',
        aliases: ['gpt120', 'genius', 'ultra', 'max'],
    },
    'compound': {
        id:      'groq/compound',
        label:   'Compound',
        desc:    'Agent Groq multi-étapes natif',
        aliases: ['comp', 'multi', 'beta', 'agent'],
    },
};

// ── Table de résolution d'alias → clé principale ─────────────────────────────
// Construite automatiquement depuis GROQ_MODELS pour éviter les doublons
const MODEL_ALIAS_MAP = {};
for (const [key, entry] of Object.entries(GROQ_MODELS)) {
    MODEL_ALIAS_MAP[key] = key; // la clé elle-même est valide
    for (const alias of (entry.aliases || [])) {
        MODEL_ALIAS_MAP[alias] = key;
    }
}

/**
 * Résout un alias ou une clé en clé principale du modèle.
 * Ex: '70b' → 'llama70b', 'think' → 'deepseek'
 * Retourne null si inconnu.
 */
const resolveModel = (input) => MODEL_ALIAS_MAP[input?.toLowerCase()] || null;

// ── Gestion du modèle par défaut ──────────────────────────────────────────────
const defaultModelPath = path.join(__dirname, '..', 'default_model.txt');
let currentModelKey = 'llama8b'; // par défaut
try {
    if (fs.existsSync(defaultModelPath)) {
        currentModelKey = fs.readFileSync(defaultModelPath, 'utf8').trim();
    }
} catch (e) {}

const getDefaultModelKey = () => currentModelKey;
const setDefaultModelKey = (key) => {
    currentModelKey = key;
    try { fs.writeFileSync(defaultModelPath, key); } catch (e) {}
};

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = [
    'Tu es Phantom Bot, un assistant WhatsApp au style Danny Phantom.',
    'Réponds TOUJOURS en français, de façon COURTE et DIRECTE.',
    'Si c\'est une traduction : donne juste le mot + un exemple d\'utilisation.',
    'Si c\'est du code : donne un exemple court et fonctionnel.',
    'Si c\'est une définition ou un concept : explique en 2-3 phrases max.',
    'Pour les faits simples : une seule phrase suffit.',
    'N\'utilise pas de ** ni de ## ni de markdown complexe.',
    'Maximum 10 lignes de réponse.'
].join(' ');

// ── Appel central Groq (modèle dynamique) ────────────────────────────────────
const _callGroq = async (messages, model = GROQ_MODELS[currentModelKey]?.id || 'llama-3.1-8b-instant', maxTokens = 400) => {
    if (!GROQ_KEY || GROQ_KEY === 'METS_TA_CLÉ_GROQ_ICI') return null;
    try {
        const { data } = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            { model, max_tokens: maxTokens, messages },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );
        return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) {
        console.error(`[Groq:${model}] Erreur :`, e.response?.data || e.message);
        return null;
    }
};

/**
 * Pose une question simple à Groq avec le modèle par défaut actuel.
 * @returns {{ answer: string|null, modelLabel: string }}
 */
const askAI = async (question) => {
    const entry = GROQ_MODELS[currentModelKey] || GROQ_MODELS['llama8b'];
    const answer = await _callGroq([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: question }
    ], entry.id, 400);
    return { answer, modelLabel: entry.label };
};

/**
 * Envoie un historique complet à Groq (mode Alive) avec le modèle par défaut.
 * @param {Array<{role, content}>} history
 * @returns {Promise<{ answer: string|null, modelLabel: string }>}
 */
const askAIWithHistory = async (history) => {
    const entry = GROQ_MODELS[currentModelKey] || GROQ_MODELS['llama8b'];
    const answer = await _callGroq([
        { role: 'system', content: SYSTEM_PROMPT },
        ...history
    ], entry.id, 500);
    return { answer, modelLabel: entry.label };
};

/**
 * Pose une question à Groq avec un modèle spécifique (alias ou clé principale).
 * @param {string} question  - La question posée
 * @param {string} modelKey  - Clé principale (ex: 'llama70b') déjà résolue
 * @returns {{ answer: string|null, modelUsed: string, modelLabel: string }}
 */
const askAIWithModel = async (question, modelKey) => {
    const entry   = GROQ_MODELS[modelKey];
    const modelId = entry ? entry.id : modelKey;
    const label   = entry ? entry.label : modelKey;
    const answer  = await _callGroq([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: question }
    ], modelId, 600);
    return { answer, modelUsed: modelId, modelLabel: label };
};

/**
 * Fallback DuckDuckGo si l'IA échoue.
 */
const duckSearch = async (query) => {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PhantomBot/2.0)' },
            timeout: 8000
        });

        const results = [];
        if (data.AbstractText && data.AbstractURL) {
            results.push({ title: data.Heading || query, link: data.AbstractURL, snippet: data.AbstractText });
        }
        for (const topic of (data.RelatedTopics || [])) {
            if (results.length >= 3) break;
            if (topic.Text && topic.FirstURL)
                results.push({ title: topic.Text.slice(0, 60), link: topic.FirstURL, snippet: topic.Text });
            for (const sub of (topic.Topics || [])) {
                if (results.length >= 3) break;
                if (sub.Text && sub.FirstURL)
                    results.push({ title: sub.Text.slice(0, 60), link: sub.FirstURL, snippet: sub.Text });
            }
        }
        if (results.length === 0) {
            results.push({
                title: `Recherche : "${query}"`,
                link: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                snippet: 'Voir les résultats complets en ligne.'
            });
        }
        return results;
    } catch (e) {
        console.error('[duckSearch] Erreur :', e.message);
        return null;
    }
};

/**
 * Recherche YouTube — retourne la première vidéo trouvée.
 */
const youtubeSearch = async (query) => {
    try {
        const result = await yts(query);
        const videos = result.videos;
        if (!videos?.length) return null;
        const v = videos[0];
        return {
            title: v.title,
            url: v.url,
            thumbnail: v.thumbnail,
            timestamp: v.timestamp,
            author: v.author?.name || 'Inconnu'
        };
    } catch (e) {
        console.error('[youtubeSearch] Erreur :', e.message);
        return null;
    }
};

module.exports = {
    GROQ_KEY,
    GROQ_MODELS,
    resolveModel,
    getDefaultModelKey,
    setDefaultModelKey,
    askAI,
    askAIWithHistory,
    askAIWithModel,
    duckSearch,
    youtubeSearch
};
