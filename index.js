const express = require("express");
const https = require("https");
const app = express();

// Para aceptar texto (XML) en el body
app.use(express.text({ type: "*/*" }));

// Token que ya tienes en Render
const API_TOKEN = process.env.API_TOKEN || "DEV_TOKEN";

// Opcional: construir el bundle de CA de AEAT si las tienes en env vars
function buildCaBundle() {
  const parts = [];
  if (process.env.AEAT_CA_ROOT) {
    parts.push(Buffer.from(process.env.AEAT_CA_ROOT, "base64"));
  }
  if (process.env.AEAT_CA_INTER1) {
    parts.push(Buffer.from(process.env.AEAT_CA_INTER1, "base64"));
  }
  if (process.env.AEAT_CA_INTER2) {
    parts.push(Buffer.from(process.env.AEAT_CA_INTER2, "base64"));
  }
  if (process.env.AEAT_CA_INTER3) {
    parts.push(Buffer.from(process.env.AEAT_CA_INTER3, "base64"));
  }
  return parts.length > 0 ? parts : undefined;
}

// Ruta simple para ver que vive
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// Ruta sencilla de prueba para VeriFactu
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

// Ruta de pruebas para comprobar conexión mTLS con AEAT
app.post("/debug/aeat", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${API_TOKEN}`;
  if (auth !== expected) {
    return res.status(401).send("Unauthorized");
  }

  // XML de prueba (podríamos usar req.body, pero para empezar vale esto)
  const xml = req.body && req.body.trim()
    ? req.body
    : "<test>ping desde proxy</test>";

  // Opciones de conexión a AEAT PRE
  const options = {
    hostname: "prewww10.aeat.es",
    port: 443,
    path: "/", // más adelante pondremos la ruta real de VeriFactu
    method: "POST",
    pfx: Buffer.from(process.env.CLIENT_P12 || "", "base64"),
    passphrase: process.env.CLIENT_P12_PASS,
    ca: buildCaBundle(),
    headers: {
      "Content-Type": "application/xml",
      "Content-Length": Buffer.byteLength(xml, "utf8")
    }
  };

  const aeatReq = https.request(options, (aeatRes) => {
    let data = "";

    aeatRes.on("data", (chunk) => {
      data += chunk;
    });

    aeatRes.on("end", () => {
      const status = aeatRes.statusCode || 0;
      // Devolvemos solo las primeras líneas para no liarla
      const preview = data.slice(0, 1000); // primera 1000 chars

      res
        .status(200)
        .send(
          `Status AEAT: ${status}\n\nPrimeros datos devueltos por AEAT:\n\n${preview}`
        );
    });
  });

  aeatReq.on("error", (e) => {
    console.error("Error comunicando con AEAT:", e);
    res.status(502).send("Error comunicando con AEAT: " + e.message);
  });

  aeatReq.write(xml);
  aeatReq.end();
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
