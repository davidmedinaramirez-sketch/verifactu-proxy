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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
