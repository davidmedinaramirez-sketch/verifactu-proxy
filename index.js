const express = require("express");
const https = require("https");
const app = express();

// Para aceptar texto (XML) en el body
app.use(express.text({ type: "*/*" }));

// Token que ya tienes en Render
const API_TOKEN = process.env.API_TOKEN || "DEV_TOKEN";

// Ruta simple para ver que vive
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// Ruta que usará Base44
app.post("/verifactu/send", (req, res) => {
  // 1) Comprobar token
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${API_TOKEN}`;
  if (auth !== expected) {
    return res.status(401).send("Unauthorized");
  }

  // 2) XML que te envíe Base44 (de momento usaremos lo que llegue)
  const xml = req.body || "<test>ping</test>";

  // 3) Preparar opciones de conexión a AEAT (preproducción)
  const options = {
    hostname: "prewww10.aeat.es",
    port: 443,
    path: "/",              // más adelante pondremos la ruta real de VeriFactu
    method: "POST",
    pfx: Buffer.from(process.env.CLIENT_P12 || "", "base64"),
    passphrase: process.env.CLIENT_P12_PASS,
    // si has metido las CA de AEAT en env vars, se podrían añadir aquí
    // ca: [ Buffer.from(process.env.AEAT_CA_ROOT || "", "base64"), ... ],
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
      // devolvemos a quien llama exactamente lo que conteste AEAT
      res.status(aeatRes.statusCode || 500).send(data || "");
    });
  });

  aeatReq.on("error", (e) => {
    console.error("Error comunicando con AEAT:", e);
    res.status(502).send("Error comunicando con AEAT");
  });

  // 4) Enviar el XML a AEAT
  aeatReq.write(xml);
  aeatReq.end();
});

  } catch (e) {
    console.error("Error leyendo CLIENT_P12:", e);
    return res.status(500).send("Error leyendo CLIENT_P12 en el servidor.");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
