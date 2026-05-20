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
echo "📦 [3/7] Installation de Node.js, Python, ffmpeg..."
pkg install -y nodejs python ffmpeg git

# ── 4. Installer yt-dlp via pip ─────────────────────────────
echo "📥 [4/7] Installation de yt-dlp..."
pip install -U yt-dlp

# ── 5. Copier les fichiers du bot ────────────────────────────
echo "📁 [5/7] Copie des fichiers du bot..."
BOT_DIR="$HOME/PhantomBot"

if [ -d "$BOT_DIR" ]; then
    echo "⚠️  Le dossier $BOT_DIR existe déjà. Mise à jour..."
    rm -rf "$BOT_DIR"
fi

# Copie depuis le stockage (place le dossier Phantom-Termux dans Téléchargements)
if [ -d "$HOME/storage/downloads/Phantom-Termux" ]; then
    cp -r "$HOME/storage/downloads/Phantom-Termux" "$BOT_DIR"
    echo "✅ Fichiers copiés depuis les Téléchargements."
else
    echo "❌ ERREUR : Dossier 'Phantom-Termux' introuvable dans Téléchargements."
    echo "   → Copie le dossier du bot dans ton dossier Téléchargements d'abord !"
    exit 1
fi

# ── 6. Installer les modules npm ─────────────────────────────
echo "📦 [6/7] Installation des modules Node.js..."
cd "$BOT_DIR"

# Sur Termux, wa-sticker-formatter peut échouer sur ARM
# On tente l'install normale, et on catch l'erreur de sharp si elle arrive
npm install --ignore-scripts 2>/dev/null || npm install

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
