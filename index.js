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

  // 2) Intentar leer el P12 y, si existe, decir su tamaño
  try {
    const p12Base64 = process.env.CLIENT_P12 || "";
    const p12Buffer = Buffer.from(p12Base64, "base64");

    if (!p12Buffer.length) {
      return res
        .status(500)
        .send("CLIENT_P12 vacío o no configurado en Render.");
    }

    return res.send(
      `Certificados cargados OK. Tamaño p12: ${p12Buffer.length} bytes.`
    );
  } catch (e) {
    console.error("Error leyendo CLIENT_P12:", e);
    return res.status(500).send("Error leyendo CLIENT_P12 en el servidor.");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
