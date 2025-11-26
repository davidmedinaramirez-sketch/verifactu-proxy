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
//    UTILIDADES: FECHAS, XML Y LLAMADA A LA AEAT
// =====================================================

function formatearFechaDDMMYYYY(fechaISO) {
  if (!fechaISO) return "";
  const partes = fechaISO.split("-");
  if (partes.length !== 3) return fechaISO;
  const [yyyy, mm, dd] = partes;
  return `${dd}-${mm}-${yyyy}`;
}

// Construye un XML de RegistroAlta a partir del JSON de factura
function construirXmlAlta(factura) {
  // ---- Emisor / obligado ----
  const obligadoNombre = factura.empresa_razon_social || "OBLIGADO EMISOR";
  const obligadoNif = factura.empresa_cif || "00000000T";

  // ---- Destinatario ----
  const clienteNombre = factura.cliente_nombre || "CLIENTE DESCONOCIDO";
  const clienteNif = factura.cliente_nif || null;
  const clienteExtranjero = !!factura.cliente_es_extranjero;
  const clienteCodigoPais = factura.cliente_id_otro_pais || null;
  const clienteIdType = factura.cliente_id_otro_type || null;
  const clienteIdExtranjero = factura.cliente_id_otro_id || null;

  // ---- Identificación factura ----
  const numeroFactura = factura.numero_factura || "SIN-NUMERO";
  const fechaEmisionISO = factura.fecha_emision || "2025-01-01";
  const fechaEmision = formatearFechaDDMMYYYY(fechaEmisionISO);

  const tipoFactura = factura.tipo_factura || "F1"; // F1, F2, F3, R1-R5
  const tipoRectificativa = factura.tipo_rectificativa || null; // "S" o "I"

  const descripcionOperacion =
    factura.descripcion_operacion ||
    factura.observaciones ||
    factura.categoria_contabilidad ||
    "Operacion facturada";

  const refExterna = factura.ref_externa || "";

  // ---- Flags varios ----
  const subsanacion = factura.verifactu_subsanacion ? "S" : "N";
  const rechazoPrevio = factura.verifactu_rechazo_previo ? "S" : "N";

  const facturaSimplificada =
    tipoFactura === "F2" || tipoFactura === "F3" || factura.es_simplificada
      ? "S"
      : "N";
  const sinIdentDest = factura.sin_identificacion_destinatario ? "S" : "N";
  const macrodato = factura.es_macrodato ? "S" : "N";

  // EmitidaPorTerceroODestinatario: solo T o D si aplica, si no SE OMITE
  const emitidaPorTerceroRaw = factura.emitida_por_tercero || "N";
  const debeInformarEmitidaPorTercero =
    emitidaPorTerceroRaw === "T" || emitidaPorTerceroRaw === "D";
  const emitidaPorTercero = debeInformarEmitidaPorTercero
    ? emitidaPorTerceroRaw
    : null;

  const tieneCupon = factura.tiene_cupon ? "S" : "N";

  // ---- Importes / desglose ----
  const total = typeof factura.total === "number" ? factura.total : 0;
  const ivaTotal =
    typeof factura.iva_total === "number" ? factura.iva_total : 0;
  const recargoEqTotal =
    typeof factura.recargo_equivalencia_total === "number"
      ? factura.recargo_equivalencia_total
      : 0;
  const cuotaTotal = ivaTotal + recargoEqTotal;

  let desgloseXML = "";
  if (
    Array.isArray(factura.desglose_fiscal) &&
    factura.desglose_fiscal.length > 0
  ) {
    factura.desglose_fiscal.forEach((d) => {
      const impuesto = d.impuesto || "01"; // 01=IVA
      const claveRegimen = d.clave_regimen || "01";
      const califOperacion = d.calificacion_operacion || "S1";
      const operacionExenta = d.operacion_exenta || "";
      const tipoImpositivo =
        typeof d.tipo_impositivo === "number" ? d.tipo_impositivo : 0;
      const baseImponible =
        typeof d.base_imponible === "number" ? d.base_imponible : 0;
      const cuotaRep =
        typeof d.cuota_repercutida === "number" ? d.cuota_repercutida : 0;
      const tipoReqEq =
        typeof d.tipo_recargo_equivalencia === "number"
          ? d.tipo_recargo_equivalencia
          : 0;
      const cuotaReqEq =
        typeof d.cuota_recargo_equivalencia === "number"
          ? d.cuota_recargo_equivalencia
          : 0;

      desgloseXML += `
            <sum1:DetalleDesglose>
              <sum1:Impuesto>${impuesto}</sum1:Impuesto>
              <sum1:ClaveRegimen>${claveRegimen}</sum1:ClaveRegimen>
              <sum1:CalificacionOperacion>${califOperacion}</sum1:CalificacionOperacion>
              ${
                operacionExenta
                  ? `<sum1:OperacionExenta>${operacionExenta}</sum1:OperacionExenta>`
                  : ""
              }
              <sum1:TipoImpositivo>${tipoImpositivo.toFixed(
                2
              )}</sum1:TipoImpositivo>
              <sum1:BaseImponibleOimporteNoSujeto>${baseImponible.toFixed(
                2
              )}</sum1:BaseImponibleOimporteNoSujeto>
              <sum1:CuotaRepercutida>${cuotaRep.toFixed(
                2
              )}</sum1:CuotaRepercutida>
              ${
                tipoReqEq
                  ? `<sum1:TipoRecargoEquivalencia>${tipoReqEq.toFixed(
                      2
                    )}</sum1:TipoRecargoEquivalencia>`
                  : ""
              }
              ${
                cuotaReqEq
                  ? `<sum1:CuotaRecargoEquivalencia>${cuotaReqEq.toFixed(
                      2
                    )}</sum1:CuotaRecargoEquivalencia>`
                  : ""
              }
            </sum1:DetalleDesglose>`;
    });
  } else {
    const base =
      typeof factura.base_neta === "number" ? factura.base_neta : 0;
    const tipoImp = base > 0 ? (ivaTotal / base) * 100 : 0;
    desgloseXML = `
            <sum1:DetalleDesglose>
              <sum1:Impuesto>01</sum1:Impuesto>
              <sum1:ClaveRegimen>01</sum1:ClaveRegimen>
              <sum1:CalificacionOperacion>S1</sum1:CalificacionOperacion>
              <sum1:TipoImpositivo>${tipoImp.toFixed(
                2
              )}</sum1:TipoImpositivo>
              <sum1:BaseImponibleOimporteNoSujeto>${base.toFixed(
                2
              )}</sum1:BaseImponibleOimporteNoSujeto>
              <sum1:CuotaRepercutida>${ivaTotal.toFixed(
                2
              )}</sum1:CuotaRepercutida>
            </sum1:DetalleDesglose>`;
  }

  // ---- Destinatarios: NIF o IDOtro ----
  let destinatarioXML = "";
  if (
    !clienteExtranjero &&
    clienteNif &&
    !factura.sin_identificacion_destinatario
  ) {
    destinatarioXML = `
        <sum1:Destinatarios>
          <sum1:IDDestinatario>
            <sum1:NombreRazon>${clienteNombre}</sum1:NombreRazon>
            <sum1:NIF>${clienteNif}</sum1:NIF>
          </sum1:IDDestinatario>
        </sum1:Destinatarios>`;
  } else {
    destinatarioXML = `
        <sum1:Destinatarios>
          <sum1:IDDestinatario>
            <sum1:NombreRazon>${clienteNombre}</sum1:NombreRazon>
            <sum1:IDOtro>
              ${
                clienteCodigoPais
                  ? `<sum1:CodigoPais>${clienteCodigoPais}</sum1:CodigoPais>`
                  : ""
              }
              ${
                clienteIdType
                  ? `<sum1:IDType>${clienteIdType}</sum1:IDType>`
                  : ""
              }
              ${
                clienteIdExtranjero
                  ? `<sum1:ID>${clienteIdExtranjero}</sum1:ID>`
                  : ""
              }
            </sum1:IDOtro>
          </sum1:IDDestinatario>
        </sum1:Destinatarios>`;
  }

  // ---- Encadenamiento ----
  const esPrimerRegistro = !!factura.verifactu_es_primer_registro;
  const hashAnterior = factura.verifactu_hash_anterior || "";
  const numFactAnt = factura.verifactu_numero_factura_anterior || "";
  const nifFactAnt = factura.verifactu_nif_factura_anterior || obligadoNif;
  const fechaFactAntISO = factura.verifactu_fecha_factura_anterior || "";
  const fechaFactAnt = fechaFactAntISO
    ? formatearFechaDDMMYYYY(fechaFactAntISO)
    : "";

  let encadenamientoXML = "";
  if (esPrimerRegistro) {
    encadenamientoXML = `
          <sum1:Encadenamiento>
            <sum1:PrimerRegistro>S</sum1:PrimerRegistro>
          </sum1:Encadenamiento>`;
  } else if (hashAnterior && numFactAnt && fechaFactAnt) {
    encadenamientoXML = `
          <sum1:Encadenamiento>
            <sum1:PrimerRegistro>N</sum1:PrimerRegistro>
            <sum1:RegistroAnterior>
              <sum1:IDEmisorFactura>${nifFactAnt}</sum1:IDEmisorFactura>
              <sum1:NumSerieFactura>${numFactAnt}</sum1:NumSerieFactura>
              <sum1:FechaExpedicionFactura>${fechaFactAnt}</sum1:FechaExpedicionFactura>
              <sum1:Huella>${hashAnterior}</sum1:Huella>
            </sum1:RegistroAnterior>
          </sum1:Encadenamiento>`;
  }

  // ---- Huella actual / fecha generación ----
  const tipoHuella = "01"; // SHA-256
  const huella = factura.verifactu_hash || "";
  const fechaHoraGen =
    factura.verifactu_firma_fecha || new Date().toISOString();

  const fechaOperacionXML = factura.fecha_operacion
    ? `<sum1:FechaOperacion>${formatearFechaDDMMYYYY(
        factura.fecha_operacion
      )}</sum1:FechaOperacion>`
    : "";

  // ---- SistemaInformatico ----
  const sistemaNombreRazon = obligadoNombre;
  const sistemaNif = obligadoNif;
  const nombreSistema = "BASE44 ERP GANADERO";
  const idSistema = "01";
  const versionSistema = "1.0";
  const numeroInstalacion = "BASE44-ERP-001";
  const tipoUsoSoloVerifactu = "S";
  const tipoUsoMultiOT = "N";
  const indicadorMultiplesOT = "N";

  const sistemaInformaticoXML = `
          <sum1:SistemaInformatico>
            <sum1:NombreRazon>${sistemaNombreRazon}</sum1:NombreRazon>
            <sum1:NIF>${sistemaNif}</sum1:NIF>
            <sum1:NombreSistemaInformatico>${nombreSistema}</sum1:NombreSistemaInformatico>
            <sum1:IdSistemaInformatico>${idSistema}</sum1:IdSistemaInformatico>
            <sum1:Version>${versionSistema}</sum1:Version>
            <sum1:NumeroInstalacion>${numeroInstalacion}</sum1:NumeroInstalacion>
            <sum1:TipoUsoPosibleSoloVerifactu>${tipoUsoSoloVerifactu}</sum1:TipoUsoPosibleSoloVerifactu>
            <sum1:TipoUsoPosibleMultiOT>${tipoUsoMultiOT}</sum1:TipoUsoPosibleMultiOT>
            <sum1:IndicadorMultiplesOT>${indicadorMultiplesOT}</sum1:IndicadorMultiplesOT>
          </sum1:SistemaInformatico>`;

  // ---- Bloque opcional EmitidaPorTercero + Tercero ----
  let emitidaPorTerceroXML = "";
  if (emitidaPorTercero) {
    emitidaPorTerceroXML = `
          <sum1:EmitidaPorTerceroODestinatario>${emitidaPorTercero}</sum1:EmitidaPorTerceroODestinatario>
          <sum1:Tercero>
            ${
              factura.tercero_nombre
                ? `<sum1:NombreRazon>${factura.tercero_nombre}</sum1:NombreRazon>`
                : ""
            }
            ${
              factura.tercero_nif
                ? `<sum1:NIF>${factura.tercero_nif}</sum1:NIF>`
                : ""
            }
          </sum1:Tercero>`;
  }

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
            <sum1:IDEmisorFactura>${obligadoNif}</sum1:IDEmisorFactura>
            <sum1:NumSerieFactura>${numeroFactura}</sum1:NumSerieFactura>
            <sum1:FechaExpedicionFactura>${fechaEmision}</sum1:FechaExpedicionFactura>
          </sum1:IDFactura>
          <sum1:RefExterna>${refExterna}</sum1:RefExterna>
          <sum1:NombreRazonEmisor>${obligadoNombre}</sum1:NombreRazonEmisor>
          <sum1:Subsanacion>${subsanacion}</sum1:Subsanacion>
          <sum1:RechazoPrevio>${rechazoPrevio}</sum1:RechazoPrevio>
          <sum1:TipoFactura>${tipoFactura}</sum1:TipoFactura>
          ${
            tipoRectificativa
              ? `<sum1:TipoRectificativa>${tipoRectificativa}</sum1:TipoRectificativa>`
              : ""
          }
          ${fechaOperacionXML}
          <sum1:DescripcionOperacion>${descripcionOperacion}</sum1:DescripcionOperacion>
          <sum1:FacturaSimplificadaArt7273>${facturaSimplificada}</sum1:FacturaSimplificadaArt7273>
          <sum1:FacturaSinIdentifDestinatarioArt61d>${sinIdentDest}</sum1:FacturaSinIdentifDestinatarioArt61d>
          <sum1:Macrodato>${macrodato}</sum1:Macrodato>
          ${emitidaPorTerceroXML}
          ${destinatarioXML}
          <sum1:Cupon>${tieneCupon}</sum1:Cupon>
          <sum1:Desglose>
            ${desgloseXML}
          </sum1:Desglose>
          <sum1:CuotaTotal>${cuotaTotal.toFixed(2)}</sum1:CuotaTotal>
          <sum1:ImporteTotal>${total.toFixed(2)}</sum1:ImporteTotal>
          ${encadenamientoXML}
          ${sistemaInformaticoXML}
          <sum1:FechaHoraHusoGenRegistro>${fechaHoraGen}</sum1:FechaHoraHusoGenRegistro>
          <sum1:TipoHuella>${tipoHuella}</sum1:TipoHuella>
          <sum1:Huella>${huella}</sum1:Huella>
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
  if (!API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "FACTURA_API_KEY no configurada en el servidor",
    });
  }

  const headerKey = req.headers["x-api-key"];

  if (headerKey !== API_KEY) {
    return res.status(401).json({
      ok: false,
      error: "No autorizado. API KEY incorrecta.",
    });
  }

  const factura = req.body;

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

  try {
    const xml = construirXmlAlta(factura);
    const resultadoAEAT = await enviarXmlAEAT(xml);

    const resumen =
      resultadoAEAT.body && resultadoAEAT.body.length > 2000
        ? resultadoAEAT.body.slice(0, 2000) + "\n...[truncado]..."
        : resultadoAEAT.body || "";

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
      descripcion_operacion: "Prueba manual /test-aeat",
      empresa_razon_social: "EMPRESA PRUEBA VERIFACTU",
      empresa_cif: "B45440955",
      cliente_nombre: "CLIENTE PRUEBA",
      cliente_nif: "99999999R",
      cliente_es_extranjero: false,
      base_neta: 100,
      iva_total: 21,
      recargo_equivalencia_total: 0,
      total: 121,
      verifactu_hash: "FAKEHASH1234567890",
      verifactu_es_primer_registro: true,
      verifactu_firma_fecha: "2025-01-01T12:00:00+01:00",
      emitida_por_tercero: "N", // NO se debe enviar el campo (se omitirá)
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
