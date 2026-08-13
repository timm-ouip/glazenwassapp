ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

UPDATE public.customers SET sort_order = house_number WHERE sort_order = 0;

CREATE TABLE public.quick_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_notes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_notes TO authenticated;
GRANT ALL ON public.quick_notes TO service_role;

ALTER TABLE public.quick_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Iedereen mag snelkeuzes beheren" ON public.quick_notes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

INSERT INTO public.quick_notes (label, sort_order) VALUES
  ('H', 1), ('HD', 2), ('balkon', 3), ('achter', 4), ('kozijnen', 5);