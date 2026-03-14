-- =================================================================
-- Migration: Replace single JSONB blob with relational schema
-- Fixes: race conditions on concurrent writes (10+ users)
-- =================================================================

-- Drop old blob table (data will be re-imported from localStorage if needed)
DROP TABLE IF EXISTS public.dashboard_state CASCADE;

-- =================================================================
-- TABLES
-- =================================================================

CREATE TABLE public.managers (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  email      text        NOT NULL DEFAULT '',
  phone      text        NOT NULL DEFAULT '',
  color      text        NOT NULL DEFAULT '#1A56DB',
  notes      text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.clients (
  id         text        PRIMARY KEY,
  manager_id text        NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  email      text        NOT NULL DEFAULT '',
  phone      text        NOT NULL DEFAULT '',
  type       text        NOT NULL DEFAULT '',
  urgent     boolean     NOT NULL DEFAULT false,
  notes      text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inspections (
  id              text        PRIMARY KEY,
  client_id       text        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  inspection_date date        NOT NULL,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','rouge','jaune','vert')),
  urgent          boolean     NOT NULL DEFAULT false,
  notes           text        NOT NULL DEFAULT '',
  insp_notes      text        NOT NULL DEFAULT '',
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inspection_photos (
  id            text        PRIMARY KEY,
  inspection_id text        NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  sort_order    smallint    NOT NULL DEFAULT 0,
  lieu          text        NOT NULL DEFAULT '',
  probleme      text        NOT NULL DEFAULT '',
  solution      text        NOT NULL DEFAULT '',
  validated     boolean     NOT NULL DEFAULT false,
  image_url     text,
  storage_path  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.documents (
  id            text        PRIMARY KEY,
  client_id     text        REFERENCES public.clients(id)     ON DELETE CASCADE,
  inspection_id text        REFERENCES public.inspections(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  file_size     text        NOT NULL DEFAULT '',
  file_ext      text        NOT NULL DEFAULT '',
  status        text        NOT NULL DEFAULT 'none'
                            CHECK (status IN ('none','pending','approved','rejected')),
  storage_path  text,
  storage_url   text,
  uploaded_at   date        NOT NULL DEFAULT current_date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- must belong to exactly one parent
  CONSTRAINT document_has_one_parent CHECK (
    (client_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int = 1
  )
);

-- =================================================================
-- INDEXES
-- =================================================================

CREATE INDEX idx_clients_manager_id     ON public.clients(manager_id);
CREATE INDEX idx_inspections_client_id  ON public.inspections(client_id);
CREATE INDEX idx_inspections_status     ON public.inspections(status);
CREATE INDEX idx_photos_inspection_id   ON public.inspection_photos(inspection_id);
CREATE INDEX idx_photos_sort            ON public.inspection_photos(inspection_id, sort_order);
CREATE INDEX idx_docs_client_id         ON public.documents(client_id);
CREATE INDEX idx_docs_inspection_id     ON public.documents(inspection_id);

-- =================================================================
-- AUTO-UPDATE updated_at
-- =================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_managers_updated
  BEFORE UPDATE ON public.managers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_clients_updated
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_inspections_updated
  BEFORE UPDATE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_photos_updated
  BEFORE UPDATE ON public.inspection_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Accès géré par le serveur Express (pas de RLS nécessaire sur PostgreSQL local)
-- L'utilisateur inspectflow n'a accès qu'à sa propre base via DATABASE_URL
