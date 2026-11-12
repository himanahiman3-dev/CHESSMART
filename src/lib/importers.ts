/** Загрузка партий: ссылки Lichess (CORS открыт), примеры. */

export const SAMPLE_GAMES: { title: string; pgn: string }[] = [
  {
    title: "Морфи — Герцог Брауншвейгский (1858), «Партия в опере»",
    pgn: `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke of Brunswick & Count Isouard"]
[Result "1-0"]
[WhiteElo "2690"]
[BlackElo "2100"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`,
  },
  {
    title: "Андерсен — Кизерицкий (1851), «Бессмертная партия»",
    pgn: `[Event "London"]
[Site "London ENG"]
[Date "1851.06.21"]
[White "Adolf Anderssen"]
[Black "Lionel Kieseritzky"]
[Result "1-0"]
[WhiteElo "2600"]
[BlackElo "2500"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0`,
  },
  {
    title: "Каспаров — Топалов (1999), Вейк-ан-Зее",
    pgn: `[Event "Hoogovens"]
[Site "Wijk aan Zee NED"]
[Date "1999.01.20"]
[White "Garry Kasparov"]
[Black "Veselin Topalov"]
[Result "1-0"]
[WhiteElo "2812"]
[BlackElo "2700"]
[ECO "B07"]

1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0`,
  },
];

export async function fetchGameFromLink(input: string): Promise<string> {
  const text = input.trim();
  const li = text.match(/lichess\.org\/(?:game\/export\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?/);
  if (li) {
    const res = await fetch(`https://lichess.org/game/export/${li[1]}?clocks=false&evals=false&opening=true`, {
      headers: { Accept: "application/x-chess-pgn" },
    });
    if (!res.ok) throw new Error(`Lichess вернул ошибку ${res.status}`);
    return await res.text();
  }
  if (/chess\.com/.test(text)) {
    throw new Error(
      "Chess.com не разрешает загрузку партий из браузера (CORS). Откройте партию → «Поделиться» → «PGN», скопируйте текст и вставьте его в поле выше."
    );
  }
  throw new Error("Поддерживаются ссылки lichess.org. Для остальных сайтов вставьте PGN.");
}
