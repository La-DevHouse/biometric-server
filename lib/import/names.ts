// Separar "NOMBRES Y APELLIDOS" (una sola celda en el export de Galepso, nombres
// primero) en nombres y apellidos (docs/14 §3).
//
//   1. Las partículas ("DE", "DEL", "DE LA", "DE LOS"…) se pegan a la palabra que
//      sigue: "DE GOUVEIA" es UN apellido, "DE LOS ANGELES" es parte de un nombre.
//   2. Por cantidad de palabras: 2 → 1+1, 4 → 2+2. Con 3, si la segunda es un
//      nombre de pila conocido (JOSE, MARIA, COROMOTO…) → 2+1; si no → 1+2.
//   3. Lo dudoso (3 sin certeza, 5 o más) se marca: la vista previa lo resalta y
//      deja mover el corte antes de confirmar.
import { cleanPersonName } from "./normalize";

const PARTICLES = new Set(["de", "del", "la", "las", "los", "da", "das", "do", "dos", "di", "van", "von", "y", "san", "santa"]);

// Nombres de pila frecuentes en Venezuela (sin acentos, minúsculas). No hace falta
// que sea completa: solo decide el caso de 3 palabras, y lo dudoso se revisa a mano.
const GIVEN_NAMES = new Set(
  `jose maria juan luis carlos jesus manuel antonio francisco miguel angel pedro rafael ramon alejandro andres
  daniel david eduardo enrique fernando gabriel gregorio gustavo hector ignacio javier jorge julio leonardo
  marcos mario martin nelson oscar pablo ricardo roberto samuel santiago sergio victor wilmer william yefri
  alberto alexander alfredo armando arturo aurelio cesar dimas edgar efrain elias emilio ernesto felix
  freddy gerardo german hernan hugo humberto isaac ivan jaime joel jonathan juan jose leonel lorenzo
  manuel marcelo mauricio nestor orlando omar raul reinaldo rene ruben simon teodoro tomas vicente wilfredo
  ana carmen rosa luisa elena isabel teresa patricia beatriz cristina daniela gabriela mariana valentina
  andrea alejandra carolina claudia diana fernanda laura lucia marta monica paola sofia veronica yolanda
  yusmary norelys nancy lola ramona coromoto gregoria josefina margarita mercedes milagros yelitza yenny
  yuleima yurimar yaneth yasaira yessica yohana zulay zoraida dayana deisy doris elizabeth esther gladys
  graciela ines irene iris jennifer johana karina katherine leidy liliana lisbeth lourdes luz marisol
  maritza marlene mayerling migdalia nelly nohemi olga rebeca rocio sandra silvia soledad susana tibisay
  virginia xiomara yajaira yamileth yanet yelitza yudith yulimar yusbely angeles dolores consuelo
  guadalupe pilar rosario chiquinquira auxiliadora fatima inmaculada trinidad victoria alba alicia
  amparo antonieta aura belkis betty blanca celia clara dalia delia edith elsa emilia eva flor gloria
  hilda ingrid irma juana julia karen lilia lina lorena magaly marbelis marleny matilde nieves norma
  petra raquel rita rosalba ruth sara thais vilma wendy ximena yamilet yesenia zenaida`
    .split(/\s+/)
    .filter(Boolean)
);

export interface NameSplit {
  /** Palabras (con las partículas ya pegadas), en orden. */
  tokens: string[];
  /** Cuántas palabras son nombres (el resto, apellidos). */
  boundary: number;
  firstName: string;
  lastName: string;
  /** La vista previa lo resalta para revisar. */
  ambiguous: boolean;
}

const key = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palabras con las partículas pegadas a la siguiente ("DE LOS ANGELES" = una). */
export function nameTokens(full: string): string[] {
  const words = full.replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let pending: string[] = [];
  for (const w of words) {
    if (PARTICLES.has(key(w))) {
      pending.push(w);
      continue;
    }
    out.push([...pending, w].join(" "));
    pending = [];
  }
  if (pending.length) {
    // Partícula al final (raro): va con la palabra anterior.
    if (out.length) out[out.length - 1] += " " + pending.join(" ");
    else out.push(pending.join(" "));
  }
  return out;
}

/** Corte propuesto; `boundary` explícito (desde la vista previa) lo reemplaza. */
export function splitFullName(full: string, boundary?: number): NameSplit | null {
  const tokens = nameTokens(full);
  if (tokens.length < 2) return null;
  let b: number;
  let ambiguous = false;
  if (boundary !== undefined) {
    b = boundary;
  } else if (tokens.length === 2) {
    b = 1;
  } else if (tokens.length === 3) {
    // Con partícula, decide la última palabra: "DE LOS ANGELES" es nombre, "DE GOUVEIA" no.
    const secondIsGiven = GIVEN_NAMES.has(key(tokens[1].split(" ").at(-1)!));
    b = secondIsGiven ? 2 : 1;
    ambiguous = !secondIsGiven;
  } else if (tokens.length === 4) {
    b = 2;
  } else {
    b = 2;
    ambiguous = true;
  }
  if (b < 1 || b > tokens.length - 1) return null;
  return {
    tokens: tokens.map((t) => cleanPersonName(t)),
    boundary: b,
    firstName: cleanPersonName(tokens.slice(0, b).join(" ")),
    lastName: cleanPersonName(tokens.slice(b).join(" ")),
    ambiguous,
  };
}
