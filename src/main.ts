import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
// exposed for the automated browser tests and for curious tinkerers
(window as unknown as { straw: Game }).straw = game;
if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
