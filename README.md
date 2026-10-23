# PhishScoutSentinel

Extensión piloto de Thunderbird para inspección local de EML y apoyo al triaje SOC.
Derivada de PeelScout de ExploitBlock; conserva su atribución MIT.

## Uso

Pulsa **Analizar con PhishScoutSentinel** en un correo o abre el panel desde la
barra de herramientas. También puedes usar **Abrir EML** para analizar un archivo
sin importarlo al buzón. Si no puede recuperarse el correo mediante la API de
Thunderbird, el panel informa el error y permite abrir el archivo.

Selecciona el original en **Mensajes del archivo**. El reporte externo y cada
mensaje adjunto conservan headers, contenido, hashes y decisiones independientes.
El buzón de phishing no determina Internal Communication. La autenticación se
muestra como headers declarados, sin afirmar verificación de firmas o procedencia.

El panel muestra texto y HTML como código fuente. No inserta HTML del correo,
no sigue enlaces ni descarga sus imágenes. Las vistas PNG/JPEG son locales y
requieren un clic del analista. La protección se aplica al panel; no modifica las
preferencias de visualización del Thunderbird anfitrión.

## Alcance de 0.1.0

- Parser MIME PostalMime 4.1.4, charsets, headers repetidos, EML anidados.
- SHA-256 del archivo, mensajes y adjuntos; URLs completas y origen.
- Extracción local de wrappers, URLs HTML/texto/calendarios y teléfonos candidatos.
- Revisión manual: ruta obligatoria para FIR/Malicious y fundamento obligatorio.
- Simulation requiere documentar corroboración y fuente: un dominio o header
  aislado no demuestra un ejercicio. La verificación externa es manual.
- Decisiones por objetivo, informe al portapapeles y exportación JSON local.
- Sin persistencia automática. Cerrar o limpiar elimina el estado del panel;
  portapapeles y exportaciones tienen su propio ciclo de vida.

**Pendiente:** catálogo y comprobación de dominios de simulación, WHOIS/RDAP,
clasificación asistida completa, OCR, QR y contenido PDF/Office/comprimidos.
Un archivo inventariado no implica haber examinado su contenido. Este piloto no
implementa aún todas las reglas operativas ni sustituye la revisión del analista.
No modifica PhishLabs ni cierra incidentes.

Límites: 25 MiB por EML; 75 MiB acumulados en mensajes procesados; 30 mensajes,
8 capas RFC822, 32 capas MIME, 1000 partes/adjuntos y 20 segundos por trabajo.
Se informa rechazo u omisión. Los bytes del archivo no se modifican.
La vista muestra hasta 200 indicadores; la exportación incluye los extraídos.
La extracción se limita a 500000 caracteres por fuente de texto, 100000 de HTML,
2000 indicadores por fuente y 5000 por mensaje. Las omisiones se muestran y se
exportan como cobertura parcial; las fuentes textuales completas se conservan.
Formatos no soportados no se presentan como cifrados ni bloqueados.

## Pruebas y empaquetado

Requiere Node.js 20 o posterior; no necesita npm ni acceso de red.

```sh
node --test tests/foundation.test.mjs
node tools/build.mjs
```

Produce XPI sin firma, ZIP de fuentes y SHA256SUMS.txt en dist/. Usa una lista
explícita de archivos y dependencias incluidas con licencia y procedencia en
THIRD_PARTY.md. ZIP determinista para el mismo contenido y Node/zlib.
No incluye guías privadas ni datos de clientes.

## Prueba en Thunderbird

Mínimo declarado: 128.0. La integración debe validarse en la versión del analista;
Node y el panel web no acreditan integración real con Thunderbird.

Para una prueba temporal, descomprime el ZIP de fuentes en una carpeta dedicada,
abre Herramientas → Herramientas de desarrollo → Depurar complementos y utiliza
Cargar complemento temporal con manifest.json. Usa un perfil de prueba y el
botón Cargar ejemplo sintético; la carga temporal no persiste tras reiniciar.

El XPI es un artefacto de prueba sin firma. No se ha instalado ni publicado como
release. No reduzcas controles de seguridad para instalarlo; usa el flujo de
desarrollo disponible o prepara la distribución según los requisitos aplicables.
