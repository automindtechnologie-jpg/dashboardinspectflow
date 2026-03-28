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
public/uploads/photos/    → Symlink → /root/inspectflow-data/photos (volume persistant VPS)
public/uploads/docs/      → Symlink → /root/inspectflow-data/docs (volume persistant VPS)
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

Pour vérifier :
```bash
docker inspect root-inspectflow-1 | grep -A 3 Mounts
# Doit afficher les 2 bind mounts
```

---

## Base de données

**Connexion** (depuis le host VPS) :
```bash
docker exec -it postgresql-nx6z-postgresql-1 psql -U DHRPc6BLGZptyhTV -d inspectflow
```

**User app** : `inspectflow` / `InspectFlow2026!`
**DATABASE_URL** dans `.env` : `postgresql://inspectflow:InspectFlow2026!@postgresql-nx6z-postgresql-1:5432/inspectflow`

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
car ils sont gérés localement. Ne jamais supprimer ce filtre.

```js
// dashboard.html — NE PAS MODIFIER
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
| INFRA | Volumes persistants photos/docs — bind mounts host VPS | ✅ |
| INFRA | Pool PG robuste — max:20, timeout 5s/30s | ✅ |
| INFRA | SSE broadcast guard — try/catch + delete client mort | ✅ |
| INFRA | SSE reconnect auto frontend — retry 5s sur onerror | ✅ |
| INFRA | Index PostgreSQL — client_id, inspection_id, manager_id | ✅ |
| INFRA | Logs horodatés + rotation json-file 10MB x7 | ✅ |
| INFRA | Volumes persistants photos/docs — bind mounts host VPS | ✅ |
| P1 | Score inspections — stat-card "📋 Inspections" en premier | ✅ |
| P2 | Calendrier planning manager — grille mensuelle, dots colorés | ✅ |
| P3 | Notes planning éditables par date — bouton Sauvegarder + confirmation ✓ | ✅ |
| P4 | Récap du mois — layout 2 colonnes (récap gauche, calendrier droite) | ✅ |
| P5 | Date planifiée (scheduled_date) sur fiche inspection → sync calendrier | ✅ |
| P6 | Animation smooth récap — fade-in staggeré sur nouveaux items uniquement | ✅ |
| P7 | Aperçu note dans cellule calendrier — 22 premiers caractères | ✅ |
| FIX | Scroll reset sauvegarde note — SSE planning_notes ignoré | ✅ |
| FIX | Animation récap parasites — existingKeys détecte items déjà rendus | ✅ |

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

### Infra
- **Volumes persistants** — ne jamais supprimer les bind mounts du docker-compose.yml
- **Backup compose** — toujours `cp /root/docker-compose.yml /root/docker-compose.yml.save` avant modif

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

# Vérifier volumes montés
docker inspect root-inspectflow-1 | grep -A 3 Mounts

# Vérifier fichiers uploadés
ls -lh /root/inspectflow-data/photos/
ls -lh /root/inspectflow-data/docs/

# PostgreSQL direct
docker exec -it postgresql-nx6z-postgresql-1 psql -U DHRPc6BLGZptyhTV -d inspectflow
```

---

## Infra VPS

- **VPS** : Hostinger KVM2 — Ubuntu 24.04 — IP `31.97.71.147`
- **Traefik** : réseau `root_default`, cert resolver `mytlschallenge`
- **Compose principal** : `/root/docker-compose.yml` — NE PAS MODIFIER sans backup
- **Données uploads** : `/root/inspectflow-data/` — NE JAMAIS SUPPRIMER
- **Backup DB** : cron 2h00 → `/root/backup-inspectflow.sh` → `/root/backups/`

---

*Elemental Genesis Agent Labs — Mis à jour le 28 Mars 2026*
