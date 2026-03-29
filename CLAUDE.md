# InspectFlow — Contexte projet pour Claude Code CLI
## Elemental Genesis Agent Labs

> Ce fichier est lu automatiquement par Claude Code CLI à chaque session.
> Ne pas supprimer.
> Dernière mise à jour : 29 Mars 2026

---

## Projet

**InspectFlow** — Plateforme de gestion d'inspections terrain pour Hardy Henry Services Ltee
- Plus grosse compagnie pest control + hygiène de Maurice (~10,000 clients)
- 8 managers terrain, 1 secrétaire
- Status : **en prod** — `https://inspectflow.srv937151.hstgr.cloud`
- Repo : `https://github.com/automindtechnologie-jpg/dashboardinspectflow`
- Branche prod : `main` — CI/CD GitHub Actions (~26 secondes après push)
- Commit actuel : `220b0ee`

---

## Architecture

```
public/dashboard.html         → Frontend vanilla JS (~5300+ lignes) — tout le UI
public/client-portal.html     → Portail client — vue token (Hardy Henry branding)
public/uploads/photos/        → Bind mount → /root/inspectflow-data/photos (volume persistant VPS)
public/uploads/docs/          → Bind mount → /root/inspectflow-data/docs (volume persistant VPS)
server.js                     → API Express + PostgreSQL + SSE + multer upload
Dockerfile                    → node:20-alpine
CLAUDE.md                     → ce fichier — contexte auto pour Claude Code CLI
.github/workflows/deploy.yml  → CI/CD GitHub Actions → SSH VPS → docker build + restart
```

---

## Stack technique

- **Frontend** : Vanilla JS (pas de framework), CSS variables, pas de librairie externe
- **Backend** : Node.js ESM, Express
- **DB** : PostgreSQL 17 + pgvector (`postgresql-nx6z-postgresql-1`, port 32768)
- **Upload** : multer + sharp (conversion WebP auto)
- **Realtime** : SSE (Server-Sent Events) — broadcast sur toutes les mutations
- **Déploiement** : Docker sur VPS Hostinger, Traefik reverse proxy

---

## Stockage fichiers — VOLUMES PERSISTANTS

⚠️ **CRITIQUE** : Les photos et docs sont stockés sur le HOST VPS, pas dans le container.
Un rebuild CI/CD ne détruit JAMAIS les uploads.

```
Host VPS                              Container InspectFlow
/root/inspectflow-data/photos   →     /app/public/uploads/photos
/root/inspectflow-data/docs     →     /app/public/uploads/docs
```

Configuré dans `/root/docker-compose.yml` section `inspectflow → volumes`.
Ne jamais supprimer ces bind mounts du compose.

---

## Base de données

**Connexion superuser** (depuis host VPS) :
```bash
docker exec -it postgresql-nx6z-postgresql-1 psql -U DHRPc6BLGZptyhTV -d inspectflow
```

**User app** : `inspectflow` / `InspectFlow2026!`
**DATABASE_URL** : `postgresql://inspectflow:InspectFlow2026!@postgresql-nx6z-postgresql-1:5432/inspectflow`

**Tables** :
```
managers          → id, name, email, phone, color, notes, created_at, updated_at
clients           → id, manager_id, name, type, email, phone, urgent, notes, created_at
inspections       → id, client_id, inspection_date, scheduled_date, status, urgent, notes, insp_notes, submitted_at
inspection_photos → id, inspection_id, sort_order, lieu, probleme, solution, validated, image_url, storage_path
documents         → id, client_id, inspection_id, name, file_size, file_ext, status, storage_path, storage_url
config            → key TEXT PK, value JSONB
planning_notes    → id SERIAL, manager_id, note_date DATE, note, UNIQUE(manager_id, note_date)
client_tokens     → id SERIAL, client_id TEXT UNIQUE, token TEXT UNIQUE, created_at
inspection_pushes → id SERIAL, inspection_id TEXT UNIQUE, client_id TEXT, pushed_at
client_feedbacks  → id SERIAL, inspection_id TEXT UNIQUE, client_id TEXT, rating INT, propre INT, ponctuel INT, efficace INT, comment TEXT, updated_at
```

⚠️ **RÈGLE PERMISSIONS** : L'user `inspectflow` n'est PAS owner des tables.
- CREATE TABLE → toujours via superuser `DHRPc6BLGZptyhTV`
- Après chaque CREATE TABLE :
```bash
GRANT ALL PRIVILEGES ON TABLE nom_table TO inspectflow;
GRANT USAGE, SELECT ON SEQUENCE nom_table_id_seq TO inspectflow;
```
- Ne jamais faire ALTER TABLE depuis server.js

