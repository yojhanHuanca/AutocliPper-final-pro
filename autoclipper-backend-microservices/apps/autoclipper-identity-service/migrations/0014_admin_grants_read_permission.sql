ALTER TABLE admin_grants
  DROP CONSTRAINT admin_grants_permissions_check,
  ADD CONSTRAINT admin_grants_permissions_check
    CHECK (
      cardinality(permissions) BETWEEN 1 AND 6
      AND permissions <@ ARRAY[
        'users.read',
        'workspaces.read',
        'jobs.read',
        'consumption.read',
        'audit.read',
        'grants.read'
      ]::text[]
      AND array_position(permissions, NULL) IS NULL
    );

ALTER TABLE admin_access_audit
  DROP CONSTRAINT admin_access_audit_permission_check,
  ADD CONSTRAINT admin_access_audit_permission_check
    CHECK (permission IN (
      'users.read',
      'workspaces.read',
      'jobs.read',
      'consumption.read',
      'audit.read',
      'grants.read'
    ));

ALTER TABLE admin_access_audit
  DROP CONSTRAINT admin_access_audit_grant_permissions_check,
  ADD CONSTRAINT admin_access_audit_grant_permissions_check
    CHECK (
      grant_permissions IS NULL
      OR (
        cardinality(grant_permissions) BETWEEN 1 AND 6
        AND grant_permissions <@ ARRAY[
          'users.read',
          'workspaces.read',
          'jobs.read',
          'consumption.read',
          'audit.read',
          'grants.read'
        ]::text[]
        AND array_position(grant_permissions, NULL) IS NULL
      )
    );
