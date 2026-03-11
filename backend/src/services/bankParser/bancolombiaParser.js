// Patrones extraídos de correos reales de Bancolombia

export const parseBancolombia = (body) => {
  const cleanBody = body
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/Bancolombia:/g, " Bancolombia:")
    .trim();

  const transaction = {
    amount: null,
    type: null,
    description: null,
    merchant: null,
    date: null,
    bank: "Bancolombia",
  };

  // ─── 1. INGRESO - Nómina, proveedor o pago recibido ───────────────────────
  // "Recibiste un pago de Nomina de RETABLOS MED SA por $776,000.00"
  // "Recibiste un pago PROVEEDOR de PEXTO COLOMBIA por $114,160.70"
  const ingresoMatch = cleanBody.match(
    /Recibiste un pago .+? de (.+?) por \$([\d,.]+)/i
  );
  if (ingresoMatch) {
    transaction.type = "income";
    transaction.description = `Pago recibido: ${ingresoMatch[1].trim()}`;
    transaction.merchant = ingresoMatch[1].trim();
    transaction.amount = parseAmount(ingresoMatch[2]);
    transaction.date = extractDate(cleanBody);
    return transaction;
  }

  // ─── 2. TRANSFERENCIA RECIBIDA ─────────────────────────────────────────────
  // "Recibiste una transferencia por $280,000.00 de AL DIA INGENIERIA SAS en tu cuenta *6429"
  const transferenciaRecibidaMatch = cleanBody.match(
    /Recibiste una transferencia por \$([\d,.]+) de (.+?) en tu cuenta/i
  );
  if (transferenciaRecibidaMatch) {
    transaction.type = "income";
    transaction.description = `Transferencia recibida de: ${transferenciaRecibidaMatch[2].trim()}`;
    transaction.merchant = transferenciaRecibidaMatch[2].trim();
    transaction.amount = parseAmount(transferenciaRecibidaMatch[1]);
    transaction.date = extractDate(cleanBody);
    return transaction;
  }

  // ─── 3. COMPRA - Tarjeta débito o crédito ─────────────────────────────────
  // "Compraste $11.900,00 en DLO*GOOGLE Google On con tu T.Deb *2998"
  const compraMatch = cleanBody.match(
    /Compraste \$([\d,.]+) en (.+?) con tu/i
  );
  if (compraMatch) {
    transaction.type = "expense";
    transaction.description = `Compra en: ${compraMatch[2].trim()}`;
    transaction.merchant = compraMatch[2].trim();
    transaction.amount = parseAmount(compraMatch[1]);
    transaction.date = extractDate(cleanBody);
    return transaction;
  }

  // ─── 4. TRANSFERENCIA ENVIADA ──────────────────────────────────────────────
  // "Transferiste $2,300.00 desde tu cuenta 4155 a la cuenta *3122994475"
  const transferenciaMatch = cleanBody.match(
    /Transferiste \$([\d,.]+) desde tu cuenta (\d+) a la cuenta \*?([\w\d]+)/i
  );
  if (transferenciaMatch) {
    transaction.type = "expense";
    transaction.description = `Transferencia a cuenta *${transferenciaMatch[3].slice(-4)}`;
    transaction.merchant = `Cuenta *${transferenciaMatch[3].slice(-4)}`;
    transaction.amount = parseAmount(transferenciaMatch[1]);
    transaction.date = extractDate(cleanBody);
    return transaction;
  }

  // ─── 5. RETIRO EN CAJERO ───────────────────────────────────────────────────
  // "Retiraste $40.000,00 en SAN_JAVIER1 de tu T.Deb **2998"
  const retiroMatch = cleanBody.match(
    /Retiraste \$([\d,.]+) en (.+?) de tu/i
  );
  if (retiroMatch) {
    transaction.type = "expense";
    transaction.description = `Retiro en: ${retiroMatch[2].trim()}`;
    transaction.merchant = retiroMatch[2].trim();
    transaction.amount = parseAmount(retiroMatch[1]);
    transaction.date = extractDate(cleanBody);
    return transaction;
  }

  // ─── 6. PAGO DE SERVICIO ───────────────────────────────────────────────────
  // "Pagaste $X a NOMBRE el DD/MM/YYYY"
  const pagoMatch = cleanBody.match(
    /Pagaste \$([\d,.]+) a (.+?) el/i
  );
  if (pagoMatch) {
    transaction.type = "expense";
    transaction.description = `Pago a: ${pagoMatch[2].trim()}`;
    transaction.merchant = pagoMatch[2].trim();
    transaction.amount = parseAmount(pagoMatch[1]);
    transaction.date = extractDate(cleanBody);
    return transaction;
  }

  return null; // tipo de correo no reconocido
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Normaliza montos colombianos y americanos
// "11.900,00" → 11900.00  |  "167,200.00" → 167200.00
const parseAmount = (raw) => {
  if (!raw) return null;
  if (raw.includes(",") && raw.indexOf(",") > raw.indexOf(".")) {
    return parseFloat(raw.replace(/\./g, "").replace(",", "."));
  }
  return parseFloat(raw.replace(/,/g, ""));
};

// Extrae fecha: "el 06/09/2025 a las 00:49" → Date
const extractDate = (cleanBody) => {
  const dateMatch = cleanBody.match(
    /el (\d{2}\/\d{2}\/\d{4}) a las (\d{2}:\d{2})/i
  );
  if (dateMatch) {
    const [day, month, year] = dateMatch[1].split("/");
    return new Date(`${year}-${month}-${day}T${dateMatch[2]}:00`);
  }
  return new Date();
};
// ```

// Cubre estos 6 tipos de transacción:
// ```
// income  → Pago recibido (nómina, proveedor, cualquier tipo)
// income  → Transferencia recibida
// expense → Compra con tarjeta
// expense → Transferencia enviada
// expense → Retiro en cajero
// expense → Pago de servicio