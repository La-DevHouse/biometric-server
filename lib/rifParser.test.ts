import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseRifText } from "@/lib/rifParser";

// Texto sintético con la misma estructura/etiquetas que un comprobante real
// del SENIAT (verificado contra uno real en docs/09-reunion-3.md §3.10) — sin
// datos personales reales.
const NATURAL_PERSON_RIF = `
N° COMPROBANTE: 202403H0000000000000
REGISTRO ÚNICO DE INFORMACIÓN FISCAL (RIF)
V123456789 PEDRO JOSE PEREZ GOMEZ
DOMICILIO FISCAL AV PRINCIPAL EDIF DEMO PISO 1 URB EL PARAISO
CARACAS ZONA POSTAL 1050
(Este contribuyente no posee firmas personales)
FECHA DE INSCRIPCIÓN: 01/01/2010
FECHA DE ÚLTIMA ACTUALIZACIÓN: 15/06/2025
FECHA DE VENCIMIENTO: 15/06/2028
GERENCIA REGIONAL DE TRIBUTOS INTERNOS
REGIÓN CAPITAL / SECTOR CARACAS
1123456789-MPT
FIRMA AUTORIZADA
`;

const COMPANY_RIF = `
N° COMPROBANTE: 202403H0000000000001
REGISTRO ÚNICO DE INFORMACIÓN FISCAL (RIF)
J987654321 FARMACIA DEMO C.A.
DOMICILIO FISCAL CALLE 5 CON AV 3 LOCAL 2 ZONA INDUSTRIAL
BARQUISIMETO ZONA POSTAL 3001
FECHA DE INSCRIPCIÓN: 05/03/2015
FECHA DE ÚLTIMA ACTUALIZACIÓN: 10/02/2026
FECHA DE VENCIMIENTO: 10/02/2029
GERENCIA REGIONAL DE TRIBUTOS INTERNOS
REGIÓN CENTRO OCCIDENTAL / SECTOR CABUDARE
FIRMA AUTORIZADA
`;

test("parseRifText - persona natural, con la nota de firmas personales", () => {
  const result = parseRifText(NATURAL_PERSON_RIF);
  assert.ok("fields" in result, "esperaba parsear sin error");
  if ("fields" in result) {
    assert.equal(result.fields.taxIdPrefix, "V");
    assert.equal(result.fields.taxIdNumber, "123456789");
    assert.equal(result.fields.businessName, "PEDRO JOSE PEREZ GOMEZ");
    assert.equal(
      result.fields.address,
      "AV PRINCIPAL EDIF DEMO PISO 1 URB EL PARAISO CARACAS ZONA POSTAL 1050"
    );
  }
});

test("parseRifText - empresa, sin la nota de firmas personales", () => {
  const result = parseRifText(COMPANY_RIF);
  assert.ok("fields" in result, "esperaba parsear sin error");
  if ("fields" in result) {
    assert.equal(result.fields.taxIdPrefix, "J");
    assert.equal(result.fields.taxIdNumber, "987654321");
    assert.equal(result.fields.businessName, "FARMACIA DEMO C.A.");
    assert.equal(
      result.fields.address,
      "CALLE 5 CON AV 3 LOCAL 2 ZONA INDUSTRIAL BARQUISIMETO ZONA POSTAL 3001"
    );
  }
});

test("parseRifText - texto vacío", () => {
  const result = parseRifText("   ");
  assert.ok("error" in result);
});

test("parseRifText - PDF que no es un RIF", () => {
  const result = parseRifText("Esto es un documento cualquiera sin el formato esperado.");
  assert.ok("error" in result);
});
