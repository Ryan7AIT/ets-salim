# Ets Bellal Salim — PlombTrack

Application web de gestion pour **Ets Bellal Salim** : clients, contrats, interventions, notifications Telegram, et module de facturation optionnel.

## Fonctionnalités

### Cœur de l'application
- **Tableau de bord** — statistiques, graphiques, prochaines interventions
- **Clients** — fiche société, contact, téléphone, email, adresse, **NIF**, **R.C** (registre de commerce), **NIS** (optionnels)
- **Contrats** — maintenance chaudière / brûleur, période, statut, suivi d'avancement
- **Interventions** — planification, filtres, pagination, statuts
- **Paramètres** — délai de notification avant intervention

### Notifications Telegram (optionnel)
- Alertes automatiques X jours avant une intervention planifiée ou en cours
- Configuration via variables d'environnement dans `.env`

### Module Factures (optionnel)
Activé uniquement si `INVOICES_ENABLED=true` dans `.env`.

- Création / modification / suppression de **factures** ou **proformas** liées à un **client** (`client_id`)
- Type de document : **Facture** (avec date d'échéance et bloc « Facturé à ») ou **Proforma** (sans date d'échéance, bloc **Client** avec raison sociale, NIF, R.C et NIS)
- Lignes de facture : description, quantité, prix unitaire
- Totaux : sous-total, ajustements, **remise**, TVA, total
- **NIF client**, **R.C** et **NIS** — champs optionnels sur la fiche client, affichés sur les factures (bloc « Facturé à » ou « Client »)
- Paramètres entreprise : logo (texte ou image), **cachet** (image), adresse, NIF, N° d'immatriculation, **RIP**
- Option par document : cocher **Inclure le cachet** pour l'afficher sous le total, en bas à droite (facture ou proforma)
- Langue des exports : **français** ou **anglais**
- Export **PDF** et **Excel**

### Module Stock (optionnel)
Activé uniquement si `STOCK_ENABLED=true` dans `.env`.

- Catalogue de **produits** : nom, référence, photo (optionnelle), quantité, prix d'achat, prix de vente, seuil de stock bas
- **Mouvements de stock** : entrées (achats), sorties (utilisation), ajustements
- Historique des mouvements avec filtres (produit, type, dates)
- Indicateurs : nombre d'articles, articles en stock bas, valeur totale du stock

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Vue 3 (CDN), HTML, CSS |
| Backend | FastAPI, Python 3 |
| Base de données | SQLite (`api/plombtrack.sqlite3`) |
| Exports factures | ReportLab (PDF), openpyxl (Excel) |

Pas de build frontend : l'API sert aussi les fichiers statiques.

## Prérequis

- Python 3.10+ recommandé
- `pip`

## Installation

```bash
git clone <url-du-repo>
cd salim_app

python -m venv api/.venv

# Windows
api\.venv\Scripts\activate

# macOS / Linux
source api/.venv/bin/activate

pip install -r api/requirements.txt
```

## Configuration (`.env`)

Créez un fichier `.env` à la racine du projet (il est ignoré par Git) :

```env
# Module factures — false par défaut si absent
INVOICES_ENABLED=true

# Module stock — false par défaut si absent
STOCK_ENABLED=true

# Notifications Telegram (optionnel)
TELEGRAM_BOT_TOKEN=votre_token_bot
TELEGRAM_CHAT_ID=votre_chat_id
```

| Variable | Description |
|----------|-------------|
| `INVOICES_ENABLED` | `true`, `1`, `yes` ou `on` pour afficher le module Factures |
| `STOCK_ENABLED` | `true`, `1`, `yes` ou `on` pour afficher le module Stock |
| `TELEGRAM_BOT_TOKEN` | Token du bot Telegram |
| `TELEGRAM_CHAT_ID` | ID du chat / canal de destination |

## Lancement

Depuis la racine du projet, avec l'environnement virtuel activé :

