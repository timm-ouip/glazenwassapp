CREATE TABLE public.districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.districts TO anon, authenticated;
GRANT ALL ON public.districts TO service_role;

ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Iedereen mag wijken beheren" ON public.districts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.streets ADD COLUMN district_id uuid REFERENCES public.districts(id) ON DELETE CASCADE;

INSERT INTO public.districts (name, sort_order) VALUES ('Wijk 1', 0);

UPDATE public.streets SET district_id = (SELECT id FROM public.districts ORDER BY created_at LIMIT 1) WHERE district_id IS NULL;

ALTER TABLE public.streets ALTER COLUMN district_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_districts_updated_at BEFORE UPDATE ON public.districts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();