# 🚀 Guide de Déploiement Gratuit 24/7 (Phantom Bot)

Ce guide explique comment héberger Phantom Bot **gratuitement et 24h/24** en combinant 3 services : **MongoDB** (pour sauvegarder la session), **Render** (pour faire tourner le code) et **UptimeRobot** (pour empêcher la mise en veille).

---

## Étape 1 : Le Coffre-fort (MongoDB Atlas)
*Le but de cette étape est de créer une base de données cloud qui conservera votre connexion WhatsApp. Ainsi, si le serveur redémarre, vous n'aurez pas à rescanner le QR code.*

1. Allez sur **[MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)** et créez un compte gratuit.
2. Créez un **Cluster Gratuit (M0)**. (Laissez les paramètres par défaut, choisissez la région la plus proche).
3. **Créer un Utilisateur :**
   - Dans le menu de gauche, sous la section **SECURITY**, cliquez sur **Database Access**.
   - Cliquez sur **Add New Database User**.
   - Choisissez "Password" et définissez un nom d'utilisateur (ex: `phantom`) et un mot de passe (ex: `supermotdepasse123`). **Retenez bien ce mot de passe !**
   - Cliquez sur **Add User**.
4. **Autoriser Render à s'y connecter :**
   - Dans le menu de gauche, sous **SECURITY**, cliquez sur **Network Access**.
   - Cliquez sur **Add IP Address**.
   - Dans "Access List Entry", tapez exactement `0.0.0.0/0` (cela autorise n'importe quel serveur à s'y connecter).
   - Cliquez sur **Confirm** (patientez 1 minute que le statut devienne "Active").
5. **Récupérer le Lien Magique :**
   - Dans le menu de gauche, allez sur **Database > Clusters**.
   - Cliquez sur le bouton **Connect** à côté de votre cluster.
   - Choisissez **Drivers** (Node.js).
   - Copiez le lien qui s'affiche (qui ressemble à `mongodb+srv://phantom:<db_password>@cluster0...`).
   - Remplacez `<db_password>` par le vrai mot de passe que vous avez créé à l'étape 3. **Gardez ce lien précieux sous la main.**

---

## Étape 2 : Le Stockage du Code (GitHub)
*Render a besoin de lire votre code depuis un dépôt GitHub.*

1. Allez sur **[GitHub](https://github.com/)** et connectez-vous (ou créez un compte).
2. Cliquez sur le bouton **New** (ou le `+` en haut à droite) pour créer un nouveau **Repository** (Dépôt).
3. Donnez-lui un nom (ex: `PhantomBot`). Ne cochez rien d'autre et cliquez sur **Create repository**.
4. Cliquez sur le lien **"uploading an existing file"** (juste en dessous des lignes de code).
5. **Décompressez l'archive `PhantomBot.zip`** sur votre ordinateur, et glissez-déposez **tout le contenu** du dossier directement dans la page GitHub.
6. Cliquez sur le bouton vert **Commit changes** en bas. Votre code est en ligne !

---

## Étape 3 : Le Serveur (Render)
*C'est ici que le bot va s'exécuter.*

1. Allez sur **[Render.com](https://render.com/)** et créez un compte.
2. Cliquez sur **New +** en haut à droite, puis sélectionnez **Web Service**.
3. Connectez votre compte GitHub et sélectionnez le dépôt `PhantomBot` que vous venez de créer.
4. Laissez les configurations par défaut :
   - Build Command : `npm install`
   - Start Command : `npm start`
5. **L'étape la plus importante (Lier la base de données & l'IA) :**
   - Descendez la page et trouvez la section **Environment Variables**.
   - Cliquez sur **Add Environment Variable**.
   - Dans la case **Key**, tapez exactement : `MONGODB_URI`
   - Dans la case **Value**, **collez votre lien magique MongoDB** (celui avec le mot de passe intégré de l'Étape 1).
   - Cliquez à nouveau sur **Add Environment Variable** pour ajouter l'IA :
   - Dans la case **Key**, tapez exactement : `GROQ_API_KEY`
   - Dans la case **Value**, collez votre clé secrète Groq (qui commence par `gsk_...`).
6. Cliquez tout en bas sur **Create Web Service**.

Render va maintenant installer les modules. Dans la console noire de Render, vous finirez par voir le gros **QR Code WhatsApp**. Scannez-le avec votre téléphone (Appareils liés). Une fois connecté, la session s'enregistre dans MongoDB. Vous ne le ferez plus jamais !

---

## Étape 4 : L'Anti-Sommeil (UptimeRobot)
*Render éteint les serveurs gratuits au bout de 15 minutes d'inactivité. On va brancher UptimeRobot pour taper à la porte toutes les 5 minutes et le garder éveillé 24h/24.*

1. Sur votre page Render, tout en haut, vous verrez un lien qui se termine par `.onrender.com` (ex: `https://phantombot-xyz.onrender.com`). **Copiez ce lien**.
2. Allez sur **[UptimeRobot](https://uptimerobot.com/)** et créez un compte gratuit.
3. Cliquez sur **Add New Monitor**.
4. Configurez-le ainsi :
   - **Monitor Type** : `HTTP(s)`
   - **Friendly Name** : `Phantom Bot`
   - **URL (or IP)** : *Collez le lien `.onrender.com` que vous avez copié.*
   - **Monitoring Interval** : `5 minutes`.
5. Cliquez sur **Create Monitor**.

🎉 **Terminé !** 🎉
Votre bot est maintenant 100% autonome, hébergé gratuitement, protégé contre les redémarrages de serveurs, et opérationnel 24h/24 !