---

## API Routes (server.js)

```
GET  /api/data                          → tout le dataset
GET  /api/events                        → SSE stream
POST /api/upload                        → upload fichier (multer + sharp WebP)

POST   /api/managers                    → créer manager
PATCH  /api/managers/:id                → modifier manager
DELETE /api/managers/:id                → supprimer manager

POST   /api/clients                     → créer client
PATCH  /api/clients/:id                 → modifier client
DELETE /api/clients/:id                 → supprimer client

POST   /api/inspections                 → créer inspection
PATCH  /api/inspections/:id             → modifier inspection
DELETE /api/inspections/:id             → supprimer inspection

POST   /api/photos                      → créer photo
PATCH  /api/photos/:id                  → modifier photo
DELETE /api/photos/:id                  → supprimer photo

POST   /api/documents                   → créer document
PATCH  /api/documents/:id               → modifier document
DELETE /api/documents/:id               → supprimer document

GET    /api/config/:key                 → lire config
PUT    /api/config/:key                 → écrire config

GET    /api/planning-notes/:managerId           → notes planning du manager
PUT    /api/planning-notes/:managerId/:date     → upsert note
DELETE /api/planning-notes/:managerId/:date     → supprimer note

── PORTAIL CLIENT ──────────────────────────────────────────────────────────
GET  /client/:token                              → sert client-portal.html
GET  /api/portal/token/:clientId                 → récupère ou crée le token
POST /api/portal/token/:clientId/regenerate      → régénère le token
POST /api/portal/push/:inspectionId              → push inspection (body: {client_id})
DELETE /api/portal/push/:inspectionId            → retire inspection du portail
GET  /api/portal/client/:token                   → données portail client
PUT  /api/portal/feedback/:inspectionId          → soumettre / modifier feedback
GET  /api/portal/admin                           → vue admin tous clients + stats
```

---

## SSE Broadcast

Types : `managers`, `clients`, `inspections`, `photos`, `documents`, `config`, `planning_notes`,
`portal_push`, `portal_feedback`, `portal_token`

⚠️ **RÈGLES CRITIQUES SSE** — ne jamais modifier ce comportement :
```js
if (msg.type === 'planning_notes') return; // géré localement
if (msg.type === 'portal_token') return;   // ignoré
if (msg.type === 'portal_push') { _updatePushBtn(...); return; }
if (document.activeElement?.classList.contains('field-input')) return;
loadFromCloud();
```

---

## Portail Client

**URL client** : `https://inspectflow.srv937151.hstgr.cloud/client/:token`
**Page** : `public/client-portal.html` — branding "Hardy Henry Services — Portail Clients"

**Flux :**
1. Token auto-créé à `GET /api/portal/token/:clientId`
2. Manager clique "📤 Push" sur inspection → `POST /api/portal/push/:inspectionId`
3. Manager clique "🔗 Portail" → URL copiée presse-papier → WhatsApp au client
4. Client ouvre `/client/:token` → voit inspections + laisse feedback (3 étoiles + critères + commentaire modifiable)
5. SSE `portal_feedback` → tag "Feedback reçu" en temps réel

**Fonctions clés dashboard :**
- `openPortalAdmin()` → onglet Portail Clients sidebar
- `renderPortalAdmin(el)` → tableau clients + stats
- `openPortalTab(clientId)` → ouvre portail dans nouvel onglet
- `copyPortalLink(clientId)` → copie URL presse-papier
- `regenerateToken(clientId)` → régénère token + refresh vue sur place (pas navigate)
- `togglePortalPush(inspId, clientId)` → push/dépush
- `renderPortalClientDetail(el, clientId)` → vue détail

⚠️ **Feedbacks** : dans `inspection.feedback` (pas `portalData.feedbacks`) :
```js
portalData.inspections.filter(i => i.feedback) // ✅
portalData.feedbacks  // ❌ n'existe pas
```

---

## Fonctionnalités livrées

