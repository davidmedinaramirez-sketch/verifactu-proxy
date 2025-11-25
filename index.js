const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();

// Para aceptar texto (XML) en el body
app.use(express.text({ type: "*/*" }));

// Token configurado en Render
const API_TOKEN = process.env.API_TOKEN || "DEV_TOKEN";

// --------------------------------------------------------------
// RUTA SIMPLE PARA PROBAR QUE EL SERVIDOR ESTÁ VIVO
// --------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// --------------------------------------------------------------
// RUTA PRINCIPAL PARA BASE44 (de momento solo eco)
// --------------------------------------------------------------
app.post("/verifactu/send", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${API_TOKEN}`;

  if (auth !== expected) {
    return res.status(401).send("Unauthorized");
  }

  const xml = req.body || "";

  return res.send(
    `<debug>He recibido esto en el proxy:</debug>\n${xml}`
  );
});

// --------------------------------------------------------------
// RUTA DE PRUEBA: CONEXIÓN mTLS REAL CON LA AEAT
// --------------------------------------------------------------
app.post("/debug/aeat", (req, res) => {
  try {
    const auth = req.headers["authorization"] || "";
    const expected = `Bearer ${API_TOKEN}`;
    if (auth !== expected) {
      return res.status(401).send("Unauthorized");
    }

    const xml =
      req.body && req.body.trim()
        ? req.body
        : "<test>ping desde proxy</test>";

    // Ruta del certificado en Render Secret Files
    const p12Path = "/etc/secrets/MEDINA_RAMIREZ_DAVID___03949255V.p12";

    // Leer certificado directamente (sin base64 → sin errores)
    const p12Buffer = fs.readFileSync(p12Path);

    const options = {
      hostname: "prewww10.aeat.es",
      port: 443,
      path: "/", // luego cambiaremos a la ruta VeriFactu real
      method: "POST",
      pfx: p12Buffer,
      passphrase: process.env.CLIENT_P12_PASS, // Dmr_1996%
      rejectUnauthorized: false, // aceptamos certificados AEAT de test
      headers: {
        "Content-Type": "application/xml",
        "Content-Length": Buffer.byteLength(xml, "utf8"),
      },
    };

    const aeatReq = https.request(options, (aeatRes) => {
      let data = "";

      aeatRes.on("data", (chunk) => (data += chunk));

      aeatRes.on("end", () => {
        const status = aeatRes.statusCode || 0;
        const preview = data.slice(0, 1500); // primeros 1500 chars
        return res.status(200).send(
          `Status AEAT: ${status}\n\n---\nPrimeros datos recibidos:\n\n${preview}`
        );
      });
    });

    aeatReq.on("error", (e) => {
      console.error("Error comunicando con AEAT:", e);
      return res
        .status(502)
        .send("Error comunicando con AEAT (handshake/red): " + e.message);
    });

    aeatReq.write(xml);
    aeatReq.end();
  } catch (e) {
    console.error("Excepción en /debug/aeat:", e);
    return res.status(500).send("
