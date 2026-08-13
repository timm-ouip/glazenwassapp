CREATE TABLE public.streets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.streets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streets TO authenticated;
GRANT ALL ON public.streets TO service_role;
ALTER TABLE public.streets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Iedereen mag straten beheren" ON public.streets FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  street_id uuid NOT NULL REFERENCES public.streets(id) ON DELETE CASCADE,
  house_number integer NOT NULL,
  addition text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  price numeric(10,2) NOT NULL DEFAULT 0,
  frequency text NOT NULL DEFAULT 'elke',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_frequency_check CHECK (frequency IN ('elke','even','oneven'))
);

CREATE INDEX customers_street_id_idx ON public.customers(street_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Iedereen mag klanten beheren" ON public.customers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);