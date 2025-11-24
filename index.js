const express = require("express");
const https = require("https");

const app = express();

// Para aceptar texto (XML) en el body
app.use(express.text({ type: "*/*" }));

// Token configurado en Render
const API_TOKEN = process.env.API_TOKEN || "DEV_TOKEN";

// 🔧 Función opcional para cargar las CA de AEAT
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

// Ruta simple para probar que está vivo
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// --------------------------------------------------------------
// RUTA PRINCIPAL PARA BASE44
// (de momento solo eco, NO toca AEAT aún)
// --------------------------------------------------------------
app.post("/debug/aeat", (req, res) => {
  try {
    const auth = req.headers["authorization"] || "";
    const expected = `Bearer ${API_TOKEN}`;
    if (auth !== expected) {
      return res.status(401).send("Unauthorized");
    }

    const xml = req.body && req.body.trim()
      ? req.body
      : "<test>ping desde proxy</test>";

    const options = {
      hostname: "prewww10.aeat.es",
      port: 443,
      path: "/", // luego pondremos la ruta real de VeriFactu
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

      aeatRes.on("data", chunk => data += chunk);

      aeatRes.on("end", () => {
        const status = aeatRes.statusCode || 0;
        const preview = data.slice(0, 1000);
        return res.status(200).send(
          `Status AEAT: ${status}\n\nPrimeros datos devueltos por AEAT:\n\n${preview}`
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
    return res
      .status(500)
      .send("Excepción en /debug/aeat: " + e.message);
  }
});

// --------------------------------------------------------------

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