| Feature | Status |
|---|---|
| SSE live sync temps réel | ✅ |
| Fiches éditables managers/clients/inspections | ✅ |
| Bloc Urgences | ✅ |
| Espace Admin vue globale | ✅ |
| Upload photos WebP + documents | ✅ |
| Volumes persistants bind mounts | ✅ |
| Backup PostgreSQL cron 2h00 | ✅ |
| Score inspections stat-card | ✅ |
| Calendrier planning mensuel + dots colorés | ✅ |
| Notes planning éditables par date | ✅ |
| Récap du mois 2 colonnes | ✅ |
| Date planifiée → sync calendrier | ✅ |
| **Portail Client complet** | ✅ |
| — Token par client (auto + régénérable) | ✅ |
| — Push inspection vers portail | ✅ |
| — Page client-portal.html mobile-first | ✅ |
| — Feedback 3 étoiles + critères + commentaire modifiable | ✅ |
| — Onglet admin Portail Clients dans dashboard | ✅ |
| — SSE feedback → tag temps réel | ✅ |
| **Responsive mobile iPhone** | ✅ |
| — Calendrier compact (36px, dots 5px, popup fixed centré) | ✅ |
| — Note preview masquée sur mobile | ✅ |
| — Media queries 768px + 400px | ✅ |
| — Boutons inspection 2 par ligne sur mobile | ✅ |
| — Soumettre pleine largeur sur mobile | ✅ |
| **Fixes divers** | ✅ |
| — fmtDate : Invalid Date quand PostgreSQL retourne timestamp complet | ✅ |
| — Date sous titre inspection supprimée (redondant avec planning) | ✅ |
| — Bloc "📅 Date planifiée" supprimé de la fiche inspection | ✅ |
| — regenerateToken : refresh sur place sans navigate | ✅ |
| — portalData.feedbacks → inspections.filter(i=>i.feedback) | ✅ |

---

## Ce qui reste à faire

- [ ] **Authentification** — login/password avant livraison officielle Hardy
- [ ] **Domaine custom** — inspectflow.hardy.mu

---

## Règles de dev ABSOLUES

### CSS / Frontend
- **Jamais de librairie externe** — vanilla JS uniquement
- **Variables CSS existantes** : `var(--red)`, `var(--amber)`, `var(--green)`, `var(--blue)`, `var(--text-1)`, `var(--text-3)`, `var(--border)`, `var(--bg)`
- **Pas de scroll reset** — ne jamais reconstruire `el.innerHTML` de renderManagerHome sauf navigation complète
- **SSE planning_notes** — toujours ignoré dans le listener, géré localement
- **Feedbacks portail** — toujours via `inspection.feedback`, jamais `portalData.feedbacks`
- **Scripts de patch** — toujours écrire dans un fichier `/tmp/fix_xxx.js` et executer avec `node`, jamais `node -e` avec du HTML imbriqué (backticks conflicts)

### Backend
- **ESM uniquement** — `import/export`, pas de `require()`
- **Pas de ALTER TABLE dans server.js** — user inspectflow n'est pas owner
- **GRANT après CREATE TABLE** — toujours accorder permissions à inspectflow
- **broadcast()** après chaque POST/PATCH/DELETE

### Infra
- **Volumes persistants** — ne jamais supprimer les bind mounts du docker-compose.yml
- **Backup compose** — `cp /root/docker-compose.yml /root/docker-compose.yml.save` avant modif

### Git
- Toujours commit sur `main` → CI/CD automatique (~26s)
- Format : `feat:`, `fix:`, `refactor:`, `chore:`
- `git add -A && git commit -m "..." && git push origin main`

---

## Commandes utiles

```bash
# Logs container
docker logs root-inspectflow-1 --tail=50

# Rebuild manuel si CI/CD échoue
cd /root && docker compose build inspectflow && docker compose up -d --force-recreate inspectflow

# Vérifier volumes montés
docker inspect root-inspectflow-1 | grep -A 3 Mounts

# PostgreSQL superuser
docker exec -it postgresql-nx6z-postgresql-1 psql -U DHRPc6BLGZptyhTV -d inspectflow

# Accorder permissions nouvelle table
docker exec -it postgresql-nx6z-postgresql-1 psql -U DHRPc6BLGZptyhTV -d inspectflow -c \
  "GRANT ALL PRIVILEGES ON TABLE nom TO inspectflow; GRANT USAGE, SELECT ON SEQUENCE nom_id_seq TO inspectflow;"

# Vérifier backups
ls -lh /root/backups/
```

---

## Infra VPS

- **VPS** : Hostinger KVM2 — Ubuntu 24.04 — IP `31.97.71.147`
- **Traefik** : réseau `root_default`, cert resolver `mytlschallenge`
- **Compose principal** : `/root/docker-compose.yml` — NE PAS MODIFIER sans backup
- **Données uploads** : `/root/inspectflow-data/` — NE JAMAIS SUPPRIMER
- **Backup DB** : cron 2h00 → `/root/backup-inspectflow.sh` → `/root/backups/`

---

*Elemental Genesis Agent Labs — Mis à jour le 29 Mars 2026*
