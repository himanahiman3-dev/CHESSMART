// Дебютная база: lichess chess-openings (ECO), кэшируется в браузере.

export interface BookEntry {
  name?: string;
  eco?: string;
}
export type Book = Map<string, BookEntry>;

const CACHE_NAME = "chess-book-v1";
const SOURCES = (f: string) => [
  `https://cdn.jsdelivr.net/gh/lichess-org/chess-openings@master/${f}.tsv`,
  `https://raw.githubusercontent.com/lichess-org/chess-openings/master/${f}.tsv`,
];

const FALLBACK = `A00	Дебют	1. e4
A00	Дебют	1. d4
A00	Дебют	1. c4
A00	Дебют	1. Nf3
C20	Королевская пешка	1. e4 e5
B20	Сицилианская защита	1. e4 c5
C00	Французская защита	1. e4 e6
B10	Защита Каро-Канн	1. e4 c6
B01	Скандинавская защита	1. e4 d5
C44	Королевский конь	1. e4 e5 2. Nf3 Nc6
C50	Итальянская партия	1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5
C50	Итальянская партия	1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6
C60	Испанская партия	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7
C42	Русская партия	1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4
C41	Защита Филидора	1. e4 e5 2. Nf3 d6 3. d4
B90	Сицилианская, Найдорф	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6
D00	Ферзевая пешка	1. d4 d5
D06	Ферзевый гамбит	1. d4 d5 2. c4 e6 3. Nc3 Nf6
D20	Принятый ферзевый гамбит	1. d4 d5 2. c4 dxc4
E60	Староиндийская защита	1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6
E20	Защита Нимцовича	1. d4 Nf6 2. c4 e6 3. Nc3 Bb4
A45	Индийская защита	1. d4 Nf6 2. Bg5
A10	Английское начало	1. c4 e5
A04	Дебют Рети	1. Nf3 d5 2. g3
`;

export const clean = (s: string) => s.replace(/[+#!?]/g, "");

function parseTsv(text: string, book: Book) {
  const lines = text.split("\n");
  for (const raw of lines) {
    const cols = raw.split("\t");
    if (cols.length < 3 || cols[0] === "eco") continue;
    const [eco, name, pgn] = cols;
    const sans = pgn
      .replace(/\d+\.(\.\.)?/g, " ")
      .trim()
      .split(/\s+/)
      .map(clean)
      .filter(Boolean);
    let key = "";
    sans.forEach((s, i) => {
      key = key ? key + " " + s : s;
      const ex = book.get(key);
      if (i === sans.length - 1) {
        if (!ex) book.set(key, { name, eco });
        else if (!ex.name) {
          ex.name = name;
          ex.eco = eco;
        }
      } else if (!ex) book.set(key, {});
    });
  }
}

async function cachedText(urls: string[]): Promise<string | null> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(urls[0]);
    if (hit) return await hit.text();
  } catch {
    /* ignore */
  }
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      const text = await res.text();
      try {
        await cache?.put(urls[0], new Response(text));
      } catch {
        /* ignore */
      }
      return text;
    } catch {
      /* next */
    }
  }
  return null;
}

let bookPromise: Promise<Book> | null = null;

export function loadBook(): Promise<Book> {
  if (!bookPromise) {
    bookPromise = (async () => {
      const book: Book = new Map();
      const files = ["a", "b", "c", "d", "e"];
      const texts = await Promise.all(files.map((f) => cachedText(SOURCES(f))));
      let any = false;
      texts.forEach((t) => {
        if (t) {
          any = true;
          parseTsv(t, book);
        }
      });
      if (!any) parseTsv(FALLBACK, book);
      return book;
    })();
  }
  return bookPromise;
}