```bash
uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

Ouvrez ensuite : http://127.0.0.1:8000

### Identifiants par défaut

| Champ | Valeur |
|-------|--------|
| Utilisateur | `admin` |
| Mot de passe | `admin` |

Changez ce mot de passe en production.

## Module Factures — guide rapide

1. Définir `INVOICES_ENABLED=true` dans `.env` et redémarrer l'API.
2. Aller dans **Paramètres → Facturation** :
   - Informations entreprise (nom, adresse, email, téléphone)
   - NIF, N° d'immatriculation, RIP (optionnels — affichés seulement si renseignés)
   - Logo texte ou image importée
   - Cachet (image importée) — activable par document via une case à cocher
   - Langue des factures (FR / EN), devise, TVA par défaut, délai d'échéance
3. Créer une facture ou une proforma dans **Factures** : choisir le type, le client, ajouter les lignes.
4. Exporter en **PDF** ou **Excel** depuis la liste ou l'aperçu.

Chaque document est stocké en base et lié à un client existant via `clients.id`. Le **NIF**, le **R.C** et le **NIS** client se renseignent dans la fiche client (module Clients) et apparaissent sur les factures exportées.

## Module Stock — guide rapide

1. Définir `STOCK_ENABLED=true` dans `.env` et redémarrer l'API.
2. Aller dans **Stock → Produits** pour créer vos articles (référence, prix, photo optionnelle, quantité initiale).
3. Utiliser **Mouvements** pour enregistrer les achats (entrée), les utilisations (sortie) ou corriger le stock (ajustement).
4. Surveiller les articles en **stock bas** via le filtre dédié et les indicateurs en haut de page.

La quantité d'un produit ne change que via les mouvements (sauf quantité initiale à la création).

## Structure du projet

```
salim_app/
├── index.html          # Interface Vue
├── script.js           # Logique frontend
├── style.css           # Styles
├── .env                # Configuration locale (non versionnée)
├── README.md
└── api/
    ├── main.py                 # API FastAPI, routes, schéma SQLite
    ├── invoice_service.py      # CRUD factures, exports PDF/Excel
    ├── stock_service.py        # CRUD stock, mouvements
    ├── notification_service.py # Notifications Telegram
    ├── send_pending_notifications.py
    ├── requirements.txt
    └── plombtrack.sqlite3      # Base SQLite (générée au premier lancement)
```

## API principale

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/config` | Feature flags (`features.invoices`, `features.stock`) |
| `POST` | `/api/login` | Authentification |
| `GET` / `PUT` | `/api/state` | État applicatif (clients, contrats, interventions) |
| `GET` | `/api/invoices` | Liste des factures *(si module activé)* |
| `POST` | `/api/invoices` | Créer une facture |
| `PUT` | `/api/invoices/{id}` | Modifier une facture |
| `DELETE` | `/api/invoices/{id}` | Supprimer une facture |
| `GET` | `/api/invoices/{id}/export.pdf` | Export PDF |
| `GET` | `/api/invoices/{id}/export.xlsx` | Export Excel |
| `GET` / `PUT` | `/api/invoice-settings` | Paramètres de facturation |
| `GET` | `/api/stock/products` | Liste des produits + résumé *(si module activé)* |
| `POST` | `/api/stock/products` | Créer un produit |
| `GET` | `/api/stock/products/{id}` | Détail produit + mouvements récents |
| `PUT` | `/api/stock/products/{id}` | Modifier un produit |
| `DELETE` | `/api/stock/products/{id}` | Supprimer un produit (sans mouvements) |
| `GET` | `/api/stock/movements` | Liste des mouvements (filtres optionnels) |
| `POST` | `/api/stock/movements` | Créer un mouvement |

## Scripts utiles

```bash
# Envoyer les notifications Telegram en attente
python api/send_pending_notifications.py

# Test manuel Telegram
python test.py --message "Test notification"
```

## Notes

- Les données sont persistées dans SQLite ; une copie locale est aussi gardée dans le navigateur (`localStorage`) en secours.
- Sans `INVOICES_ENABLED`, le menu Factures et les routes associées restent invisibles / inaccessibles.
- Sans `STOCK_ENABLED`, le menu Stock et les routes associées restent invisibles / inaccessibles.
- Ne commitez jamais le fichier `.env` ni la base `*.sqlite3`.
