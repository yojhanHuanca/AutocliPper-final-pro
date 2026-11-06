ALTER TABLE pipelines DROP CONSTRAINT pipelines_remaining_reservation_bytes_check;
ALTER TABLE pipelines ADD CONSTRAINT pipelines_remaining_reservation_bytes_check
  CHECK(remaining_reservation_bytes IN (0,68157440,136314880,202375168,204472320,270532608,338690048));
