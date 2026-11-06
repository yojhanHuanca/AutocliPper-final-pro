-- Videos de varias horas: tamaños mayores a 2 GiB.
ALTER TABLE "inspection_tasks" ALTER COLUMN "expected_bytes" TYPE bigint;
