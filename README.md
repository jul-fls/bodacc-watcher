# bodacc-watcher

**Watcher Node.js pour surveiller les annonces civiles et commerciales BODACC et les pousser sur un webhook Discord.**
Supporte **plusieurs entreprises** (ex. `company1,company2`), évite les doublons, et formate les annonces en **embeds Discord**.

---

## ✨ Fonctionnalités

* 🔎 **Recherche multi-entreprises** (liste CSV dans `COMPANIES`)
* 🧠 Anti-doublons via un **fichier d’état persistant** (par entreprise)
* 📨 Envoi vers **un unique webhook Discord** (batch automatique, 10 embeds/message)
* 🧩 Champs utiles dans l’embed : type de publication, date de parution, tribunal, RCS, ville/CP, département
* 🔁 **Polling** avec intervalle configurable
* ⚙️ Zéro dépendance externe (Node 18+ : `fetch` natif) mis à part dotenv pour charger le fichier .env

---

## 📦 Prérequis

* **Node.js 18+** (ou Docker)
* Un **webhook Discord** (URL)
* Accès réseau sortant vers `bodacc.fr` et `discord.com`
* Droits d’écriture pour le **fichier d’état** (par défaut `bodacc_seen_multi.json`)

---

## 🔧 Installation

```bash
git clone https://github.com/jul-fls/bodacc-watcher.git
cd bodacc-discord-watcher
npm install
cp .env.example .env
```

### Variables d’environnement

```ini
# Obligatoires
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy
COMPANIES=company1,company2

# Optionnelles
POLL_INTERVAL_MS=300000     # Intervalle de polling (ms). Par défaut: 300000 (5 min)
MAX_RESULTS_PER_COMPANY=10                 # Nb max d’enregistrements récupérés par entreprise (BODACC)
STATE_FILE_PATH=./bodacc_seen_multi.json  # Fichier d’état (persistant)
```

> Astuce : vous pouvez mettre des espaces après les virgules dans `COMPANIES` (ils seront ignorés).

---

## ▶️ Démarrage (Node.js)

Le fichier principal s’appelle ici **`main.js`** (collez le code que tu as partagé dans ce fichier).

```bash
node main.js
# Exemple de logs :
# Watcher BODACC multi-entreprises démarré. Entreprises: company1, company2
# [company1] Aucun nouveau résultat.
# [company2] 2 nouveau(x) envoi(s) vers Discord.
```

---

## 🐳 Utilisation avec Docker


### Build & Run

```bash
# Build
docker build -t bodacc-discord-watcher .

# Run
docker run --rm \
  -e DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/xxx/yyy" \
  -e COMPANIES="company1,company2" \
  -e POLL_INTERVAL_MS=300000 \
  -e MAX_RESULTS_PER_COMPANY=10 \
  -v $(pwd)/data:/data \
  -e STATE_FILE_PATH="/data/bodacc_seen_multi.json" \
  --name bodacc-watcher \
  bodacc-discord-watcher
```

Vous pouvez aussi utiliser l'image créée automatiquement par la pipeline de CI/CD : ghcr.io/jul-fls/bodacc-watcher/app:latest

> ✅ **Important** : Montez un volume pour **persister** `STATE_FILE_PATH` afin d’éviter les re-notifications après redémarrage.

---

## ⚙️ Comment ça marche

1. Pour chaque entreprise de `COMPANIES`, l’app construit l’URL BODACC :

   * `commercant_search=<company>`
   * `q=#search(commercant,"<company>")`
2. Récupère jusqu’à `MAX_RESULTS_PER_COMPANY` résultats, **triés** par `dateparution` (desc) puis `numeroannonce`.
3. Compare chaque `recordid` au fichier d’état **par entreprise**.
4. Pour chaque nouveau record :

   * Forme un **embed Discord** (titre, lien Bodacc, champs, description modif/dépôt si présents)
   * Envoie au webhook (par **lots de 10 embeds** max)
5. Met à jour le fichier d’état (timestamp + `recordid` par entreprise).

---

## 🧪 Exemple d’embed envoyé

* **Titre** : `Company1 — Dépôts des comptes`
* **Lien** : page détail BODACC
* **Champs** :

  * Type / Publication : `Bodacc C` (ou libellé)
  * Date parution : `2025-07-29`
  * Ville / CP : `Boulogne-Billancourt 92100`
  * Tribunal : `Greffe du Tribunal ...`
  * Registre / RCS : `309 065 084`
  * Département : `Hauts-de-Seine (92)`
* **Description** (si dispo) :

  * `Modif.` ou `Dépôt : Comptes annuels et rapports (2024-12-31)`

---

## 🚦 Bonnes pratiques & limites

* 🕒 **Rate-limits Discord** : le script batch par 10 embeds. Si vous surveillez beaucoup d’entreprises, gardez un `POLL_INTERVAL_MS` raisonnable.
* 🗂️ **Persistance** : assurez-vous que `STATE_FILE_PATH` est **persisté** (volume Docker, disque).
* 🔎 **MAX\_ROWS** : si trop bas, vous pourriez rater des annonces insérées entre deux polls (rare, mais possible). Ajustez selon le volume attendu.
* 📝 **Nettoyage** : supprimer le fichier d’état ré-enverra **toutes** les annonces présentes dans la fenêtre `MAX_RESULTS_PER_COMPANY`.
* 🌐 **Fuseau horaire** : la requête fixe `timezone=Europe/Berlin` (OK pour FR/CEST). Modifiez si besoin.

---

## 🧰 Déploiement & Ops (Docker Compose)

Voici un **déploiement simple et persistant** via Docker Compose.
Il utilise un volume pour conserver le fichier d’état et des variables d’environnement pour la config.

### Via Docker Compose et le .env.example (fournis dans le repository)

> Le fichier d’état sera écrit dans `./data/bodacc_seen_multi.json`.
> En cas de suppression de ce fichier, **tous les résultats présents** dans la fenêtre `MAX_RESULTS_PER_COMPANY` seront renvoyés au prochain cycle.

### 3) Lancer / arrêter / mettre à jour

```bash
# Démarrer en arrière-plan
docker compose up -d

# Voir les logs en continu
docker compose logs -f

# Mettre à jour l'image (si vous poussez une nouvelle version)
docker compose pull && docker compose up -d

# Arrêter
docker compose down
```

### Conseils

* Gardez `POLL_INTERVAL_MS` raisonnable pour éviter de spammer Discord et respecter les limites.
* Ajustez `MAX_RESULTS_PER_COMPANY` si vous suivez de nombreuses sociétés ou si le flux d’annonces est dense.
* Le montage `./data:/data` est **indispensable** pour éviter les doublons après redémarrage.

## 🛠️ Dépannage

* **`Discord webhook error`**
  Vérifiez l’URL du webhook et les permissions du salon (trop de messages/embeds ?).
* **`Bodacc fetch error`**
  BODACC down, réseau filtré, ou paramètres de requête invalides.
* **Aucun message Discord**
  Soit pas de nouveaux `recordid`, soit `STATE_FILE_PATH` contient déjà ces IDs.
* **Re-notifications après reboot**
  Le fichier d’état n’est pas persisté (montez un volume / utilisez un chemin stable).

---

## 🗺️ Roadmap (idées)

* Multiplication des **webhooks** par entreprise (routing)
* Filtrage par **type d’avis** / **département**
* Résumés journaliers/hebdo
* **Slash-command** Discord pour forcer un re-scan