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
    res.send(
      "Agente MTLS creado correctamente. createConnection: " + tieneSockets
    );
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

// 🔹 NUEVA RUTA: llamada de prueba a la AEAT en entorno de pruebas
app.get("/test-aeat", (req, res) => {
  let respuestaAEAT = "";

  // SOAP muy simple y seguramente inválido a nivel de negocio,
  // pero suficiente para comprobar conectividad + MTLS.
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <sf:PingVerifactu>TEST</sf:PingVerifactu>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const agent = crearAgenteMTLS();
    const bodyBuffer = Buffer.from(soapBody, "utf8");

    const options = {
      hostname: "prewww1.aeat.es",
      port: 443,
      path: "/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
      method: "POST",
      agent,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Content-Length": bodyBuffer.length,
        // SOAPAction oficial para altaRegistroFactura en sandbox
        // (aunque nuestro XML no sea un alta real)
        "SOAPAction":
          "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SistemaFacturacion/altaRegistroFactura",
      },
      timeout: 15000, // 15 segundos
    };

    const request = https.request(options, (response) => {
      response.setEncoding("utf8");

      response.on("data", (chunk) => {
        respuestaAEAT += chunk;
      });

      response.on("end", () => {
        const resumen =
          respuestaAEAT.length > 1000
            ? respuestaAEAT.slice(0, 1000) + "\n...[truncado]..."
            : respuestaAEAT;

        res
          .status(200)
          .send(
            "Código de estado AEAT: " +
              response.statusCode +
              "\n\nRespuesta (primeros caracteres):\n" +
              resumen
          );
      });
    });

    request.on("error", (err) => {
      console.error("Error en llamada a AEAT:", err.message);
      res.status(500).send("Error en llamada a AEAT: " + err.message);
    });

    request.on("timeout", () => {
      request.destroy();
      res.status(504).send("Timeout al llamar a la AEAT");
    });

    request.write(bodyBuffer);
    request.end();
  } catch (err) {
    console.error("Error preparando llamada a AEAT:", err.message);
    res.status(500).send("Error preparando llamada a AEAT: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
