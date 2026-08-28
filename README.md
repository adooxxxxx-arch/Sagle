# Sagle

Chatbot propulsé par **Kimi K3** (via l'API NVIDIA), avec streaming en temps réel, panneau Artifacts avec aperçu live, upload d'images, mode clair/sombre, et historique de conversations. La clé API reste toujours côté serveur — jamais exposée au navigateur.

## Déployer sur Netlify (recommandé, via GitHub)

1. Crée un dépôt GitHub avec ce dossier :
   ```bash
   git init && git add . && git commit -m "Sagle" && git branch -M main
   git remote add origin https://github.com/TON-PSEUDO/sagle.git
   git push -u origin main
   ```
2. Va sur https://app.netlify.com → **Add new site → Import an existing project** → choisis ton dépôt
3. Les réglages de build sont déjà configurés (`netlify.toml`) — clique **Deploy**
4. Dans **Site configuration → Environment variables**, ajoute :
   - Nom : `NVIDIA_API_KEY`
   - Valeur : ta clé NVIDIA (régénère-la sur build.nvidia.com si elle a déjà été partagée)
5. Si ajoutée après coup : **Deploys → Trigger deploy → Clear cache and deploy site**

## Lancer en local

```bash
npm install
npm install -g netlify-cli
export NVIDIA_API_KEY="ta-clé-ici"
netlify dev
```

## Structure

```
src/App.tsx                  → interface complète (chat, artifacts, images, thème)
src/index.css                → styles + variables de thème clair/sombre
netlify/functions/chat.js    → proxy sécurisé vers l'API NVIDIA (streaming SSE)
netlify.toml                 → configuration de build et des fonctions
```

## Sécurité

La clé API n'existe que dans les variables d'environnement Netlify. Si elle a déjà été collée en clair quelque part, régénère-la immédiatement.
