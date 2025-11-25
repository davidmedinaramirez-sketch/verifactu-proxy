const fs = require("fs");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

// Intentamos cargar el certificado FNMT desde el Secret File
let certBuffer = null;
let certPassphrase = process.env.FNMT_CERT_PASS || null;

try {
  // Ruta donde Render monta los Secret Files
  const certBase64 = fs.readFileSync("/etc/secrets/fnmt-cert.b64", "utf8").toString().trim();
  certBuffer = Buffer.from(certBase64, "base64");
  console.log("✅ Certificado FNMT cargado en memoria. Tamaño:", certBuffer.length, "bytes");
} catch (err) {
  console.warn("⚠️ No se pudo cargar el certificado FNMT:", err.message);
}

app.get("/", (req, res) => {
  const estadoCert = certBuffer ? "CARGADO" : "NO CARGADO";
  res.send("Microservicio Verifactu en Render. Certificado: " + estadoCert);
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
