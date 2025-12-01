const fs = require("fs");
const https = require("https");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.FACTURA_API_KEY || null;

// ==========================
//  MIDDLEWARE BÁSICO
// ==========================
app.use(express.json());

// ==========================
//   CERTIFICADO FNMT / MTLS
// ==========================

let certBuffer = null;
let certPassphrase = process.env.FNMT_CERT_PASS || null;

try {
  const certBase64 = fs
    .readFileSync("/etc/secrets/fnmt-cert.b64", "utf8")
    .toString()
    .trim();

  certBuffer = Buffer.from(certBase64, "base64");

  console.log("✅ Certificado FNMT cargado. Tamaño:", certBuffer.length, "bytes");
} catch (err) {
  console.warn("⚠️ No se pudo cargar el certificado FNMT:", err.message);
}

function crearAgenteMTLS() {
  if (!certBuffer || !certPassphrase) {
    throw new Error("Certificado o contraseña no disponibles");
  }

  return new https.Agent({
    pfx: certBuffer,
    passphrase: certPassphrase,
    rejectUnauthorized: true
  });
}

// ==========================
//   UTILIDADES DE FORMATO
// ==========================

function toNumberOrZero(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function formatearFechaDDMMYYYY(fecha) {
  // Si ya viene en dd-mm-yyyy, se deja como está
  if (!fecha) return "";
  if (/^\d{2}-\d{2}-\d{4}$/.test(fecha)) return fecha;

  // Si viene en ISO (yyyy-mm-dd)
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [yyyy, mm, dd] = fecha.split("-");
    return `${dd}-${mm}-${yyyy}`;
  }

  // Si no sabemos, devolvemos tal cual
  return fecha;
}

// ==========================
//   VALIDACIÓN BÁSICA
//   (según tu contrato JSON)
// ==========================

function validarRegistroAlta(reg) {
  const errores = [];

  if (!reg.IDVersion) errores.push("IDVersion es obligatorio");

  if (!reg.IDFactura) {
    errores.push("IDFactura es obligatorio");
  } else {
    if (!reg.IDFactura.IDEmisorFactura)
      errores.push("IDFactura.IDEmisorFactura es obligatorio");
    if (!reg.IDFactura.NumSerieFactura)
      errores.push("IDFactura.NumSerieFactura es obligatorio");
    if (!reg.IDFactura.FechaExpedicionFactura)
      errores.push("IDFactura.FechaExpedicionFactura es obligatorio");
  }

  if (!reg.NombreRazonEmisor)
    errores.push("NombreRazonEmisor es obligatorio");

  // Destinatarios: al menos 1
  if (!Array.isArray(reg.Destinatarios) || reg.Destinatarios.length === 0) {
    errores.push("Debe existir al menos un elemento en Destinatarios");
  } else {
    const d0 = reg.Destinatarios[0];
    if (!d0.NombreRazon)
      errores.push("Destinatarios[0].NombreRazon es obligatorio");
    if (!d0.NIF && !d0.IDOtro) {
      errores.push(
        "Destinatarios[0] debe tener NIF o IDOtro (CodigoPais/IDType/ID)"
      );
    }
  }

  // ImporteTotal y CuotaTotal numéricos
  if (reg.ImporteTotal === undefined || reg.ImporteTotal === null) {
    errores.push("ImporteTotal es obligatorio");
  } else if (isNaN(toNumberOrZero(reg.ImporteTotal))) {
    errores.push("ImporteTotal debe ser numérico");
  }

  if (reg.CuotaTotal === undefined || reg.CuotaTotal === null) {
    errores.push("CuotaTotal es obligatorio");
  } else if (isNaN(toNumberOrZero(reg.CuotaTotal))) {
    errores.push("CuotaTotal debe ser numérico");
  }

  // Huella
  if (!reg.TipoHuella) errores.push("TipoHuella es obligatorio");
  if (!reg.Huella) errores.push("Huella es obligatoria");

  // SistemaInformatico mínimo
  if (!reg.SistemaInformatico) {
    errores.push("SistemaInformatico es obligatorio");
  } else {
    if (!reg.SistemaInformatico.NombreSistemaInformatico)
      errores.push("SistemaInformatico.NombreSistemaInformatico es obligatorio");
    if (!reg.SistemaInformatico.IdSistemaInformatico)
      errores.push("SistemaInformatico.IdSistemaInformatico es obligatorio");
    if (!reg.SistemaInformatico.Version)
      errores.push("SistemaInformatico.Version es obligatorio");
    if (!reg.SistemaInformatico.NumeroInstalacion)
      errores.push("SistemaInformatico.NumeroInstalacion es obligatorio");
  }

  return errores;
}

