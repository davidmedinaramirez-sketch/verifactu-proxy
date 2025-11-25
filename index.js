const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();

// Para aceptar texto (XML) en el body
app.use(express.text({ type: "*/*" }));

// Token configurado en Render
const API_TOKEN = process.env.API_TOKEN || "DEV_TOKEN";

// --------------------------------------------------------------
// RUTA SIMPLE PARA PROBAR QUE EL SERVIDOR ESTÁ VIVO
// --------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// --------------------------------------------------------------
// RUTA PRINCIPAL PARA BASE44 (solo eco por ahora)
// --------------------------------------------------------------
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

// --------------------------------------------------------------
// RUTA DE PRUEBA: CONEXIÓN mTLS REAL CON LA AEAT
// --------------------------------------------------------------
app.post("/debug/aeat", (req, res) => {
  try {
    const p12Path = "/etc/secrets/MEDINA_RAMIREZ_DAVID___03949255V.p12";
    const p12Buffer = fs.readFileSync(p12Path);

    const options = {
      hostname: "prewww10.aeat.es",
      port: 443,
      path: "/",   // solo probamos la conexión
      method: "GET",
      pfx: p12Buffer,
      passphrase: process.env.CLIENT_P12_PASS,
      rejectUnauthorized: false,
    };

    const r = https.request(options, (resp) => {
      let data = "";
      resp.on("data", (chunk) => (data += chunk));
      resp.on("end", () => {
        const status = resp.statusCode || 0;
        const preview = data.slice(0, 500);
        return res.send(`Status: ${status}\n\n${preview}`);
      });
    });

    r.on("error", (err) => {
      console.error("Error mTLS:", err);
      return res.status(500).send("Error mTLS: " + err.message);
    });

    r.end();
  } catch (e) {
    console.error("Error interno:", e);
    return res.status(500).send("Error interno en /debug/aeat: " + e.message);
  }
});

    const r = https.request(options, (resp) => {
      let data = "";

      resp.on("data", (chunk) => (data += chunk));

      resp.on("end", () => {
        const status = resp.statusCode || 0;
        const preview = data.slice(0, 1500); // primeras líneas
        return res.send(`Status: ${status}\n\n${preview}`);
      });
    });

    r.on("error", (err) => {
      console.error("Error mTLS:", err);
      return res.status(500).send("Error mTLS: " + err.message);
    });

    r.write(xml);
    r.end();
  } catch (e) {
    console.error("Error interno:", e);
    return res.status(500).send("Error interno en /debug/aeat: " + e.message);
  }
});

// --------------------------------------------------------------

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
