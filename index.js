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
//    UTILIDADES: CONSTRUIR XML Y LLAMAR A LA AEAT
// =====================================================

// Construye un XML de RegistroAlta a partir del JSON de factura
function construirXmlAlta(factura) {
  const obligadoNombre = factura.empresa_razon_social || "OBLIGADO EMISOR";
  const obligadoNif = factura.empresa_cif || "00000000T";

  const clienteNombre = factura.cliente_nombre || "CLIENTE DESCONOCIDO";
  const clienteNif = factura.cliente_nif || "99999999R";

  const numeroFactura = factura.numero_factura || "SIN-NUMERO";
  const fechaEmision = factura.fecha_emision || "2025-01-01";
  const tipoFactura = factura.tipo_factura || "F1";
  const descripcionOperacion =
    factura.observaciones ||
    factura.categoria_contabilidad ||
    "Operacion facturada";

  const base =
    typeof factura.base_neta === "number"
      ? factura.base_neta
      : typeof factura.base_bruta === "number"
      ? factura.base_bruta
      : typeof factura.base_imponible === "number"
      ? factura.base_imponible
      : factura.total || 0;

  const iva =
    typeof factura.iva_total === "number" ? factura.iva_total : 0;

  const tipoImpositivo = base > 0 ? (iva / base) * 100 : 0;

  const tipoImpositivoStr = tipoImpositivo.toFixed(2);
  const baseStr = base.toFixed(2);
  const ivaStr = iva.toFixed(2);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"
  xmlns:sum1="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <sum:RegFactuSistemaFacturacion>
      <sum:Cabecera>
        <sum1:ObligadoEmision>
          <sum1:NombreRazon>${obligadoNombre}</sum1:NombreRazon>
          <sum1:NIF>${obligadoNif}</sum1:NIF>
        </sum1:ObligadoEmision>
      </sum:Cabecera>
      <sum:RegistroFactura>
        <sum1:RegistroAlta>
          <sum1:IDVersion>1.0</sum1:IDVersion>
          <sum1:IDFactura>
            <sum1:IDEmisorFactura>
              <sum1:NIF>${obligadoNif}</sum1:NIF>
            </sum1:IDEmisorFactura>
            <sum1:NumSerieFactura>${numeroFactura}</sum1:NumSerieFactura>
            <sum1:FechaExpedicionFactura>${fechaEmision}</sum1:FechaExpedicionFactura>
          </sum1:IDFactura>
          <sum1:NombreRazonEmisor>${obligadoNombre}</sum1:NombreRazonEmisor>
          <sum1:TipoFactura>${tipoFactura}</sum1:TipoFactura>
          <sum1:DescripcionOperacion>${descripcionOperacion}</sum1:DescripcionOperacion>
          <sum1:Destinatarios>
            <sum1:IDDestinatario>
              <sum1:NombreRazon>${clienteNombre}</sum1:NombreRazon>
              <sum1:NIF>${clienteNif}</sum1:NIF>
            </sum1:IDDestinatario>
          </sum1:Destinatarios>
          <sum1:Desglose>
            <sum1:DetalleDesglose>
              <sum1:ClaveRegimen>01</sum1:ClaveRegimen>
              <sum1:CalificacionOperacion>S1</sum1:CalificacionOperacion>
              <sum1:TipoImpositivo>${tipoImpositivoStr}</sum1:TipoImpositivo>
              <sum1:BaseImponible>${baseStr}</sum1:BaseImponible>
              <sum1:CuotaRepercutida>${ivaStr}</sum1:CuotaRepercutida>
            </sum1:DetalleDesglose>
          </sum1:Desglose>
        </sum1:RegistroAlta>
      </sum:RegistroFactura>
    </sum:RegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

  return xml;
}

