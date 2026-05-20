# 👻 Phantom Bot — Version Termux (Android)

Cette version est identique à la version PC, adaptée pour tourner sur **Termux** (Android).

---

## ⚡ Différences avec la version PC

| Élément | Version PC | Version Termux |
|---|---|---|
| `yt-dlp` | `.exe` embarqué dans `node_modules` | Installé via `pip install yt-dlp` |
| `ffmpeg` | `ffmpeg.exe` dans le dossier du bot | Installé via `pkg install ffmpeg` |
| Détection auto | ❌ | ✅ (`os.platform()`) |
| Stickers | ✅ | ⚠️ Peut nécessiter `--ignore-scripts` |

---

## 🚀 Installation (première fois)

### Étape 1 — Prépare les fichiers
Copie le dossier **`Phantom-Termux`** dans le dossier **Téléchargements** de ton téléphone.

### Étape 2 — Ouvre Termux et lance :
```bash
bash ~/storage/downloads/Phantom-Termux/install_termux.sh
```

Le script va automatiquement :
1. Demander l'accès au stockage
2. Mettre à jour Termux
3. Installer Node.js, Python, ffmpeg
4. Installer `yt-dlp` via pip
5. Copier les fichiers dans `~/PhantomBot`
6. Installer les modules npm
7. Proposer de lancer le bot

---

## 🔄 Mises à jour

Pour mettre à jour le bot après une modification :
```bash
# Copie la nouvelle version dans Téléchargements puis :
cp -r ~/storage/downloads/Phantom-Termux ~/PhantomBot
cd ~/PhantomBot
npm install
node index.js
```

---

## ▶️ Lancement manuel

```bash
cd ~/PhantomBot
node index.js
```

---

## 🔁 Lancement en arrière-plan (bot permanent)

Pour que le bot continue de tourner même quand Termux est en arrière-plan :

```bash
# Option 1 : nohup (simple)
cd ~/PhantomBot && nohup node index.js &

# Option 2 : avec pm2 (recommandé, avec redémarrage auto)
npm install -g pm2
pm2 start index.js --name "PhantomBot"
pm2 startup   # Pour démarrer au boot
pm2 save
```

---

## ⚠️ Problèmes fréquents

### Stickers (`.stick`) ne fonctionnent pas
`wa-sticker-formatter` dépend de `sharp` qui peut avoir des problèmes sur ARM. Essaie :
```bash
npm install --ignore-scripts
```

### `yt-dlp` introuvable
```bash
pip install -U yt-dlp
```

### Erreur de permissions sur le script
```bash
chmod +x install_termux.sh
```
