#!/bin/bash
# ╔══════════════════════════════════════════════════════╗
# ║       👻 PHANTOM BOT — INSTALLER TERMUX             ║
# ║       Lance ce script depuis Termux une seule fois  ║
# ╚══════════════════════════════════════════════════════╝

set -e  # Arrête le script en cas d'erreur

echo ""
echo "  👻  ╔══════════════════════════════════════╗"
echo "  ⚡  ║   PHANTOM BOT — INSTALLATION TERMUX  ║"
echo "  👻  ╚══════════════════════════════════════╝"
echo ""

# ── 1. Accès stockage Termux ─────────────────────────────────
echo "📂 [1/7] Demande d'accès au stockage..."
termux-setup-storage
sleep 2

# ── 2. Mise à jour Termux ────────────────────────────────────
echo "🔄 [2/7] Mise à jour de Termux..."
pkg update -y && pkg upgrade -y

# ── 3. Dépendances système ───────────────────────────────────
echo "📦 [3/7] Installation de Node.js, Python, ffmpeg et outils de compilation..."
pkg install -y nodejs python ffmpeg git make clang binutils

# ── 4. Installer yt-dlp via pip ─────────────────────────────
echo "📥 [4/7] Installation de yt-dlp..."
pip install -U yt-dlp

# ── 5. Préparation du dossier ──────────────────────────────────
echo "📁 [5/7] Configuration du dossier de travail..."
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "✅ Dossier actuel détecté : $BOT_DIR"
cd "$BOT_DIR"

# ── 6. Installer les modules npm ─────────────────────────────
echo "📦 [6/7] Installation des modules Node.js..."

# Sur Termux, certains modules avec compilation native (C++) échouent souvent
# On force l'ignorance des scripts postinstall et on saute les deps optionnelles
export npm_config_build_from_source=true
npm install --ignore-scripts --no-audit --no-fund --omit=optional

echo ""
echo "  👻  ╔══════════════════════════════════════╗"
echo "  ⚡  ║   ✅  INSTALLATION TERMINÉE !         ║"
echo "  ⚡  ║   Lance : node index.js               ║"
echo "  👻  ╚══════════════════════════════════════╝"
echo ""
echo "💡 Pour lancer le bot automatiquement :"
echo "   cd ~/PhantomBot && node index.js"
echo ""

# ── 7. Lancer le bot ─────────────────────────────────────────
read -p "🚀 [7/7] Lancer le bot maintenant ? (o/n) : " LAUNCH
if [ "$LAUNCH" = "o" ] || [ "$LAUNCH" = "O" ]; then
    echo "⚡ I'M GOING GHOST ! Lancement de Phantom Bot..."
    node index.js
fi
