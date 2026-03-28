# InspectFlow — Contexte projet pour Claude Code CLI
## Elemental Genesis Agent Labs

> Ce fichier est lu automatiquement par Claude Code CLI à chaque session.
> Ne pas supprimer.

---

## Projet

**InspectFlow** — Plateforme de gestion d'inspections terrain pour Hardy Henry Services Ltee
- Plus grosse compagnie pest control + hygiène de Maurice (~10,000 clients)
- 8 managers terrain, 1 secrétaire
- Status : **en prod** — `https://inspectflow.srv937151.hstgr.cloud`
- Repo : `https://github.com/automindtechnologie-jpg/dashboardinspectflow`
- Branche prod : `main` — CI/CD GitHub Actions (~26 secondes après push)

---

## Architecture

```
public/dashboard.html     → Frontend vanilla JS (~4600+ lignes) — tout le UI
public/uploads/photos/    → Photos d'inspection (stockage local VPS, WebP via sharp)
public/uploads/docs/      → Documents clients
server.js                 → API Express + PostgreSQL + SSE + multer upload
Dockerfile                → node:20-alpine
CLAUDE.md                 → ce fichier — contexte auto pour Claude Code CLI
.github/workflows/deploy.yml → CI/CD GitHub Actions → SSH VPS → docker build + restart
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

## Base de données

**Connexion** (depuis le host VPS) :
```bash
docker exec -it postgresql-nx6z-postgresql-1 psql -U DHRPc6BLGZptyhTV -d inspectflow
```

**User app** : `inspectflow` / `InspectFlow2026!`
**DATABASE_URL** dans `.env` : `postgresql://inspectflow:InspectFlow2026!@localhost:32768/inspectflow`

**Tables** :
```
managers          → id, name, email, phone, color, notes, created_at, updated_at
clients           → id, manager_id, name, type, email, phone, urgent, notes, created_at
inspections       → id, client_id, inspection_date, scheduled_date, status, urgent, notes, insp_notes, submitted_at
inspection_photos → id, inspection_id, sort_order, lieu, probleme, solution, validated, image_url, storage_path
documents         → id, client_id, inspection_id, name, file_size, file_ext, status, storage_path, storage_url
config            → key TEXT PK, value JSONB
planning_notes    → id SERIAL, manager_id, note_date DATE, note, UNIQUE(manager_id, note_date)
```

⚠️ **IMPORTANT** : L'user `inspectflow` n'est PAS owner des tables — ne jamais faire ALTER TABLE depuis server.js.
Pour tout ALTER TABLE → utiliser le superuser `DHRPc6BLGZptyhTV` via docker exec psql.

---

## API Routes (server.js)

```
GET  /api/data                          → tout le dataset (managers + clients + inspections + photos + docs)
GET  /api/events                        → SSE stream
POST /api/upload                        → upload fichier (multer + sharp WebP)

POST   /api/managers                    → créer manager
PATCH  /api/managers/:id                → modifier manager
DELETE /api/managers/:id                → supprimer manager

POST   /api/clients                     → créer client
PATCH  /api/clients/:id                 → modifier client
DELETE /api/clients/:id                 → supprimer client

POST   /api/inspections                 → créer inspection (id, client_id, date, scheduledDate, notes, status, urgent)
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
PUT    /api/planning-notes/:managerId/:date     → upsert note (body: { note })
DELETE /api/planning-notes/:managerId/:date     → supprimer note
```

---

## SSE Broadcast

Chaque mutation appelle `broadcast(type, event, data)`.
Le frontend écoute et met à jour le state local sans recharger.
Types : `managers`, `clients`, `inspections`, `photos`, `documents`, `config`, `planning_notes`

⚠️ **RÈGLE CRITIQUE SSE** : Le listener SSE frontend ignore les events `planning_notes`
(type === 'planning_notes') car ils sont gérés localement sans recharger toute la page.
Ne jamais supprimer ce filtre — il empêche le scroll reset et les animations parasites.

```js
// dashboard.html ligne ~4178 — NE PAS MODIFIER
_sse.addEventListener('update', (e) => {
  try {
    const msg = JSON.parse(e.data);
    if (msg.type === 'planning_notes') return; // géré localement
  } catch(err) {}
  if (document.activeElement?.classList.contains('field-input')) return;
  loadFromCloud();
});
```

