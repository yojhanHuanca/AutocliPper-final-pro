`speech-es.wav` is an explicitly synthetic test recording generated locally from our own text with Windows SAPI Microsoft Helena Desktop. It contains no real person's recording, customer data, provider response, or invented ASR result. PCM signed 16-bit, mono, 16 kHz, approximately 13.8 seconds. SHA-256: `c65f93e4131a8832d8248b47de626849f19e37b15b12c17c6e3e766ac80e1c48`.

Source text: “Esta es una grabación sintética de prueba. Nuestro proyecto convierte videos en clips con subtítulos. La información debe ser clara y fácil de entender. Cada usuario solo puede acceder a sus propios videos.”

This small fixture lets the opt-in local acceptance test execute actual whisper.cpp inference. Expected keywords verify the connection, not transcript accuracy or a thesis evaluation result. Unit adapter responses are fixtures restricted to tests and do not satisfy real provider acceptance.