// ==========================
//   CONSTRUCCIÓN XML SOAP
// ==========================

function construirXmlAltaDesdeCanonico(reg) {
  const obligadoNif = safeStr(reg.IDFactura.IDEmisorFactura);
  const numeroFactura = safeStr(reg.IDFactura.NumSerieFactura);
  const fechaExpedicion = formatearFechaDDMMYYYY(
    reg.IDFactura.FechaExpedicionFactura
  );

  const refExterna = safeStr(reg.RefExterna);
  const nombreRazonEmisor = safeStr(reg.NombreRazonEmisor);

  const subsanacion = reg.Subsanacion || "N";
  const rechazoPrevio = reg.RechazoPrevio || "N";
  const tipoFactura = reg.TipoFactura || "F1";
  const tipoRectificativa = reg.TipoRectificativa || null;

  const fechaOperacionXML = reg.FechaOperacion
    ? `<sum1:FechaOperacion>${formatearFechaDDMMYYYY(
        reg.FechaOperacion
      )}</sum1:FechaOperacion>`
    : "";

  const descripcionOperacion =
    reg.DescripcionOperacion || "Operacion facturada desde Base44";

  const facturaSimplificada =
    reg.FacturaSimplificadaArt7273 || "N";
  const facturaSinIdentDest =
    reg.FacturaSinIdentifDestinatarioArt61d || "N";
  const macrodato = reg.Macrodato || "N";

  const cupon = reg.Cupon || "N";

  const tipoHuella = reg.TipoHuella || "01";
  const huella = safeStr(reg.Huella);
  const fechaHoraHusoGen =
    reg.FechaHoraHusoGenRegistro || new Date().toISOString();

  // ----- Destinatarios -----
  let destinatariosXML = "";
  if (Array.isArray(reg.Destinatarios)) {
    reg.Destinatarios.forEach((dest) => {
      const nombre = safeStr(dest.NombreRazon);
      const nif = dest.NIF ? safeStr(dest.NIF) : null;
      let idOtroXML = "";

      if (dest.IDOtro) {
        const codPais = safeStr(dest.IDOtro.CodigoPais);
        const idType = safeStr(dest.IDOtro.IDType);
        const idVal = safeStr(dest.IDOtro.ID);

        idOtroXML = `
              <sum1:IDOtro>
                ${codPais ? `<sum1:CodigoPais>${codPais}</sum1:CodigoPais>` : ""}
                ${idType ? `<sum1:IDType>${idType}</sum1:IDType>` : ""}
                ${idVal ? `<sum1:ID>${idVal}</sum1:ID>` : ""}
              </sum1:IDOtro>`;
      }

      destinatariosXML += `
          <sum1:Destinatarios>
            <sum1:IDDestinatario>
              <sum1:NombreRazon>${nombre}</sum1:NombreRazon>
              ${nif ? `<sum1:NIF>${nif}</sum1:NIF>` : ""}
              ${idOtroXML}
            </sum1:IDDestinatario>
          </sum1:Destinatarios>`;
    });
  }

  // ----- Tercero -----
  let emitidaPorTerceroXML = "";
  const ept = reg.EmitidaPorTerceroODestinatario;
  if (ept === "T" || ept === "D") {
    const t = reg.Tercero || {};
    const tNombre = safeStr(t.NombreRazon);
    const tNif = safeStr(t.NIF);
    let tIDOtro = "";

    if (t.IDOtro) {
      const codPais = safeStr(t.IDOtro.CodigoPais);
      const idType = safeStr(t.IDOtro.IDType);
      const idVal = safeStr(t.IDOtro.ID);

      tIDOtro = `
              <sum1:IDOtro>
                ${codPais ? `<sum1:CodigoPais>${codPais}</sum1:CodigoPais>` : ""}
                ${idType ? `<sum1:IDType>${idType}</sum1:IDType>` : ""}
                ${idVal ? `<sum1:ID>${idVal}</sum1:ID>` : ""}
              </sum1:IDOtro>`;
    }

    emitidaPorTerceroXML = `
          <sum1:EmitidaPorTerceroODestinatario>${ept}</sum1:EmitidaPorTerceroODestinatario>
          <sum1:Tercero>
            ${tNombre ? `<sum1:NombreRazon>${tNombre}</sum1:NombreRazon>` : ""}
            ${tNif ? `<sum1:NIF>${tNif}</sum1:NIF>` : ""}
            ${tIDOtro}
          </sum1:Tercero>`;
  }

  // ----- DetalleDesglose -----
  let desgloseXML = "";
  const detalles = Array.isArray(reg.DetalleDesglose)
    ? reg.DetalleDesglose
    : [];
  detalles.forEach((d) => {
    const impuesto = safeStr(d.Impuesto || "01");
    const claveRegimen = safeStr(d.ClaveRegimen || "01");
    const califOperacion = safeStr(d.CalificacionOperacion || "S1");
    const operacionExenta = safeStr(d.OperacionExenta || "");

    const tipoImpositivo = toNumberOrZero(d.TipoImpositivo);
    const base = toNumberOrZero(d.BaseImponibleOimporteNoSujeto);
    const cuota = toNumberOrZero(d.CuotaRepercutida);
    const tipoReqEq = toNumberOrZero(d.TipoRecargoEquivalencia);
    const cuotaReqEq = toNumberOrZero(d.CuotaRecargoEquivalencia);

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
            <sum1:BaseImponibleOimporteNoSujeto>${base.toFixed(
              2
            )}</sum1:BaseImponibleOimporteNoSujeto>
            <sum1:CuotaRepercutida>${cuota.toFixed(
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

  // ----- FacturasRectificadas & ImporteRectificacion -----
  let rectificadasXML = "";
  if (
    Array.isArray(reg.FacturasRectificadas) &&
    reg.FacturasRectificadas.length > 0
  ) {
    const frList = reg.FacturasRectificadas
      .map((f) => {
        const fNif = safeStr(f.IDEmisorFactura || obligadoNif);
        const fNum = safeStr(f.NumSerieFactura || "");
        const fFecha = formatearFechaDDMMYYYY(
          f.FechaExpedicionFactura || ""
        );
        return `
            <sum1:IDFacturaRectificada>
              <sum1:IDEmisorFactura>${fNif}</sum1:IDEmisorFactura>
              <sum1:NumSerieFactura>${fNum}</sum1:NumSerieFactura>
              <sum1:FechaExpedicionFactura>${fFecha}</sum1:FechaExpedicionFactura>
            </sum1:IDFacturaRectificada>`;
      })
      .join("");

    const impRect = reg.ImporteRectificacion || {};
    const baseRect = toNumberOrZero(impRect.BaseRectificada);
    const cuotaRect = toNumberOrZero(impRect.CuotaRectificada);
    const cuotaRecRect = toNumberOrZero(impRect.CuotaRecargoRectificado);

    rectificadasXML = `
          <sum1:FacturasRectificadas>
            ${frList}
          </sum1:FacturasRectificadas>
          <sum1:ImporteRectificacion>
            <sum1:BaseRectificada>${baseRect.toFixed(2)}</sum1:BaseRectificada>
            <sum1:CuotaRectificada>${cuotaRect.toFixed(
              2
            )}</sum1:CuotaRectificada>
            <sum1:CuotaRecargoRectificado>${cuotaRecRect.toFixed(
              2
            )}</sum1:CuotaRecargoRectificado>
          </sum1:ImporteRectificacion>`;
  }

  // ----- Encadenamiento -----
  let encadenamientoXML = "";
  const enc = reg.Encadenamiento || {};
  if (enc.PrimerRegistro === "S") {
    encadenamientoXML = `
          <sum1:Encadenamiento>
            <sum1:PrimerRegistro>S</sum1:PrimerRegistro>
          </sum1:Encadenamiento>`;
  } else if (enc.RegistroAnterior) {
    const ra = enc.RegistroAnterior;
    const raNif = safeStr(ra.IDEmisorFactura || obligadoNif);
    const raNum = safeStr(ra.NumSerieFactura || "");
    const raFecha = formatearFechaDDMMYYYY(
      ra.FechaExpedicionFactura || ""
    );
    const raHash = safeStr(ra.Huella || "");

    encadenamientoXML = `
          <sum1:Encadenamiento>
            <sum1:PrimerRegistro>N</sum1:PrimerRegistro>
            <sum1:RegistroAnterior>
              <sum1:IDEmisorFactura>${raNif}</sum1:IDEmisorFactura>
              <sum1:NumSerieFactura>${raNum}</sum1:NumSerieFactura>
              <sum1:FechaExpedicionFactura>${raFecha}</sum1:FechaExpedicionFactura>
              <sum1:Huella>${raHash}</sum1:Huella>
            </sum1:RegistroAnterior>
          </sum1:Encadenamiento>`;
  }

  // ----- SistemaInformatico -----
  const sis = reg.SistemaInformatico || {};
  const sisNombreRazon = safeStr(sis.NombreRazon);
  const sisNif = safeStr(sis.NIF);
  let sisIdOtroXML = "";
  if (sis.IDOtro) {
    const codPais = safeStr(sis.IDOtro.CodigoPais);
    const idType = safeStr(sis.IDOtro.IDType);
    const idVal = safeStr(sis.IDOtro.ID);
    sisIdOtroXML = `
              <sum1:IDOtro>
                ${codPais ? `<sum1:CodigoPais>${codPais}</sum1:CodigoPais>` : ""}
                ${idType ? `<sum1:IDType>${idType}</sum1:IDType>` : ""}
                ${idVal ? `<sum1:ID>${idVal}</sum1:ID>` : ""}
              </sum1:IDOtro>`;
  }

  const nombreSis = safeStr(sis.NombreSistemaInformatico);
  const idSis = safeStr(sis.IdSistemaInformatico);
  const verSis = safeStr(sis.Version);
  const numInst = safeStr(sis.NumeroInstalacion);
  const tipoUsoSoloVF = safeStr(sis.TipoUsoPosibleSoloVerifactu || "N");
  const tipoUsoMultiOT = safeStr(sis.TipoUsoPosibleMultiOT || "N");
  const indicadorMultiplesOT = safeStr(sis.IndicadorMultiplesOT || "N");

  const sistemaInformaticoXML = `
          <sum1:SistemaInformatico>
            ${
              sisNombreRazon
                ? `<sum1:NombreRazon>${sisNombreRazon}</sum1:NombreRazon>`
                : ""
            }
            ${
              sisNif
                ? `<sum1:NIF>${sisNif}</sum1:NIF>`
                : ""
            }
            ${sisIdOtroXML}
            <sum1:NombreSistemaInformatico>${nombreSis}</sum1:NombreSistemaInformatico>
            <sum1:IdSistemaInformatico>${idSis}</sum1:IdSistemaInformatico>
            <sum1:Version>${verSis}</sum1:Version>
            <sum1:NumeroInstalacion>${numInst}</sum1:NumeroInstalacion>
            <sum1:TipoUsoPosibleSoloVerifactu>${tipoUsoSoloVF}</sum1:TipoUsoPosibleSoloVerifactu>
            <sum1:TipoUsoPosibleMultiOT>${tipoUsoMultiOT}</sum1:TipoUsoPosibleMultiOT>
            <sum1:IndicadorMultiplesOT>${indicadorMultiplesOT}</sum1:IndicadorMultiplesOT>
          </sum1:SistemaInformatico>`;

  // ----- Acuerdo facturación -----
  let acuerdoXML = "";
  const numRegAcuerdo = reg.NumRegistroAcuerdoFacturacion || reg.NumRegistroAcuerdo || null;
  const idAcuerdoSI = reg.IdAcuerdoSistemaInformatico || null;
  if (numRegAcuerdo || idAcuerdoSI) {
    acuerdoXML = `
          <sum1:DatosAcuerdoFacturacion>
            ${
              numRegAcuerdo
                ? `<sum1:NumRegistroAcuerdoFacturacion>${safeStr(
                    numRegAcuerdo
                  )}</sum1:NumRegistroAcuerdoFacturacion>`
                : ""
            }
            ${
              idAcuerdoSI
                ? `<sum1:IdAcuerdoSistemaInformatico>${safeStr(
                    idAcuerdoSI
                  )}</sum1:IdAcuerdoSistemaInformatico>`
                : ""
            }
          </sum1:DatosAcuerdoFacturacion>`;
  }

  const cuotaTotal = toNumberOrZero(reg.CuotaTotal);
  const importeTotal = toNumberOrZero(reg.ImporteTotal);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"
  xmlns:sum1="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <sum:RegFactuSistemaFacturacion>
      <sum:Cabecera>
        <sum1:ObligadoEmision>
          <sum1:NombreRazon>${nombreRazonEmisor}</sum1:NombreRazon>
          <sum1:NIF>${obligadoNif}</sum1:NIF>
        </sum1:ObligadoEmision>
      </sum:Cabecera>
      <sum:RegistroFactura>
        <sum1:RegistroAlta>
          <sum1:IDVersion>${safeStr(reg.IDVersion)}</sum1:IDVersion>
          <sum1:IDFactura>
            <sum1:IDEmisorFactura>${obligadoNif}</sum1:IDEmisorFactura>
            <sum1:NumSerieFactura>${numeroFactura}</sum1:NumSerieFactura>
            <sum1:FechaExpedicionFactura>${fechaExpedicion}</sum1:FechaExpedicionFactura>
          </sum1:IDFactura>
          <sum1:RefExterna>${refExterna}</sum1:RefExterna>
          <sum1:NombreRazonEmisor>${nombreRazonEmisor}</sum1:NombreRazonEmisor>
          <sum1:Subsanacion>${subsanacion}</sum1:Subsanacion>
          <sum1:RechazoPrevio>${rechazoPrevio}</sum1:RechazoPrevio>
          <sum1:TipoFactura>${tipoFactura}</sum1:TipoFactura>
          ${
            tipoRectificativa
              ? `<sum1:TipoRectificativa>${tipoRectificativa}</sum1:TipoRectificativa>`
              : ""
          }
          ${rectificadasXML}
          ${fechaOperacionXML}
          <sum1:DescripcionOperacion>${descripcionOperacion}</sum1:DescripcionOperacion>
          <sum1:FacturaSimplificadaArt7273>${facturaSimplificada}</sum1:FacturaSimplificadaArt7273>
          <sum1:FacturaSinIdentifDestinatarioArt61d>${facturaSinIdentDest}</sum1:FacturaSinIdentifDestinatarioArt61d>
          <sum1:Macrodato>${macrodato}</sum1:Macrodato>
          ${emitidaPorTerceroXML}
          ${destinatariosXML}
          <sum1:Cupon>${cupon}</sum1:Cupon>
          <sum1:Desglose>
            ${desgloseXML}
          </sum1:Desglose>
          <sum1:CuotaTotal>${cuotaTotal.toFixed(2)}</sum1:CuotaTotal>
          <sum1:ImporteTotal>${importeTotal.toFixed(2)}</sum1:ImporteTotal>
          ${encadenamientoXML}
          ${sistemaInformaticoXML}
          ${acuerdoXML}
          <sum1:FechaHoraHusoGenRegistro>${fechaHoraHusoGen}</sum1:FechaHoraHusoGenRegistro>
          <sum1:TipoHuella>${tipoHuella}</sum1:TipoHuella>
          <sum1:Huella>${huella}</sum1:Huella>
        </sum1:RegistroAlta>
      </sum:RegistroFactura>
    </sum:RegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

  return xml;
}

// ==========================
//   LLAMADA AEAT (PRE)
// ==========================

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
          "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SistemaFacturacion/altaRegistroFactura"
      },
      timeout: 15000
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
          body: respuestaAEAT
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

// ==========================
//   ENDPOINTS BÁSICOS
// ==========================

app.get("/", (req, res) => {
  const estado = certBuffer ? "CARGADO" : "NO CARGADO";
  res.send("Microservicio Verifactu (RegistroAlta). Certificado: " + estado);
});

app.get("/test-mtls", (req, res) => {
  try {
    const agent = crearAgenteMTLS();
    const ok = typeof agent.createConnection === "function";
    res.send("Agente MTLS creado. createConnection=" + ok);
  } catch (err) {
    res.status(500).send("Error MTLS: " + err.message);
  }
});

// ==========================
//   ENDPOINT /factura
//   (RECIBE RegistroAlta JSON CANÓNICO)
// ==========================

app.post("/factura", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "FACTURA_API_KEY no configurada en el servidor"
    });
  }

  const headerKey = req.headers["x-api-key"];
  if (headerKey !== API_KEY) {
    return res.status(401).json({
      ok: false,
      error: "No autorizado. API KEY incorrecta."
    });
  }

  const registroAlta = req.body;

  console.log("### RegistroAlta RECIBIDO DE BASE44 ###");
  console.log(JSON.stringify(registroAlta, null, 2));

  const errores = validarRegistroAlta(registroAlta);

  if (errores.length > 0) {
    console.log("❌ RegistroAlta inválido:", errores);
    return res.status(400).json({
      ok: false,
      error: "RegistroAlta inválido",
      detalles: errores
    });
  }

  try {
    const xml = construirXmlAltaDesdeCanonico(registroAlta);
    const resultadoAEAT = await enviarXmlAEAT(xml);

    const resumen =
      resultadoAEAT.body && resultadoAEAT.body.length > 4000
        ? resultadoAEAT.body.slice(0, 4000) + "\n...[truncado]..."
        : resultadoAEAT.body || "";

    return res.status(200).json({
      ok: true,
      mensaje: "RegistroAlta enviado a AEAT (entorno pruebas)",
      registroAlta,
      xml_enviado: xml,
      aeat: {
        httpStatus: resultadoAEAT.statusCode,
        rawResponse: resumen
      }
    });
  } catch (err) {
    console.error("❌ Error al enviar a AEAT:", err.message);

    return res.status(500).json({
      ok: false,
      error: "Error al enviar a la AEAT",
      detalle: err.message
    });
  }
});

// ==========================
//   INICIAR SERVIDOR
// ==========================

app.listen(PORT, () => {
  console.log(`Servidor Verifactu (RegistroAlta) escuchando en puerto ${PORT}`);
});