---

## Fonctionnalités livrées

| Feature | Description | Status |
|---|---|---|
| B1 | SSE live sync — broadcast server + EventSource client | ✅ |
| B2 | Tags sidebar mis à jour en temps réel | ✅ |
| B3 | Fiches éditables — modals édition manager/client/inspection + PATCH | ✅ |
| B4 | Titre inspection libre sans date | ✅ |
| U1 | Bloc Urgences dans Vue d'ensemble + espace manager + sidebar | ✅ |
| U2 | Tags harmonisés — 🔴 Urgent partout | ✅ |
| U3 | Espace Admin — vue globale tous managers | ✅ |
| FIX | Curseur photo — debounce 800ms + SSE guard | ✅ |
| INFRA | Upload local VPS — multer + WebP sharp | ✅ |
| INFRA | Backup PostgreSQL cron 2h00 | ✅ |
| P1 | Score inspections — stat-card "📋 Inspections" en premier | ✅ |
| P2 | Calendrier planning manager — grille mensuelle, dots colorés | ✅ |
| P3 | Notes planning éditables par date — bouton Sauvegarder + confirmation ✓ | ✅ |
| P4 | Récap du mois — layout 2 colonnes (récap gauche, calendrier droite) | ✅ |
| P5 | Date planifiée (scheduled_date) sur fiche inspection → sync calendrier | ✅ |
| P6 | Animation smooth récap — fade-in staggeré sur nouveaux items uniquement | ✅ |
| P7 | Aperçu note dans cellule calendrier — 22 premiers caractères | ✅ |
| FIX | Scroll reset sauvegarde note — SSE planning_notes ignoré par loadFromCloud | ✅ |
| FIX | Animation récap parasites — existingKeys détecte les items déjà rendus | ✅ |

---

## Ce qui reste à faire

- [ ] **Authentification** — login/password avant livraison officielle
- [ ] **Domaine custom** — inspectflow.hardy.mu
- [ ] **Portail Feedback Client** — app séparée `/home/clientfeedback/`, token URL par client, même PostgreSQL

---

## Règles de dev ABSOLUES

### CSS / Frontend
- **Jamais de librairie externe** — vanilla JS uniquement
- **Toujours les variables CSS existantes** : `var(--red)`, `var(--amber)`, `var(--green)`, `var(--blue)`, `var(--text-1)`, `var(--text-3)`, `var(--border)`, `var(--bg)`, etc.
- **Pas de scroll reset** — ne jamais reconstruire `el.innerHTML` de renderManagerHome sauf navigation complète
- **Pas de _renderMgrCalendar() depuis _calSaveNote** — utiliser _updateCalCell(key) + _renderRecap() uniquement
- **SSE planning_notes** — toujours ignoré dans le listener SSE, géré localement
- **Sauvegarde** — bouton explicite pour le planning, onblur/onchange pour les autres champs

### Backend
- **ESM uniquement** — `import/export`, pas de `require()` (sauf dans node -e shell)
- **Pas de ALTER TABLE dans server.js** — user inspectflow n'est pas owner
- **broadcast()** après chaque POST/PATCH/DELETE

### Git
- Toujours commit sur `main` → CI/CD automatique
- Format commit : `feat:`, `fix:`, `refactor:`, `chore:`
- Après chaque modification : `git add -A && git commit -m "..." && git push origin main`

---

## Commandes utiles

```bash
# Logs container
docker logs root-inspectflow-1 --tail=50

# Rebuild manuel si CI/CD échoue
cd /root && docker compose build inspectflow && docker compose up -d --force-recreate inspectflow

# Tester API
curl -s http://localhost:3001/api/data | head -200

# PostgreSQL direct
docker exec -it postgresql-nx6z-postgresql-1 psql -U DHRPc6BLGZptyhTV -d inspectflow
```

---

## Infra VPS

- **VPS** : Hostinger KVM2 — Ubuntu 24.04 — IP `31.97.71.147`
- **Traefik** : réseau `root_default`, cert resolver `mytlschallenge`
- **Compose principal** : `/root/docker-compose.yml` — NE PAS MODIFIER sans backup
- **Backup DB** : cron 2h00 → `/root/backup-inspectflow.sh` → `/root/backups/`

---

*Elemental Genesis Agent Labs — Mis à jour le 28 Mars 2026*
