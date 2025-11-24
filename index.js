const express = require("express");
const app = express();

// Para aceptar texto (XML) en el body
app.use(express.text({ type: "*/*" }));

// Ruta de prueba
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// Ruta que usará Base44 para mandarte el XML
app.post("/verifactu/send", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${process.env.API_TOKEN || "DEV_TOKEN"}`;

  if (auth !== expected) {
    return res.status(401).send("Unauthorized");
  }

  const xml = req.body;

  console.log("XML recibido de Base44:");
  console.log(xml);

  // De momento solo devolvemos algo de prueba
  res.send("<respuesta>Recibido en el proxy (aún sin enviar a AEAT)</respuesta>");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Servidor escuchando en puerto " + port);
});
