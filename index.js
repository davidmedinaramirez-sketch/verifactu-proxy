const fs = require("fs");
const https = require("https");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

// Middleware para entender JSON en el cuerpo de la petición
app.use(express.json());

// Intentamos cargar el certificado FNMT desde el Secret File
let certBuffer = null;
let certPassphrase = process.env.FNMT_CERT_PASS || null;

try {
  const certBase64 = fs
    .readFileSync("/etc/secrets/fnmt-cert.b64", "utf8")
    .toString()
    .trim();
  certBuffer = Buffer.from(certBase64, "base64");
  console.log(
    "✅ Certificado FNMT cargado en memoria. Tamaño:",
    certBuffer.length,
    "bytes"
  );
} catch (err) {
  console.warn("⚠️ No se pudo cargar el certificado FNMT:", err.message);
}

// Función para crear un agente MTLS con tu certificado FNMT
function crearAgenteMTLS() {
  if (!certBuffer || !certPassphrase) {
    throw new Error("Certificado o contraseña no disponibles");
  }

  const agent = new https.Agent({
    pfx: certBuffer,
    passphrase: certPassphrase,
    rejectUnauthorized: true,
  });

  return agent;
}

// Ruta principal: estado básico
app.get("/", (req, res) => {
  const estadoCert = certBuffer ? "CARGADO" : "NO CARGADO";
  res.send("Microservicio Verifactu en Render. Certificado: " + estadoCert);
});

// Ruta de prueba MTLS (solo crea el agente, no llama a AEAT aún)
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

// 🔹 NUEVA RUTA: punto de entrada de facturas desde tu ERP (Base44)
app.post("/factura", (req, res) => {
  const factura = req.body; // lo que mande Base44 en JSON

  console.log("📥 Factura recibida:", JSON.stringify(factura, null, 2));

  // De momento solo devolvemos algo simple
  res.json({
    ok: true,
    mensaje: "Factura recibida en el microservicio",
    facturaRecibida: factura,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
