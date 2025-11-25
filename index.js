const fs = require("fs");
const https = require("https");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

// Para recibir JSON
app.use(express.json());

// =====================================================
//   CARGA DEL CERTIFICADO FNMT DESDE SECRET FILE
// =====================================================
let certBuffer = null;
let certPassphrase = process.env.FNMT_CERT_PASS || null;

try {
  const certBase64 = fs
    .readFileSync("/etc/secrets/fnmt-cert.b64", "utf8")
    .toString()
    .trim();

  certBuffer = Buffer.from(certBase64, "base64");

  console.log(
    "✅ Certificado FNMT cargado. Tamaño:",
    certBuffer.length,
    "bytes"
  );
} catch (err) {
  console.warn("⚠️ No se pudo cargar el certificado FNMT:", err.message);
}

// Crear agente MTLS con pfx + passphrase
function crearAgenteMTLS() {
  if (!certBuffer || !certPassphrase) {
    throw new Error("Certificado o contraseña no disponibles");
  }

  return new https.Agent({
    pfx: certBuffer,
    passphrase: certPassphrase,
    rejectUnauthorized: true,
  });
}

// =====================================================
//                    RUTAS BÁSICAS
// =====================================================

// Estado general
app.get("/", (req, res) => {
  const estado = certBuffer ? "CARGADO" : "NO CARGADO";
  res.send("Microservicio Verifactu. Certificado: " + estado);
});

// Test MTLS (solo crea el agente)
app.get("/test-mtls", (req, res) => {
  try {
    const agent = crearAgenteMTLS();
    const ok = typeof agent.createConnection === "function";
    res.send("Agente MTLS creado. createConnection=" + ok);
  } catch (err) {
    res.status(500).send("Error MTLS: " + err.message);
  }
});

// =====================================================
//     ENDPOINT /factura CON API KEY DE SEGURIDAD
// =====================================================

const API_KEY = process.env.FACTURA_API_KEY || null;

app.post("/factura", (req, res) => {
  // 1. Comprobación de que existe clave en el servidor
  if (!API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "FACTURA_API_KEY no configurada en el servidor",
    });
  }

  // 2. Comprobar cabecera enviada por Base44
  const headerKey = req.headers["x-api-key"];

  if (headerKey !== API_KEY) {
    return res.status(401).json({
      ok: false,
      error: "No autorizado. API KEY incorrecta.",
    });
  }

  // 3. Mostrar JSON recibido
  console.log("📥 Factura recibida:");
  console.log(JSON.stringify(req.body, null, 2));

  // 4. Respuesta
  res.json({
    ok: true,
    mensaje: "Factura recibida correctamente en el microservicio",
    facturaRecibida: req.body,
  });
});

// =====================================================
//               TEST AEAT (SOAP de prueba)
// =====================================================

app.get("/test-aeat", (req, res) => {
  let respuestaAEAT = "";

  // ⚠️ CAMBIA TU_NIF_AQUI (2 veces)
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"
  xmlns:sum1="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <sum:RegFactuSistemaFacturacion>
      <sum:Cabecera>
        <sum1:ObligadoEmision>
          <sum1:NombreRazon>EMPRESA PRUEBA VERIFACTU</sum1:NombreRazon>
          <sum1:NIF>TU_NIF_AQUI</sum1:NIF>
        </sum1:ObligadoEmision>
      </sum:Cabecera>
      <sum:RegistroFactura>
        <sum1:RegistroAlta>
          <sum1:IDVersion>1.0</sum1:IDVersion>
          <sum1:IDFactura>
            <sum1:IDEmisorFactura>
              <sum1:NIF>TU_NIF_AQUI</sum1:NIF>
            </sum1:IDEmisorFactura>
            <sum1:NumSerieFactura>VF-TEST-0001</sum1:NumSerieFactura>
            <sum1:FechaExpedicionFactura>2025-01-01</sum1:FechaExpedicionFactura>
          </sum1:IDFactura>
          <sum1:NombreRazonEmisor>EMPRESA PRUEBA VERIFACTU</sum1:NombreRazonEmisor>
          <sum1:TipoFactura>F1</sum1:TipoFactura>
          <sum1:DescripcionOperacion>Prueba alta registro VeriFactu</sum1:DescripcionOperacion>
          <sum1:Destinatarios>
            <sum1:IDDestinatario>
              <sum1:NombreRazon>CLIENTE PRUEBA</sum1:NombreRazon>
              <sum1:NIF>99999999R</sum1:NIF>
            </sum1:IDDestinatario>
          </sum1:Destinatarios>
          <sum1:Desglose>
            <sum1:DetalleDesglose>
              <sum1:ClaveRegimen>01</sum1:ClaveRegimen>
              <sum1:CalificacionOperacion>S1</sum1:CalificacionOperacion>
              <sum1:TipoImpositivo>21.00</sum1:TipoImpositivo>
              <sum1:BaseImponible>100.00</sum1:BaseImponible>
              <sum1:CuotaRepercutida>21.00</sum1:CuotaRepercutida>
            </sum1:DetalleDesglose>
          </sum1:Desglose>
        </sum1:RegistroAlta>
      </sum:RegistroFactura>
    </sum:RegFactuSistemaFacturacion>
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
        "SOAPAction":
          "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SistemaFacturacion/altaRegistroFactura",
      },
      timeout: 15000,
    };

    const request = https.request(options, (response) => {
      response.setEncoding("utf8");

      response.on("data", (chunk) => {
        respuestaAEAT += chunk;
      });

      response.on("end", () => {
        const resumen =
          respuestaAEAT.length > 2000
            ? respuestaAEAT.slice(0, 2000) + "\n...[truncado]..."
            : respuestaAEAT;

        const texto =
          "Código AEAT: " +
          response.statusCode +
          "\n\nRespuesta:\n" +
          resumen;

        res.status(200).send(texto);
      });
    });

    request.on("error", (err) => {
      res.status(500).send("Error AEAT: " + err.message);
    });

    request.on("timeout", () => {
      request.destroy();
      res.status(504).send("Timeout AEAT");
    });

    request.write(bodyBuffer);
    request.end();
  } catch (err) {
    res.status(500).send("Error preparando llamada AEAT: " + err.message);
  }
});

// =====================================================
//                 INICIAR SERVIDOR
// =====================================================

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

