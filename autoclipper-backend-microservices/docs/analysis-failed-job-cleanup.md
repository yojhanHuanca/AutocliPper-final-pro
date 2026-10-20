# Limpieza acotada de artefactos Analysis

Analysis marca `cleanup_pending` los trabajos terminales fallidos o cancelados. Un proceso periódico elimina transcripciones y selecciones de segmentos dentro de una transacción y luego retira la marca. Si el proceso cae o la transacción falla, los datos y la marca revierten juntos; un runtime nuevo reintenta. Se conservan el estado terminal y los metadatos de fases/proveedores para diagnóstico y conciliación.

El alcance excluye deliberadamente trabajos exitosos, referencias y metadatos `source`/`spec`, objetos fuente/derivados fuera de la base Analysis, historial de intentos externos, exportación de datos, referencias de otros servicios y toda purga global. No decide retención de resultados exitosos ni eliminación en proveedores. Esta limpieza técnica no satisface una solicitud integral de privacidad.

El fixture de recuperación crea trabajos fallidos/cancelados, un éxito y un trabajo de control de otro workspace. Inyecta un error al finalizar la primera transacción, reinicia el runtime y comprueba el reintento, la idempotencia y la preservación de los casos excluidos.
