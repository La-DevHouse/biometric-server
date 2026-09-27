import { test } from "node:test";
import { strict as assert } from "node:assert";
import { selectUsersToRead } from "./plan";

const cache = (entries: Array<[string, string | null, number]>) =>
  new Map(entries.map(([id, privilege, fingerprints]) => [id, { privilege, fingerprints }]));
const sorted = (xs: string[]) => [...xs].sort();

test("selectUsersToRead - sin cambios que expliquen nada: no lee a nadie", () => {
  const r = selectUsersToRead({
    listed: ["1", "20111222", "18333444"],
    linked: ["20111222", "18333444"],
    cached: cache([["1", "MANAGER", 1], ["20111222", "USER", 2], ["18333444", "USER", 1]]),
    hints: [],
    deviceFpCount: 4,
  });
  assert.deepEqual(r, { toRead: [], full: false, staleNoFingerprints: [] });
});

test("selectUsersToRead - lee solo al nuevo, al de primera huella, al de privilegio desconocido y al avisado", () => {
  const r = selectUsersToRead({
    listed: ["1", "20111222", "30000011", "15777888", "22555666"],
    linked: ["20111222", "15777888", "24999000", "22555666"],
    cached: cache([
      ["1", "MANAGER", 1],
      ["20111222", "USER", 2],
      ["15777888", "USER", 0], // tenía 0 huellas y ahora aparece en la lista → primera huella
      ["24999000", null, 0], // vinculado con privilegio desconocido
      ["22555666", "USER", 1], // el equipo avisó que enroló otro dedo
    ]),
    hints: ["22555666"],
    deviceFpCount: 99,
  });
  assert.deepEqual(sorted(r.toRead), ["15777888", "22555666", "24999000", "30000011"]);
  assert.equal(r.full, false, "hay lecturas que pueden explicar el cambio: no hace falta leer todo");
});

test("selectUsersToRead - el total de huellas no cierra y no hay a quién leer → relectura completa", () => {
  const r = selectUsersToRead({
    listed: ["1", "20111222"],
    linked: ["20111222", "18333444"],
    cached: cache([["1", "MANAGER", 1], ["20111222", "USER", 2], ["18333444", "USER", 0]]),
    hints: [],
    deviceFpCount: 4, // caché: 3 → alguien sumó un dedo sin aviso
  });
  assert.equal(r.full, true);
  assert.deepEqual(sorted(r.toRead), ["1", "18333444", "20111222"]);
});

test("selectUsersToRead - quien ya no está en la lista tiene 0 huellas: su caché de huellas se limpia", () => {
  const r = selectUsersToRead({
    listed: ["1"],
    linked: [],
    cached: cache([["1", "MANAGER", 1], ["20111222", "USER", 2]]),
    hints: [],
    deviceFpCount: 1,
  });
  assert.deepEqual(r.staleNoFingerprints, ["20111222"]);
  assert.deepEqual(r.toRead, []);
  assert.equal(r.full, false, "con la caché limpia, el total cierra (1 = 1)");
});

test("selectUsersToRead - primera corrida (sin caché): lee a todos los de la lista", () => {
  const r = selectUsersToRead({ listed: ["1", "2"], linked: [], cached: new Map(), hints: [], deviceFpCount: 2 });
  assert.deepEqual(sorted(r.toRead), ["1", "2"]);
});
