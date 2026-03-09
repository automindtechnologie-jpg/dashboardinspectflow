
-- Table to store the entire dashboard state as JSON
CREATE TABLE public.dashboard_state (
  id text PRIMARY KEY DEFAULT 'main',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Allow public access (no auth for now)
ALTER TABLE public.dashboard_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON public.dashboard_state FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public insert" ON public.dashboard_state FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow public update" ON public.dashboard_state FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_state;

-- Storage bucket for inspection photos
INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-files', 'inspection-files', true);

-- Allow public upload/read for the bucket
CREATE POLICY "Allow public read files" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'inspection-files');
CREATE POLICY "Allow public upload files" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'inspection-files');
CREATE POLICY "Allow public delete files" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'inspection-files');
