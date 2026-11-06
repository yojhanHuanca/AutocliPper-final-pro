-- Videos de hasta 30 GiB y 10 h: tamaños mayores a 2 GiB y cargas multipart largas.
ALTER TABLE uploads ALTER COLUMN expected_bytes TYPE bigint;
--> statement-breakpoint
ALTER TABLE uploads ALTER COLUMN expires_at SET DEFAULT now()+interval '24 hours';
--> statement-breakpoint
ALTER TABLE pipelines DROP CONSTRAINT IF EXISTS pipelines_remaining_reservation_bytes_check;
--> statement-breakpoint
-- Reservas de audio de 10 h + varios clips: la lista fija de valores ya no alcanza.
ALTER TABLE pipelines ADD CONSTRAINT pipelines_remaining_reservation_bytes_check CHECK(remaining_reservation_bytes >= 0);
--> statement-breakpoint
ALTER TABLE pipelines ALTER COLUMN remaining_reservation_bytes TYPE bigint;
--> statement-breakpoint
ALTER TABLE pipelines ALTER COLUMN remaining_reservation_bytes SET DEFAULT 1410334720;
