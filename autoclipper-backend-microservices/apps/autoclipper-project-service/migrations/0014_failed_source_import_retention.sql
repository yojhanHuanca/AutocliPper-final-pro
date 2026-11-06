CREATE INDEX source_imports_failed_cleanup_idx
  ON source_imports(updated_at,id)
  WHERE state='failed';
