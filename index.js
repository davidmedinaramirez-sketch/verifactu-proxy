const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();

app.use(express.text({ type: "*/*" }));

const API_TOKEN = process.env.API_TOKEN || "DEV_TOKEN";
const AEAT_HOST = process.env.AEAT_HOST || "prewww10.aeat.es";
const AEAT_PATH =
  process.env.AEAT_PATH ||
  "/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP";
const P12_PATH =
  process.env.P12_PATH || "/etc/secrets/MEDINA_RAMIREZ_DAVID___03949255V.p12";
const P12_PASS = process.env.CLIENT_P12_PASS;

// Helper para SOAP
function buildSoapEnvelopeIfNeeded(rawXml) {
  const trimmed = (rawXml || "").trim();
  if (trimmed.includes("<soapenv:Envelope") || trimmed.includes("<soap:Envelope")) {
    return trimmed;
  }
  return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    ${trimmed}
  </soapenv:Body>
</soapenv:Envelope>`.trim();
}

// Endpoint para verificación viva
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// Endpoint de debugging: descarga el p12 tal cual Render lo tiene
app.get("/debug/download-p12", (req, res) => {
  try {
    const data = fs.readFileSync(P12_PATH);
    res.set('Content-Type', 'application/x-pkcs12');
    res.send(data);
  } catch (err) {
    res.status(500).send("Error: " + err);
  }
});

// Ruta principal (inicial)
app.post("/verifactu/send", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${API_TOKEN}`;
  if (auth !== expected) {
    return res.status(401).send("Unauthorized");
  }

  const rawXml = req.body || "";
  const soapEnvelope = buildSoapEnvelopeIfNeeded(rawXml);

  let p12Buffer;
  try {
    // ------------ LOGS DE DIAGNÓSTICO -----------
    p12Buffer = fs.readFileSync(P12_PATH);
    console.log("P12 PATH:", P12_PATH);
    console.log("P12 Buffer size:", p12Buffer.length);
    console.log("P12 First 16 bytes HEX:", p12Buffer.slice(0,16).toString("hex"));
    // ----------------------------------------------
  } catch (e) {
    console.error("No se ha podido leer el P12:", e);
    return res
      .status(500)
      .send("Error leyendo el certificado P12 en el servidor.");
  }

  if (!P12_PASS) {
    return res
      .status(500)
      .send("CLIENT_P12_PASS no está configurada en Environment Variables.");
  }

  const options = {
    hostname: AEAT_HOST,
    port: 443,
    path: AEAT_PATH,
    method: "POST",
    pfx: p12Buffer,
    passphrase: P12_PASS,
    rejectUnauthorized: false,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": "",
      "Content-Length": Buffer.byteLength(soapEnvelope, "utf8"),
    },
  };

  const aeatReq = https.request(options, (aeatRes) => {
    let data = "";

    aeatRes.on("data", (chunk) => (data += chunk));

    aeatRes.on("end", () => {
      res
        .status(aeatRes.statusCode || 500)
        .send(data || "");
    });
  });

  aeatReq.on("error", (err) => {
    console.error("Error mTLS / conexión con AEAT:", err);
    res
      .status(502)
      .send("Error comunicando con AEAT: " + (err.message || "desconocido"));
  });

  aeatReq.write(soapEnvelope);
  aeatReq.end();
});

// --------------------------------------------------------------
// RUTA DE PRUEBA: /debug/aeat → Envío de un RF de prueba vacío
// --------------------------------------------------------------
app.post("/debug/aeat", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${API_TOKEN}`;
  if (auth !== expected) {
    return res.status(401).send("Unauthorized");
  }

  try {
    // ------------ LOGS DE DIAGNÓSTICO -----------
    const p12Buffer = fs.readFileSync(P12_PATH);
    console.log("P12 PATH:", P12_PATH);
    console.log("P12 Buffer size:", p12Buffer.length);
    console.log("P12 First 16 bytes HEX:", p12Buffer.slice(0,16).toString("hex"));
    // ----------------------------------------------

    const dummyRF = `
<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd">
  <!-- Aquí iría el contenido real del RF. Esto es solo una prueba de canal. -->
</sfLR:RegFactuSistemaFacturacion>
    `.trim();

    const xml = buildSoapEnvelopeIfNeeded(dummyRF);

    const options = {
      hostname: AEAT_HOST,
      port: 443,
      path: AEAT_PATH,
      method: "POST",
      pfx: p12Buffer,
      passphrase: P12_PASS,
      rejectUnauthorized: false,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "",
        "Content-Length": Buffer.byteLength(xml, "utf8"),
      },
    };

    console.log("=== DEPURANDO PETICIÓN AEAT ===");
    console.log("Cabeceras HTTPS:", options.headers);
    console.log("Tamaño del body (SOAP):", Buffer.byteLength(xml, "utf8"));
    console.log("Host destino:", options.hostname);
    console.log("Ruta destino:", options.path);
    console.log("===============================");

    const r = https.request(options, (resp) => {
      let data = "";
      resp.on("data", (chunk) => (data += chunk));
      resp.on("end", () => {
        const status = resp.statusCode || 0;
        const preview = data.slice(0, 2000);
        console.log("Cabeceras RES de AEAT:", resp.headers);
        res
          .status(200)
          .send(`Status AEAT: ${status}\n\nPrimeros datos:\n\n${preview}`);
      });
    });

    r.on("error", (err) => {
      console.error("Error en /debug/aeat:", err && err.stack ? err.stack : err);
      res.status(500).send("Error mTLS en /debug/aeat: " + err.message);
    });

    r.write(xml);
    r.end();
  } catch (e) {
    console.error("Error interno en /debug/aeat:", e && e.stack ? e.stack : e);
    res.status(500).send("Error interno en /debug/aeat: " + e.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
