const fs = require("fs");
const https = require("https"); // 👈 nuevo
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

// 🧠 Función para crear un agente MTLS con tu certificado FNMT
function crearAgenteMTLS() {
  if (!certBuffer || !certPassphrase) {
    throw new Error("Certificado o contraseña no disponibles");
  }

  const agent = new https.Agent({
    pfx: certBuffer,        // usamos el .p12 directamente
    passphrase: certPassphrase,
    rejectUnauthorized: true // validará el cert. del servidor al que nos conectemos
  });

  return agent;
}

// Ruta principal (estado básico)
app.get("/", (req, res) => {
  const estadoCert = certBuffer ? "CARGADO" : "NO CARGADO";
  res.send("Microservicio Verifactu en Render. Certificado: " + estadoCert);
});

// Ruta de prueba MTLS (solo crea el agente, no llama a AEAT)
app.get("/test-mtls", (req, res) => {
  try {
    const agent = crearAgenteMTLS();
    const tieneSockets = typeof agent.createConnection === "function";
    res.send("Agente MTLS creado correctamente. createConnection: " + tieneSockets);
  } catch (err) {
    console.error("Error al crear agente MTLS:", err.message);
    res.status(500).send("Error al crear agente MTLS: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
