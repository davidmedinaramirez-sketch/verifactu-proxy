const express = require("express");
const https = require("https");
const app = express();

// Para aceptar texto (XML) en el body
app.use(express.text({ type: "*/*" }));

// Token que ya tienes en Render
const API_TOKEN = process.env.API_TOKEN || "DEV_TOKEN";

// Ruta simple para ver que vive
app.get("/", (req, res) => {
  res.send("Hola, Render está funcionando ✅");
});

// Ruta que usará Base44
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

  const aeatReq = https.request(options, (aeatRes) => {
    let data = "";

    aeatRes.on("data", (chunk) => {
      data += chunk;
    });

    aeatRes.on("end", () => {
      // devolvemos a quien llama exactamente lo que conteste AEAT
      res.status(aeatRes.statusCode || 500).send(data || "");
    });
  });

  aeatReq.on("error", (e) => {
    console.error("Error comunicando con AEAT:", e);
    res.status(502).send("Error comunicando con AEAT");
  });

  // 4) Enviar el XML a AEAT
  aeatReq.write(xml);
  aeatReq.end();
});

  } catch (e) {
    console.error("Error leyendo CLIENT_P12:", e);
    return res.status(500).send("Error leyendo CLIENT_P12 en el servidor.");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Verifactu proxy escuchando en puerto " + port);
});