// Llamada a la AEAT (entorno de pruebas) con MTLS
function enviarXmlAEAT(soapBody) {
  return new Promise((resolve, reject) => {
    const agent = crearAgenteMTLS();
    const bodyBuffer = Buffer.from(soapBody, "utf8");

    const options = {
      hostname: "prewww1.aeat.es", // ENTORNO DE PRUEBAS
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

    let respuestaAEAT = "";

    const request = https.request(options, (response) => {
      response.setEncoding("utf8");

      response.on("data", (chunk) => {
        respuestaAEAT += chunk;
      });

      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: respuestaAEAT,
        });
      });
    });

    request.on("error", (err) => {
      reject(err);
    });

    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Timeout AEAT"));
    });

    request.write(bodyBuffer);
    request.end();
  });
}

// =====================================================
//  ENDPOINT /factura (API KEY + validación + envío AEAT)
// =====================================================

const API_KEY = process.env.FACTURA_API_KEY || null;

app.post("/factura", async (req, res) => {
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

  const factura = req.body;

  // 3. Validación mínima según tu schema oficial
  const errores = [];

  if (!factura.numero_factura)
    errores.push("numero_factura es obligatorio");

  if (!factura.fecha_emision)
    errores.push("fecha_emision es obligatoria");

  if (!factura.cliente_nombre)
    errores.push("cliente_nombre es obligatorio");

  if (typeof factura.total !== "number")
    errores.push("total debe ser numérico");

  if (errores.length > 0) {
    return res.status(400).json({
      ok: false,
      error: "Factura inválida",
      detalles: errores,
    });
  }

  console.log("📥 Factura recibida (resumen):");
  console.log(
    JSON.stringify(
      {
        numero_factura: factura.numero_factura,
        tipo_factura: factura.tipo_factura,
        fecha_emision: factura.fecha_emision,
        cliente_nombre: factura.cliente_nombre,
        cliente_nif: factura.cliente_nif,
        total: factura.total,
      },
      null,
      2
    )
  );

  // 4. Construir XML y enviarlo a la AEAT
  try {
    const xml = construirXmlAlta(factura);
    const resultadoAEAT = await enviarXmlAEAT(xml);

    const resumen =
      resultadoAEAT.body && resultadoAEAT.body.length > 2000
        ? resultadoAEAT.body.slice(0, 2000) + "\n...[truncado]..."
        : resultadoAEAT.body || "";

    // 5. Respuesta al ERP (Base44)
    return res.status(200).json({
      ok: true,
      mensaje: "Factura enviada a AEAT (entorno pruebas)",
      factura_enviada: factura,
      aeat: {
        httpStatus: resultadoAEAT.statusCode,
        rawResponse: resumen,
      },
    });
  } catch (err) {
    console.error("❌ Error al enviar factura a AEAT:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Error al enviar la factura a la AEAT",
      detalle: err.message,
    });
  }
});

// =====================================================
//               TEST AEAT MANUAL (debug)
// =====================================================

app.get("/test-aeat", async (req, res) => {
  try {
    const facturaFake = {
      numero_factura: "VF-TEST-0001",
      tipo_factura: "F1",
      fecha_emision: "2025-01-01",
      empresa_razon_social: "EMPRESA PRUEBA VERIFACTU",
      empresa_cif: "B45440955", // ⚠️ cambiar por el NIF del certificado adecuado
      cliente_nombre: "CLIENTE PRUEBA",
      cliente_nif: "99999999R",
      base_neta: 100,
      iva_total: 21,
      total: 121,
      observaciones: "Prueba manual /test-aeat",
    };

    const xml = construirXmlAlta(facturaFake);
    const resultado = await enviarXmlAEAT(xml);

    const resumen =
      resultado.body && resultado.body.length > 2000
        ? resultado.body.slice(0, 2000) + "\n...[truncado]..."
        : resultado.body || "";

    res
      .status(200)
      .send(
        "Código AEAT: " +
          resultado.statusCode +
          "\n\nXML enviado:\n" +
          xml +
          "\n\nRespuesta:\n" +
          resumen
      );
  } catch (err) {
    res.status(500).send("Error en /test-aeat: " + err.message);
  }
});

// =====================================================
//                 INICIAR SERVIDOR
// =====================================================

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
