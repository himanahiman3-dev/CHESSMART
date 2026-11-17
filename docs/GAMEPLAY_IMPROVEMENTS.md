# Gameplay batch: 50 implemented capabilities

This release adds a single queued premove (the Lichess/Chessground model), plus gameplay controls and exports.

1. Queue a premove by dragging a friendly piece during the opponent's turn.
2. Select a friendly piece and destination by clicking instead of dragging.
3. Calculate possible premove destinations on a cloned position, not on the live board.
4. Keep the real FEN and board position unchanged while a premove is waiting.
5. Highlight the premove's source square in red.
6. Highlight its target square in red.
7. Draw a red arrow between the queued squares.
8. Cancel a queued premove with right-click.
9. Cancel a queued premove with Escape.
10. Cancel by clicking its source square again.
11. Cancel from the visible premove action next to the board.
12. Re-check legality against the opponent's actual resulting FEN before execution.
13. Discard a premove when the opponent's move makes it illegal.
14. Automatically play a valid premove in a Stockfish game.
15. Automatically submit a valid premove in an online game.
16. Prevent a duplicate online premove submission while a request is pending.
17. Bind the pending online premove to the active game ID.
18. Support castling as a premove.
19. Support captures as a premove when the destination is legal.
20. Support pawn promotion premoves.
21. Allow underpromotion to queen, rook, bishop, or knight.
22. Keep auto-queen as the default promotion behaviour.
23. Offer a promotion picker when auto-queen is disabled.
24. Apply the auto-queen preference to ordinary moves as well as premoves.
25. Clear the queued premove when the game finishes or the feature is disabled.
26. Apply a 100 ms online clock penalty to an executed premove.
27. Mark premove-originated online moves in the stored move history.
28. Allow premove destination calculation when the opponent is currently in check.
29. Poll the server more frequently while an online premove is waiting.
30. Persist gameplay preferences in local storage.
31. Enable or disable premoves from the game settings.
32. Enable or disable move sounds from the game settings.
33. Toggle legal-move destination highlights.
34. Toggle last-move highlights.
35. Toggle board animations.
36. Toggle confirmation before resigning.
37. Choose among four board colour themes.
38. Flip the board in bot games.
39. Flip the board in online games.
40. Play sound effects for moves in bot games.
41. Play sound effects for the opponent's online moves.
42. Copy the current FEN from a bot game.
43. Copy the current FEN from an online game.
44. Copy the PGN of a bot game.
45. Download the PGN of a bot game.
46. Copy the PGN of an online game.
47. Download the PGN of an online game.
48. Copy the SAN move list from a bot game.
49. Copy the SAN move list from an online game.
50. Download a text move list from a bot game.

Additional improvements in the same batch include undo/redo for bot games, position/material insights in both game modes, online rematch requests, connection-state feedback, visibility-aware refresh, refresh-request de-duplication, faster clock display, and low-time warnings.

## Scope

This implements one queued premove at a time, aligned with Chessground's `premovable.current` model. It does not implement Chess.com's five-premove queue or conditional-move trees yet.
